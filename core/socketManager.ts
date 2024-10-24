// socketManager.ts

interface SocketInfo {
  socket: WebSocket;
  playerId?: string;
  username?: string;
  role?: string;
  permissionLevel?: number;
}

export class SocketManager {
  private sockets: Map<string, SocketInfo> = new Map(); // socketId -> SocketInfo
  private playerSockets: Map<string, string> = new Map(); // playerId -> socketId
  private usernameSockets: Map<string, string> = new Map(); // username -> socketId

  addSocket(socketId: string, socket: WebSocket): void {
    this.sockets.set(socketId, { socket });
  }

  updateSocketInfo(socketId: string, info: Partial<SocketInfo>): void {
    const existingInfo = this.sockets.get(socketId);
    if (existingInfo) {
      const updatedInfo = { ...existingInfo, ...info };
      this.sockets.set(socketId, updatedInfo);

      // Update player mapping if playerId is provided
      if (info.playerId) {
        this.playerSockets.set(info.playerId, socketId);
      }

      // Update username mapping if username is provided
      if (info.username) {
        this.usernameSockets.set(info.username, socketId);
      }
    }
  }

  removeSocket(socketId: string): void {
    const socketInfo = this.sockets.get(socketId);
    if (socketInfo) {
      if (socketInfo.playerId) {
        this.playerSockets.delete(socketInfo.playerId);
      }
      if (socketInfo.username) {
        this.usernameSockets.delete(socketInfo.username);
      }
      this.sockets.delete(socketId);
    }
  }

  getSocketById(socketId: string): WebSocket | undefined {
    return this.sockets.get(socketId)?.socket;
  }

  getSocketByPlayerId(playerId: string): WebSocket | undefined {
    const socketId = this.playerSockets.get(playerId);
    return socketId ? this.sockets.get(socketId)?.socket : undefined;
  }

  getSocketByUsername(username: string): WebSocket | undefined {
    const socketId = this.usernameSockets.get(username);
    return socketId ? this.sockets.get(socketId)?.socket : undefined;
  }

  getSocketInfo(socketId: string): SocketInfo | undefined {
    return this.sockets.get(socketId);
  }
}
