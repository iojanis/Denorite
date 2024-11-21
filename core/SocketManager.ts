// deno-lint-ignore-file
// core/webSocketManager.ts

import { ConfigManager } from "./ConfigManager.ts";
import { ScriptManager } from "./ScriptManager.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./AuthService.ts";
import {RateLimiter} from "./RateLimiter.ts";
import { PlayerManager, PlayerData } from "./PlayerManager.ts";

export class SocketManager {
  private config: ConfigManager;
  private scriptManager: ScriptManager;
  private logger: Logger;
  private auth: AuthService;
  private rateLimiter!: RateLimiter;
  private playerManager: PlayerManager;

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
    this.playerManager = new PlayerManager(logger, scriptManager.kv);

    this.rateLimiter.setMethodCost('custom_command_executed', 5);
    this.rateLimiter.setMethodCost('auth', 3);
  }

  async init() {
    this.logger.info('SocketManager initialized')
    this.scriptManager.setPlayerManager(this.playerManager);
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

    // Generate a unique ID for this connection
    const connectionId = crypto.randomUUID();

    socket.onopen = async () => {
      this.logger.debug("New Denorite WebSocket connection established");

      // Add socket to script manager before emitting event
      this.scriptManager.addMinecraftSocket(socket);

      // Emit connection event that can be handled by any module listening for "denorite_connected"
      await this.scriptManager.handleEvent("denorite_connected", {
        connectionId,
        timestamp: Date.now(),
        type: "minecraft",
        address: req.headers.get("X-Forwarded-For") || "unknown",
        status: "connected",
        metadata: {
          userAgent: req.headers.get("User-Agent"),
          protocol: req.headers.get("Sec-WebSocket-Protocol"),
        }
      });
    };

    socket.onmessage = async (event) => {
      try {
        await this.handleWebSocketMessage(event.data, socket, 'minecraft');
      } catch (error: any) {
        this.logger.error(`Error processing Minecraft WebSocket message: ${error.message}`);
      }
    };

    socket.onclose = async (event) => {
      this.logger.info("Denorite WebSocket connection closed");

      // Emit disconnection event before removing socket
      await this.scriptManager.handleEvent("denorite_disconnected", {
        connectionId,
        timestamp: Date.now(),
        type: "minecraft",
        status: "disconnected",
        code: event.code,
        reason: event.reason || "connection_closed",
        wasClean: event.wasClean
      });

      // Remove socket from script manager
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
    let userRole: 'guest' | 'player' | 'operator' = 'guest';
    let connectionId: string | null = null;

    // Add socket ID to the socket object
    const socketId = crypto.randomUUID();
    (socket as any).id = socketId;

    socket.onopen = () => {
      this.logger.debug(`WS: ${playerName || 'guest'} ${userRole} (Socket ID: ${socketId})`);
      this.sendServerInfo(socket, userRole);
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
          try {
            const payload = await this.auth.verifyToken(token as string);
            if (payload && payload.name) {
              playerName = payload.name;

              // Handle the WebSocket connection with the player manager
              connectionId = await this.playerManager.handleWebSocketConnection(
                socket,
                payload,
                {
                  ip: clientIp.hostname as string,
                  userAgent: req.headers.get("User-Agent") || "unknown"
                }
              );

              // Get the updated player data
              const playerData = this.playerManager.getPlayer(playerName);
              if (!playerData) {
                throw new Error('Failed to retrieve player data after connection');
              }

              userRole = payload.role;

              let user = {
                username: playerName,
                role: userRole,
                permissionLevel: playerData.permissionLevel
              };

              this.playerManager.updatePlayerRole(playerName, userRole)

              this.scriptManager.addPlayerSocket(playerName, socket);
              socket.send(JSON.stringify({
                type: 'authenticated',
                success: true,
                socketId: socketId,
                connectionId,
                user,
                message: 'Logged in as ' + playerName
              }));

              this.sendServerInfo(socket, userRole);
            } else {
              socket.send(JSON.stringify({
                type: 'auth_failed',
                success: false,
                socketId: socketId,
                message: 'Token expired or invalid!'
              }));
            }
          } catch (error) {
            socket.send(JSON.stringify({
              type: 'auth_failed',
              success: false,
              socketId: socketId,
              message: 'Authentication failed: ' + error.message
            }));
          }
        } else if (message.eventType === 'get_apps') {
          const apps = await this.scriptManager.moduleWatcher.handleAppListRequest(userRole);
          socket.send(JSON.stringify({
            type: 'apps_list',
            success: true,
            socketId: socketId,
            data: apps
          }));
        } else if (message.eventType === 'get_app_code') {
          if (!message.data.apps || !Array.isArray(message.data.apps)) {
            socket.send(JSON.stringify({
              type: 'error',
              socketId: socketId,
              message: 'Invalid request: apps array required'
            }));
            return;
          }
          const appCode = await this.scriptManager.moduleWatcher.handleAppCodeRequest(
            message.data.apps,
            userRole
          );
          socket.send(JSON.stringify({
            type: 'app_code',
            success: true,
            socketId: socketId,
            data: appCode
          }));
        } else if (message.eventType) {
          // Always pass playerName (null for guests) to maintain scriptManager requirements
          await this.scriptManager.handleSocket(
            message.eventType,
            playerName, // null if guest, actual name if authenticated
            socket,
            message.data,
            message.messageId
          );
        } else {
          socket.send(JSON.stringify({
            type: 'error',
            socketId: socketId,
            message: 'Invalid message format'
          }));
        }
      } catch (error: any) {
        this.logger.error(`Error processing player WebSocket message (Socket ID: ${socketId}): ${error.message}`);
        socket.send(JSON.stringify({
          type: 'error',
          socketId: socketId,
          message: error.message
        }));
      }
    };

    socket.onclose = () => {
      this.logger.debug(`Player WebSocket connection closed (Socket ID: ${socketId})`);

      // Clean up the connection in the player manager if authenticated
      if (playerName && connectionId) {
        this.playerManager.disconnectPlayer(playerName, connectionId);
        this.scriptManager.removePlayerSocket(playerName);
      }
    };

    return response;
  }

  async sendServerInfo(socket: WebSocket, permission: 'guest' | 'player' | 'operator') {
    try {
      // Load server info from KV store
      const serverName = await this.scriptManager.kv.get(['server', 'name']) || ['server', 'name'];
      const serverDescription = await this.scriptManager.kv.get(['server', 'description']) || ['server', 'description'];
      const serverUrl = await this.scriptManager.kv.get(['server', 'url']) || ['server', 'url'];
      const minecraftVersion = await this.scriptManager.kv.get(['server', 'version']) || ['server', 'version'];

      // Load apps configuration from KV
      const apps = await this.scriptManager.kv.get(['server', 'apps']) || [];

      // Get available commands based on permission level
      const commands = this.scriptManager.getCommandsByPermission(permission);

      // console.dir(commands)

      // Send the server info to the client
      socket.send(JSON.stringify({
        type: 'server_info',
        success: true,
        serverName,
        serverDescription,
        serverUrl,
        minecraftVersion,
        commands,
        extras: {
          apps
        }
      }));
    } catch (error: any) {
      this.logger.error(`Error sending server info: ${error.message}`);
      socket.send(JSON.stringify({
        type: 'server_info',
        success: false,
        error: 'Failed to load server information'
      }));
    }
  }

  private async handleWebSocketMessage(message: string, socket: WebSocket, type: 'minecraft' | 'runner') {
    try {
      const data = JSON.parse(message);
      // this.logger.debug(`Received ${type} message: ${JSON.stringify(data)}`);

      if (data.eventType) {
        // Handle core events first
        if (data.eventType === "player_joined") {
          await this.handlePlayerJoined(data.data);
        }

        if (data.eventType === "player_left") {
          await this.handlePlayerLeft(data.data);
        }

        if (data.eventType === "custom_command_executed") {
          await this.scriptManager.handleCommand(
            data.data.command,
            data.data.subcommand,
            data.data.arguments,
            data.data.sender,
            data.data.senderType
          ).catch(error => {
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

  private async handlePlayerJoined(data: {
    playerId: string;
    playerName: string;
    x: number;
    y: number;
    z: number;
    dimension: string;
    ip?: string;
    version?: string;
  }): Promise<void> {
    try {
      const { playerId, playerName, x, y, z, dimension, ip, version } = data;

      // Store player ID/name mappings in KV store
      const mappingResult = await this.scriptManager.kv.atomic()
        .set(['playerNameToId', playerName], playerId)
        .set(['playerIdToName', playerId], playerName)
        .commit();

      if (!mappingResult.ok) {
        throw new Error('Failed to store player mappings');
      }

      // Handle the Minecraft connection with the new player manager
      const connectionId = await this.playerManager.handleMinecraftConnection({
        playerId,
        playerName,
        location: { x, y, z, dimension },
        clientInfo: {
          ip: ip || 'unknown',
          version: version || 'unknown'
        }
      });

      // Get the updated player data
      const playerData = this.playerManager.getPlayer(playerName);
      if (!playerData) {
        throw new Error('Failed to retrieve player data after connection');
      }

      // Notify other connected clients about the player join
      // await this.scriptManager.handleEvent('player_joined', {
      //   connectionId,
      //   playerId,
      //   playerName,
      //   role: playerData.role,
      //   location: { x, y, z, dimension },
      //   timestamp: Date.now(),
      //   clientInfo: {
      //     ip: ip || 'unknown',
      //     version: version || 'unknown'
      //   }
      // });

      this.logger.info(`Player joined: ${playerName} (${playerData.role})`);

    } catch (error: any) {
      this.logger.error(`Error in handlePlayerJoined: ${error.message}`);
      throw error;
    }
  }

  private async handlePlayerLeft(data: {
    playerId: string;
    playerName: string;
    x: number;
    y: number;
    z: number;
    dimension: string;
    reason?: string;
  }): Promise<void> {
    try {
      const { playerId, playerName, x, y, z, dimension, reason } = data;

      // Get player data before disconnection
      const playerData = this.playerManager.getPlayer(playerName);
      if (!playerData) {
        this.logger.warn(`Player left but no data found: ${playerName}`);
        return;
      }

      // Find and remove the Minecraft connection
      const minecraftConnection = Array.from(playerData.connections.entries())
        .find(([_, conn]) => conn.type === 'minecraft');

      if (!minecraftConnection) {
        this.logger.warn(`No Minecraft connection found for leaving player: ${playerName}`);
        return;
      }

      const [connectionId] = minecraftConnection;

      // Record final location before disconnection
      const finalLocation = {
        x,
        y,
        z,
        dimension
      };

      // Update player data with final location
      if (playerData.location) {
        playerData.location = finalLocation;
      }

      // Remove the Minecraft connection
      this.playerManager.disconnectPlayer(playerName, connectionId);

      // Get updated player data to check if they're still connected via WebSocket
      const updatedPlayerData = this.playerManager.getPlayer(playerName);
      const hasWebSocketConnection = updatedPlayerData &&
        Array.from(updatedPlayerData.connections.values())
          .some(conn => conn.type === 'websocket');

      // Prepare leave event data
      const leaveEventData = {
        connectionId,
        playerId,
        playerName,
        role: playerData.role,
        location: finalLocation,
        timestamp: Date.now(),
        reason: reason || 'player_left',
        remainingConnections: {
          total: updatedPlayerData?.connections.size || 0,
          hasWebSocket: hasWebSocketConnection
        }
      };

      // Notify other connected clients about the player leave
      // await this.scriptManager.handleEvent('player_left', leaveEventData);

      // If player still has WebSocket connections, notify them about the game disconnect
      if (hasWebSocketConnection) {
        for (const connection of updatedPlayerData!.connections.values()) {
          if (connection.type === 'websocket' && connection.socket) {
            connection.socket.send(JSON.stringify({
              type: 'minecraft_disconnected',
              timestamp: Date.now(),
              location: finalLocation,
              reason: reason || 'player_left'
            }));
          }
        }
      }

      // Optional: Store last known location in KV store if needed
      try {
        await this.scriptManager.kv.set(
          ['player', playerName, 'lastLocation'],
          finalLocation
        );
      } catch (kvError) {
        this.logger.warn(`Failed to store last location for ${playerName}: ${kvError.message}`);
      }

      // Log appropriate message based on remaining connections
      if (updatedPlayerData) {
        this.logger.info(
          `Player ${playerName} disconnected from Minecraft but remains connected via WebSocket`
        );
      } else {
        this.logger.info(
          `Player ${playerName} fully disconnected (Role: ${playerData.role})`
        );
      }

    } catch (error: any) {
      this.logger.error(`Error in handlePlayerLeft: ${error.message}`);
      throw error;
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
