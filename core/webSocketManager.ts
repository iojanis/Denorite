// core/webSocketManager.ts

import { ConfigManager } from "./configManager.ts";
import { ScriptManager } from "./scriptManager.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./authService.ts";

export class WebSocketManager {
  private config: ConfigManager;
  private scriptManager: ScriptManager;
  private logger: Logger;
  private auth: AuthService;

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
  }

  async init() {
    //
  }

  startMinecraftServer(port: number) {
    Deno.serve({ port }, async (req) => {
      if (req.headers.get("upgrade") != "websocket") {
        this.logger.error('no valid websocket', req)
        return new Response(null, { status: 501 });
      }

      if (!await this.checkOrigin(req)) {
        this.logger.error('no valid origin', req)
        return new Response("Forbidden: Origin not allowed", { status: 403 });
      }

      const url = new URL(req.url);

      // Verify JWT token for all connections
      const isValidToken = await this.verifyDenoriteToken(req);
      if (!isValidToken) {
        this.logger.error('Unauthorized: Invalid or missing Bearer token');
        return new Response("Unauthorized: Invalid or missing Bearer token", { status: 401 });
      }

      if (url.pathname === "/minecraft") {
        return this.handleMinecraftWebSocket(req);
      } else if (url.pathname === "/fresh") {
        return this.handleFreshWebSocket(req);
      } else {
        return new Response("Not Found", { status: 404 });
      }
    });
  }

  startPlayerServer(port: number) {
    Deno.serve({ port }, async (req) => {
      if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
      }
      return this.handlePlayerWebSocket(req);
    });
  }

  private handleMinecraftWebSocket(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);

    this.scriptManager.addMinecraftSocket(socket);

    socket.onopen = () => {
      this.logger.info("New Minecraft WebSocket connection established");
      this.scriptManager.loadCommands().catch(error =>
        this.logger.error(`Error loading commands: ${error.message}`)
      );
    };

    socket.onmessage = async (event) => {
      try {
        await this.handleWebSocketMessage(event.data, socket, 'minecraft');
      } catch (error: any) {
        this.logger.error(`Error processing Minecraft WebSocket message: ${error.message}`);
      }
    };

    socket.onclose = () => {
      this.logger.info("Minecraft WebSocket connection closed");
      this.scriptManager.removeMinecraftSocket(socket);
    };

    return response;
  }

  private handleFreshWebSocket(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.onopen = () => {
      this.logger.info("New Fresh WebSocket connection established");
    };

    socket.onmessage = async (event) => {
      try {
        await this.handleWebSocketMessage(event.data, socket, 'fresh');
      } catch (error: any) {
        this.logger.error(`Error processing Fresh WebSocket message: ${error.message}`);
      }
    };

    socket.onclose = () => {
      this.logger.info("Fresh WebSocket connection closed");
    };

    return response;
  }

  private handlePlayerWebSocket(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);

    let token: string | null = null;
    let playerId: string | null = null;

    socket.onopen = () => {
      this.logger.info("New player WebSocket connection established");
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'auth') {
          token = message.token;
          const payload = await this.auth.verifyToken(token);
          if (payload && payload.playerId) {
            playerId = payload.playerId;
            this.scriptManager.addPlayerSocket(playerId, socket);
            socket.send(JSON.stringify({ type: 'auth', success: true }));
          } else {
            socket.send(JSON.stringify({ type: 'auth', success: false }));
          }
        } else if (message.eventType && playerId) {
          await this.scriptManager.handleSocket(message.eventType, playerId, message.data);
        } else {
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid message or not authenticated' }));
        }
      } catch (error: any) {
        this.logger.error(`Error processing player WebSocket message: ${error.message}`);
      }
    };

    socket.onclose = () => {
      this.logger.info("Player WebSocket connection closed");
      if (playerId) {
        this.scriptManager.removePlayerSocket(playerId);
      }
    };

    return response;
  }

  private async handleWebSocketMessage(message: string, socket: WebSocket, type: 'minecraft' | 'fresh') {
    try {
      const data = JSON.parse(message);
      this.logger.info(`Received ${type} message: ${JSON.stringify(data)}`);

      if (data.eventType) {
        // Handle Minecraft mod events
        await this.scriptManager.handleEvent(data.eventType, data.data);
        return;
      }

      if (data.id && this.scriptManager.hasPendingResponse(data.id)) {
        this.scriptManager.resolvePendingResponse(data.id, data);
        return;
      }

      // Handle other message types (commands, script operations, etc.)
      await this.scriptManager.handleMessage(data, type);

    } catch (error) {
      this.logger.error(`Error handling WebSocket message: ${error.message}`);
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
    } catch (error) {
      this.logger.error(`Denorite client verification failed: ${error.message}`);
      this.logger.error(`Token received: ${token}`);
      return false;
    }
  }

  private async checkOrigin(req: Request): boolean {
    const origin = req.headers.get("Origin");
    const allowedOrigin = await this.config.get("ALLOWED_ORIGIN") as string;

    this.logger.info('allowed origins:', allowedOrigin)

    if (!origin) {
      this.logger.warn("No Origin header present in the request");
      return false;
    }

    return origin === allowedOrigin;
  }
}
