// WebSocketCommandHandler.ts

import { Logger } from "./logger.ts";

interface PendingCommand {
  messageId: string;
  type: string;
  data: unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: any) => void;
  timer: number;
  sentTime: number;
  retries: number;
}

export class WebSocketCommandHandler {
  private activeCommands = new Map<string, PendingCommand>();
  private logger: Logger;
  private timeoutMs: number;
  private maxRetries = 2;
  private cleanupInterval: number;
  private socket: WebSocket | null = null;
  private commandQueue = new Map<string, Promise<void>>();

  constructor(logger: Logger, timeoutMs: number = 5000) {
    this.logger = logger;
    this.timeoutMs = timeoutMs;

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleCommands();
    }, timeoutMs / 2);

    this.logger.debug(
      `WebSocketCommandHandler initialized with timeout ${timeoutMs}ms`,
    );
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.logger.debug("WebSocketCommandHandler cleanup interval destroyed");
    }
  }

  setSocket(socket: WebSocket) {
    this.socket = socket;
    this.logger.debug("WebSocket connection set");
  }

  private getHealthySocket(): WebSocket | null {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }
    return null;
  }

  private async cleanupStaleCommands() {
    const now = Date.now();

    for (const [messageId, command] of this.activeCommands.entries()) {
      const age = now - command.sentTime;
      if (age > this.timeoutMs) {
        if (command.retries < this.maxRetries) {
          command.retries++;
          command.sentTime = now;
          this.logger.debug(
            `Retrying stale command ${messageId} (attempt ${command.retries}/${this.maxRetries})`,
          );
          await this.processCommand(command);
        } else {
          this.logger.warn(
            `Command ${messageId} failed after ${this.maxRetries} retries - cleaning up`,
          );
          this.cleanupCommand(messageId);
          command.reject(
            new Error(`Command timed out after ${this.maxRetries} retries`),
          );
        }
      }
    }
  }

  private async processCommand(command: PendingCommand) {
    const socket = this.getHealthySocket();
    if (!socket) {
      this.logger.error(`No healthy socket for command ${command.messageId}`);
      command.reject(new Error("No healthy socket available"));
      return;
    }

    try {
      this.logger.debug(
        `Processing command ${command.messageId} (type: ${command.type})`,
      );
      this.activeCommands.set(command.messageId, command);

      const message = {
        id: command.messageId,
        ...command.data,
      };

      // Send command without waiting for others to complete
      socket.send(JSON.stringify(message));
      this.logger.debug(`Successfully sent command ${command.messageId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process command ${command.messageId}: ${error}`,
      );
      this.cleanupCommand(command.messageId);
      command.reject(error);
    }
  }

  async sendCommand(socket: WebSocket, data: unknown): Promise<unknown> {
    const messageId = crypto.randomUUID();
    const commandType = (data as any)?.type || "unknown";

    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    const message = {
      id: messageId,
      ...data,
    };

    // IMMEDIATELY send the message - don't wait for anything
    socket.send(JSON.stringify(message));
    // this.logger.debug(`Sent command ${messageId} (type: ${commandType})`);

    // Set up the promise resolution AFTER sending
    return new Promise((resolve, reject) => {
      const command: PendingCommand = {
        messageId,
        type: commandType,
        data,
        resolve,
        reject,
        timer: 0,
        sentTime: Date.now(),
        retries: 0,
      };

      this.activeCommands.set(messageId, command);
    });
  }

  handleResponse(messageId: string, response: unknown): boolean {
    const command = this.activeCommands.get(messageId);
    if (command) {
      // this.logger.debug(`Received response for command ${messageId} (type: ${command.type}) after ${Date.now() - command.sentTime}ms`);
      this.cleanupCommand(messageId);
      command.resolve(response);
      return true;
    }
    return false;
  }

  private cleanupCommand(messageId: string): void {
    const command = this.activeCommands.get(messageId);
    if (command) {
      if (command.timer) {
        clearTimeout(command.timer);
      }
      this.activeCommands.delete(messageId);
      // this.logger.debug(`Cleaned up command ${messageId}. Active commands: ${this.activeCommands.size}`);
    }
  }

  getStatus(): {
    activeCommands: number;
    oldestCommand?: { id: string; age: number; type: string };
  } {
    const now = Date.now();
    let oldestCommand: { id: string; age: number; type: string } | undefined;

    for (const [id, command] of this.activeCommands.entries()) {
      const age = now - command.sentTime;
      if (!oldestCommand || age > oldestCommand.age) {
        oldestCommand = { id, age, type: command.type as string };
      }
    }

    return {
      activeCommands: this.activeCommands.size,
      oldestCommand,
    };
  }

  dumpState(): string {
    const now = Date.now();
    const commands = Array.from(this.activeCommands.entries()).map((
      [id, cmd],
    ) => ({
      id,
      type: cmd.type,
      age: now - cmd.sentTime,
      retries: cmd.retries,
    }));

    return JSON.stringify(
      {
        activeCommands: commands,
        isProcessing: this.activeCommands.size > 0,
      },
      null,
      2,
    );
  }
}
