import { RconClient } from "./RconClient.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./AuthService.ts";

interface RconConnection {
  client: RconClient;
  lastUsed: number;
  socket: WebSocket;
}

export class RconManager {
  private connections: Map<string, RconConnection> = new Map();
  private logger: Logger;
  private auth: AuthService;
  private host: string;
  private port: number;
  private cleanupInterval: number;
  private cleanupTimer: number | undefined;

  constructor(
    logger: Logger,
    auth: AuthService,
    host: string = "localhost",
    port: number = 25575,
    cleanupInterval: number = 300000, // 5 minutes
  ) {
    this.logger = logger;
    this.auth = auth;
    this.host = host;
    this.port = port;
    this.cleanupInterval = cleanupInterval;

    // Start cleanup interval
    // this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  async createConnection(socket: WebSocket, token: string): Promise<void> {
    try {
      // Create new RCON connection
      const rcon = new RconClient(this.host, this.port, token);
      await rcon.connect();

      // const socketId = this.getSocketId(socket);
      const socketId = "0";
      this.connections.set(socketId, {
        client: rcon,
        lastUsed: Date.now(),
        socket,
      });

      // console.log("New RCON Connection: " + socketId)

      this.logger.info(`RCON connection established for socket ${socketId}`);

      // Handle socket closure
      socket.addEventListener("close", () => {
        this.closeConnection(socket).catch((error) => {
          this.logger.error(`Error closing RCON connection: ${error.message}`);
        });
      });
    } catch (error) {
      // this.logger.error(`Failed to create RCON connection: ${error.message}`);
      throw error;
    }
  }

  async executeCommand(socket: WebSocket, command: string): Promise<string> {
    const socketId = this.getSocketId(socket);
    const connection = this.connections.get(socketId);

    if (!connection) {
      throw new Error("No RCON connection found for this socket");
    }

    try {
      connection.lastUsed = Date.now();
      return await connection.client.executeCommand(command);
    } catch (error) {
      this.logger.error(`RCON command execution failed: ${error.message}`);
      // If the connection is dead, remove it
      await this.closeConnection(socket);
      throw error;
    }
  }

  private async closeConnection(socket: WebSocket): Promise<void> {
    const socketId = this.getSocketId(socket);
    const connection = this.connections.get(socketId);

    if (connection) {
      try {
        await connection.client.disconnect();
      } catch (error) {
        this.logger.error(`Error closing RCON client: ${error.message}`);
      }
      this.connections.delete(socketId);
      this.logger.info(`RCON connection closed for socket ${socketId}`);
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    const expiredConnections = Array.from(this.connections.entries())
      .filter(([_, conn]) => now - conn.lastUsed > this.cleanupInterval);

    for (const [socketId, connection] of expiredConnections) {
      try {
        await connection.client.disconnect();
        this.connections.delete(socketId);
        this.logger.info(
          `Cleaned up inactive RCON connection for socket ${socketId}`,
        );
      } catch (error) {
        this.logger.error(
          `Error cleaning up RCON connection: ${error.message}`,
        );
      }
    }
  }

  getConnection(socketId: string): RconConnection | undefined {
    return this.connections.get(socketId);
  }

  private getSocketId(socket: WebSocket): string {
    return socket.url;
  }

  async shutdown(): Promise<void> {
    // Clear the cleanup interval
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
    }

    // Close all connections
    for (const [socketId, connection] of this.connections) {
      try {
        await connection.client.disconnect();
        this.logger.info(`Closed RCON connection for socket ${socketId}`);
      } catch (error) {
        this.logger.error(`Error closing RCON connection: ${error.message}`);
      }
    }
    this.connections.clear();
  }
}
