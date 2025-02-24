import type { Logger } from "./logger.ts";

// auth-types.ts
export interface AuthPayload {
  name: string;
  role: "guest" | "player" | "operator";
  permissionLevel: number;
}

export interface PlayerConnection {
  type: "minecraft" | "websocket";
  connectionId: string;
  socket?: WebSocket;
  lastActive: Date;
  clientInfo: {
    ip: string;
    version: string;
    userAgent?: string;
  };
}

export interface EnhancedPlayerData {
  name: string;
  id: string;
  role: "guest" | "player" | "operator";
  permissionLevel: number;
  joinTime: string;
  connections: Map<string, PlayerConnection>;
  location?: {
    x: number;
    y: number;
    z: number;
    dimension: string;
  };
  metadata: Map<string, any>;
}

// enhanced-player-manager.ts
export class PlayerManager {
  private players: Map<string, EnhancedPlayerData> = new Map();
  private idToName: Map<string, string> = new Map();
  private logger: Logger;
  private kv: any; // Your KV store type

  constructor(logger: Logger, kv: any) {
    this.logger = logger;
    this.kv = kv;
  }

  async loadPlayerData(playerName: string): Promise<EnhancedPlayerData | null> {
    try {
      // Load persistent data from KV store
      const [role, permissionLevel] = await Promise.all([
        this.kv.get(["player", playerName, "role"]),
        this.kv.get(["player", playerName, "permissionLevel"]),
      ]);

      return {
        name: playerName,
        id: "", // Will be set during connection
        role: role || "player",
        permissionLevel: permissionLevel || 0,
        joinTime: new Date().toISOString(),
        connections: new Map(),
        metadata: new Map(),
      };
    } catch (error) {
      this.logger.error(
        `Error loading player data for ${playerName}: ${error}`,
      );
      return null;
    }
  }

  async handleMinecraftConnection(data: {
    playerId: string;
    playerName: string;
    location: { x: number; y: number; z: number; dimension: string };
    clientInfo: { ip: string; version: string };
  }): Promise<void> {
    const { playerId, playerName, location, clientInfo } = data;

    let playerData = this.players.get(playerName) ||
      await this.loadPlayerData(playerName);
    if (!playerData) {
      throw new Error(`Failed to load player data for ${playerName}`);
    }

    // Update player data
    playerData.id = playerId;
    playerData.location = location;

    // Create new connection
    const connectionId = crypto.randomUUID();
    const connection: PlayerConnection = {
      type: "minecraft",
      connectionId,
      lastActive: new Date(),
      clientInfo,
    };

    playerData.connections.set(connectionId, connection);
    this.players.set(playerName, playerData);
    this.idToName.set(playerId, playerName);

    this.logger.info(
      `Minecraft connection established for ${playerName} (${playerData.role})`,
    );
    return connectionId;
  }

  async handleWebSocketConnection(
    socket: WebSocket,
    authPayload: AuthPayload,
    clientInfo: { ip: string; userAgent: string },
  ): Promise<string> {
    const { name: playerName } = authPayload;

    let playerData = this.players.get(playerName) ||
      await this.loadPlayerData(playerName);
    if (!playerData) {
      throw new Error(`Failed to load player data for ${playerName}`);
    }

    // Create new connection
    const connectionId = crypto.randomUUID();
    const connection: PlayerConnection = {
      type: "websocket",
      connectionId,
      socket,
      lastActive: new Date(),
      clientInfo: {
        ...clientInfo,
        version: "web",
      },
    };

    playerData.connections.set(connectionId, connection);
    this.players.set(playerName, playerData);

    this.logger.info(
      `WebSocket connection established for ${playerName} (${
        JSON.stringify(playerData.role)
      })`,
    );
    return connectionId;
  }

  disconnectPlayer(playerName: string, connectionId: string): void {
    const playerData = this.players.get(playerName);
    if (!playerData) return;

    // Remove specific connection
    playerData.connections.delete(connectionId);

    // If no more connections, remove player entirely
    if (playerData.connections.size === 0) {
      this.players.delete(playerName);
      if (playerData.id) {
        this.idToName.delete(playerData.id);
      }
      this.logger.info(`Player fully disconnected: ${playerName}`);
    } else {
      this.logger.info(`Connection ${connectionId} removed for ${playerName}`);
    }
  }

  async updatePlayerRole(
    playerName: string,
    newRole: "guest" | "player" | "operator",
  ): Promise<boolean> {
    try {
      const playerData = this.players.get(playerName);
      if (!playerData) return false;

      // Update in memory
      playerData.role = newRole;
      playerData.permissionLevel = newRole === "operator" ? 1 : 0;

      // Persist to KV store
      await this.kv.atomic()
        .set(["player", playerName, "role"], newRole)
        .set(
          ["player", playerName, "permissionLevel"],
          playerData.permissionLevel,
        )
        .commit();

      // Notify connected WebSocket clients
      for (const connection of playerData.connections.values()) {
        if (connection.type === "websocket" && connection.socket) {
          connection.socket.send(JSON.stringify({
            type: "role_updated",
            role: newRole,
            permissionLevel: playerData.permissionLevel,
          }));
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`Error updating role for ${playerName}: ${error}`);
      return false;
    }
  }

  isOnline(playerName: string): boolean {
    const player = this.players.get(playerName);
    return player !== undefined && player.connections.size > 0;
  }

  isConnectedVia(
    playerName: string,
    connectionType: "minecraft" | "websocket",
  ): boolean {
    const player = this.players.get(playerName);
    if (!player) return false;

    return Array.from(player.connections.values())
      .some((conn) => conn.type === connectionType);
  }

  getPlayer(playerName: string): EnhancedPlayerData | undefined {
    return this.players.get(playerName);
  }

  getPlayerByConnection(
    connectionId: string,
  ): EnhancedPlayerData | { name: null } {
    return Array.from(this.players.values())
      .find((player) => player.connections.has(connectionId)) || { name: null };
  }

  getAllPlayers(): EnhancedPlayerData[] {
    return Array.from(this.players.values());
  }

  getPlayersInDimension(dimension: string): EnhancedPlayerData[] {
    return this.getAllPlayers()
      .filter((player) => player.location?.dimension === dimension);
  }

  hasPermission(playerName: string, requiredPermission: string): boolean {
    const player = this.players.get(playerName);
    if (!player) return false;

    switch (requiredPermission) {
      case "guest":
        return true;
      case "player":
        return player.role === "player" || player.role === "operator";
      case "operator":
        return player.role === "operator";
      default:
        return false;
    }
  }
}
