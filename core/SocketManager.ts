// deno-lint-ignore-file
// core/webSocketManager.ts

import { ConfigManager } from "./ConfigManager.ts";
import { ScriptManager } from "./ScriptManager.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./AuthService.ts";
import {RateLimiter} from "./RateLimiter.ts";

export class SocketManager {
  private config: ConfigManager;
  private scriptManager: ScriptManager;
  private logger: Logger;
  private auth: AuthService;
  private rateLimiter!: RateLimiter;

  constructor(
    config: ConfigManager,
    scriptManager: ScriptManager,
    logger: Logger,
    auth: AuthService
  ) {
    this.config = config;
    this.scriptManager = scriptManager;
    this.logger = logger;
    this.auth = auth;

    if (!this.scriptManager.kv) return
    this.rateLimiter = new RateLimiter(this.scriptManager.kv.kv);

    this.rateLimiter.setMethodCost('custom_command_executed', 5);
    this.rateLimiter.setMethodCost('auth', 3);
  }

  async init() {
    this.logger.info('SocketManager initialized')
  }

  private getClientIp(connInfo: Deno.ServeHandlerInfo): Deno.Addr {
    return connInfo?.remoteAddr;
  }

  startMinecraftServer(port: number) {
    const that = this;
    Deno.serve({
      onListen() {
        that.logger.info(`Denorite WebSocket server running on ws://localhost:${port}`);
      },
      port
    }, async (req, conInfo) => {
      const url = new URL(req.url);
      const clientIp = this.getClientIp(conInfo);

      const isAuthenticated = await this.verifyDenoriteToken(req);
      console.log(clientIp)

      const rateLimitResult = await this.rateLimiter.handleMinecraftServerRateLimit(
        clientIp.hostname as unknown as string,
        isAuthenticated
      );

      if (!rateLimitResult.allowed) {
        this.logger.error(`Rate limit exceeded for IP ${clientIp}`);
        return new Response(rateLimitResult.error, { status: 429 });
      }

      if (!isAuthenticated) {
        this.logger.error('Unauthorized: Invalid or missing Bearer token');
        return new Response("Unauthorized: Invalid or missing Bearer token", { status: 401 });
      }

      if (req.headers.get("upgrade") != "websocket") {
        this.logger.error('no valid websocket', req);
        return new Response(null, { status: 501 });
      }

      if (!await this.checkOrigin(req)) {
        this.logger.error('no valid origin', req);
        return new Response("Forbidden: Origin not allowed", { status: 403 });
      }

      if (url.pathname === "/minecraft") {
        return this.handleMinecraftWebSocket(req);
      } else if (url.pathname === "/runner") {
        return this.handleRunnerWebSocket(req);
      } else {
        return new Response("Not Found", { status: 404 });
      }
    });
  }


  startPlayerServer(port: number) {
    const that = this
    Deno.serve({ onListen() {
        that.logger.info(`Player WebSocket server running on ws://localhost:${port}`);
      }, port }, async (req, conInfo) => {
      if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
      }
      return this.handlePlayerWebSocket(req, conInfo);
    });
  }

  private handleMinecraftWebSocket(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);

    this.scriptManager.addMinecraftSocket(socket);

    socket.onopen = () => {
      this.logger.debug("New Denorite WebSocket connection established");
    };

    socket.onmessage = async (event) => {
      try {
        await this.handleWebSocketMessage(event.data, socket, 'minecraft');
      } catch (error: any) {
        this.logger.error(`Error processing Minecraft WebSocket message: ${error.message}`);
      }
    };

    socket.onclose = () => {
      this.logger.info("Denorite WebSocket connection closed");
      this.scriptManager.removeMinecraftSocket(socket);
    };

    return response;
  }

  private handleRunnerWebSocket(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      this.logger.debug("New Runner WebSocket connection established");
    };

    socket.onmessage = async (event) => {
      try {
        await this.handleWebSocketMessage(event.data, socket, 'runner');
      } catch (error: any) {
        this.logger.error(`Error processing Runner WebSocket message: ${error.message}`);
      }
    };

    socket.onclose = () => {
      this.logger.debug("Runner WebSocket connection closed");
    };

    return response;
  }

  private handlePlayerWebSocket(req: Request, conInfo): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const clientIp = this.getClientIp(conInfo);

    let token: string | null = null;
    let playerName: string | null = null;
    let userRole: 'guest' | 'authenticated' | 'operator' = 'guest';

    // Add socket ID to the socket object
    const socketId = crypto.randomUUID();
    (socket as any).id = socketId;

    socket.onopen = () => {
      this.logger.debug(`New player WebSocket connection established (Socket ID: ${socketId})`);
      this.sendServerInfo(socket, 'guest');
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        // Rate limit check based on user role and message type
        const rateLimitResult = await this.rateLimiter.handleSocketRateLimit(
          clientIp.hostname as unknown as string,
          message.eventType || 'message',
          userRole
        );

        if (!rateLimitResult.allowed) {
          socket.send(JSON.stringify({
            type: 'error',
            socketId: socketId,
            message: rateLimitResult.error
          }));
          return;
        }

        if (message.eventType === 'auth') {
          token = message.data.token;
          const payload = await this.auth.verifyToken(token as string);
          if (payload && payload.name) {
            playerName = payload.name;
            userRole = 'authenticated';

            let user = {
              username: payload.name,
              role: 'player',
              permissionLevel: 1
            };

            const playerRoleResult = await this.scriptManager.kv.get(['player', payload.name, 'role']);
            if (playerRoleResult === 'operator') {
              user.role = 'operator';
              user.permissionLevel = 1;
              userRole = 'operator';
            }

            this.scriptManager.addPlayerSocket(playerName, socket);
            socket.send(JSON.stringify({
              type: 'authenticated',
              success: true,
              socketId: socketId,
              user,
              message: 'Logged in as ' + playerName
            }));

            this.sendServerInfo(socket, 'player');
          } else {
            socket.send(JSON.stringify({
              type: 'auth_failed',
              success: false,
              socketId: socketId,
              message: 'Token expired or invalid!'
            }));
          }
        } else if (message.eventType) {
          await this.scriptManager.handleSocket(
            message.eventType,
            playerName,
            socket,
            message.data,
            message.messageId
          );
        } else {
          socket.send(JSON.stringify({
            type: 'error',
            socketId: socketId,
            message: 'Invalid message or not authenticated ' + JSON.stringify(event.data)
          }));
        }
      } catch (error: any) {
        this.logger.error(`Error processing player WebSocket message (Socket ID: ${socketId}): ${error.message}`);
      }
    };

    socket.onclose = () => {
      this.logger.debug(`Player WebSocket connection closed (Socket ID: ${socketId})`);
      if (playerName) {
        this.scriptManager.removePlayerSocket(playerName);
      }
    };

    return response;
  }

  sendServerInfo(socket, permission) {
    const serverName = "COU.AI"
    const serverDescription = "The Official: Craft Operations Unit Server."
    const serverUrl = "cou.ai"
    const minecraftVersion = "1.20.4"
    const commands = this.scriptManager.getCommandsByPermission(permission)
    const extras = {
      apps: [

      ]
    }
    socket.send(JSON.stringify({
      type: 'server_info',
      success: true,
      serverName,
      serverDescription,
      serverUrl,
      minecraftVersion,
      commands,
      ...extras
    }));
  }

  private async handleWebSocketMessage(message: string, socket: WebSocket, type: 'minecraft' | 'runner') {
    try {
      const data = JSON.parse(message);
      this.logger.debug(`Received ${type} message: ${JSON.stringify(data)}`);

      if (data.eventType) {
        // Handle Minecraft mod events

        if (data.eventType === "custom_command_executed") {
          await this.scriptManager.handleCommand(data.data.command, data.data.subcommand, data.data.arguments, data.data.sender, data.data.senderType)
          .catch(error => {
            this.logger.error(`Error handling command: ${error}`);
          });
          return;
        }

        await this.scriptManager.handleEvent(data.eventType, data.data);
        return;
      }

      if (data.id && this.scriptManager.hasPendingResponse(data.id)) {
        this.scriptManager.resolvePendingResponse(data.id, data);
        return;
      }

      // Handle other message types (commands, script operations, etc.)
      await this.scriptManager.handleMessage(data, type);

    } catch (error: any) {
      this.logger.error(`Error handling WebSocket message: ${error.message}`);
      const data = JSON.parse(message);
      socket.send(JSON.stringify({
        id: data?.id,
        type: 'error',
        error: 'Internal server error'
      }));
    }
  }

  private async verifyDenoriteToken(req: Request): Promise<boolean> {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      this.logger.error("No valid Authorization header found");
      return false;
    }

    const token = authHeader.split(" ")[1];
    try {
      const payload = await this.auth.verifyDenoriteToken(token);
      this.logger.info(`Denorite token verified successfully: ${JSON.stringify(payload)}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Denorite client verification failed: ${error.message}`);
      this.logger.error(`Token received: ${token}`);
      return false;
    }
  }

  private async checkOrigin(req: Request): Promise<boolean> {
    const origin = req.headers.get("Origin");
    const allowedOrigin = await this.config.get("ALLOWED_ORIGIN") as string;

    this.logger.debug('Allowed origin:', allowedOrigin)

    if (!origin) {
      this.logger.warn("No Origin header present in the request");
      return false;
    }

    return origin === allowedOrigin;
  }
}
