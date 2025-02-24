import {
  Command,
  Description,
  Event,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import { ScriptContext } from "../types.ts";
import {
  alert,
  button,
  container,
  TellrawJSON,
  text,
  tooltip,
} from "../tellraw-ui.ts";

interface SessionData {
  startTime: string;
  endTime?: string;
  duration?: number;
  startLocation: Location;
  endLocation?: Location;
  clientInfo?: {
    ip: string;
    version: string;
  };
}

interface Location {
  x: number;
  y: number;
  z: number;
  dimension: string;
}

interface PlayerStats {
  firstJoin: string;
  lastSeen: string;
  totalPlayTime: number;
  loginCount: number;
  role?: string;
}

interface TicketData {
  playerName: string;
  expiryTime: string;
  ticket: string;
}

@Module({
  name: "Sessions",
  version: "2.0.3",
})
export class Sessions {
  private readonly CONFIG = {
    TICKET_EXPIRY: 30 * 60 * 1000, // 30 minutes
    MAX_SESSIONS_STORED: 10,
    TICKET_LENGTH: 5,
    MESSAGE_DELAY: 2000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
  };

  private readonly KEYS = {
    PLAYER: {
      STATS: (playerName: string) => ["player", playerName, "stats"],
      SESSIONS: (playerName: string) => ["player", playerName, "sessions"],
      CURRENT_SESSION: (
        playerName: string,
      ) => ["player", playerName, "currentSession"],
      ROLE: (playerName: string) => ["player", playerName, "role"],
      PERMISSION_LEVEL: (
        playerName: string,
      ) => ["player", playerName, "permissionLevel"],
    },
    TICKETS: {
      PLAYER: (ticket: string) => ["tickets", "player", ticket],
      PLAYER_NAME: (
        playerName: string,
      ) => ["tickets", "playerName", playerName],
      ADMIN: () => ["tickets", "admin"],
      PENDING_ADMIN_SOCKET: (
        socketId: string,
      ) => ["tickets", "pending_admin_socket", socketId],
    },
    MAPPINGS: {
      NAME_TO_ID: (playerName: string) => ["playerNameToId", playerName],
      ID_TO_NAME: (playerId: string) => ["playerIdToName", playerId],
    },
  };

  private generateTicket(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from(
      { length: this.CONFIG.TICKET_LENGTH },
      () => chars.charAt(Math.floor(Math.random() * chars.length)),
    ).join("");
  }

  private createLoginMessage(
    ticket: string,
    isAdmin: boolean = false,
  ): TellrawJSON {
    return container([
      isAdmin
        ? text("Admin Access\n", { style: { color: "red", styles: ["bold"] } })
        : text("Login Ticket\n", { style: { color: "gold" } }),
      tooltip([
        text("Your token: ", { style: { color: "white" } }),
        text(ticket, { style: { color: "green", styles: ["bold"] } }),
      ], {
        trigger: text("█████", {
          style: { styles: ["obfuscated"] },
          onClick: {
            action: "copy_to_clipboard",
            value: ticket,
          },
        }),
      }),
      text("\n"),
      text("hover to reveal • click to copy", {
        style: { color: "gray", styles: ["italic"] },
      }),
    ]).render();
  }

  private async createWelcomeMessage(playerName: string): Promise<TellrawJSON> {
    return container([
      text("Welcome, ", { style: { color: "yellow" } }),
      text(playerName, { style: { color: "white", styles: ["bold"] } }),
      text("\nLogin token ready below", { style: { color: "gray" } }),
    ]).render();
  }

  private async cleanupOldSessions(kv: any, playerName: string): Promise<void> {
    const sessionsResult = await kv.get(this.KEYS.PLAYER.SESSIONS(playerName));
    const sessions = sessionsResult.value || {};

    const sessionIds = Object.keys(sessions);
    if (sessionIds.length > this.CONFIG.MAX_SESSIONS_STORED) {
      const sortedSessions = sessionIds
        .map((id) => ({
          id,
          startTime: new Date(sessions[id].startTime).getTime(),
        }))
        .sort((a, b) => b.startTime - a.startTime);

      const toDelete = sortedSessions.slice(this.CONFIG.MAX_SESSIONS_STORED);
      for (const session of toDelete) {
        delete sessions[session.id];
      }

      await kv.set(this.KEYS.PLAYER.SESSIONS(playerName), sessions);
    }
  }

  private async updatePlayerStats(
    kv: any,
    playerName: string,
    updates: Partial<PlayerStats>,
  ): Promise<void> {
    const result = await kv.get(this.KEYS.PLAYER.STATS(playerName));
    const currentStats = result.value || {};
    await kv.set(this.KEYS.PLAYER.STATS(playerName), {
      ...currentStats,
      ...updates,
    });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendMessageWithRetry(
    tellraw: any,
    playerName: string,
    message: any,
    attempts: number = this.CONFIG.RETRY_ATTEMPTS,
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await tellraw(playerName, message);
      } catch (error) {
        if (i === attempts - 1) throw error;
        await this.delay(this.CONFIG.RETRY_DELAY);
      }
    }
  }

  @Event("player_joined")
  async handlePlayerJoined(
    { params, kv, log, tellraw }: ScriptContext,
  ): Promise<void> {
    const { playerId, playerName, x, y, z, dimension } = params;
    const adminUsername = Deno.env.get("DENORITE_ADMIN_USER");
    const isAdmin = playerName === adminUsername;

    try {
      const now = new Date().toISOString();
      log(`Session start: ${playerName} (ID: ${playerId})`);

      // Generate tickets
      const playerTicket = this.generateTicket();
      const adminTicket = isAdmin ? this.generateTicket() : null;
      const expiryTime = new Date(Date.now() + this.CONFIG.TICKET_EXPIRY)
        .toISOString();

      // Store player ID/name mappings
      const mappingResult = await kv.atomic()
        .set(this.KEYS.MAPPINGS.NAME_TO_ID(playerName), playerId)
        .set(this.KEYS.MAPPINGS.ID_TO_NAME(playerId), playerName)
        .commit();

      if (!mappingResult.ok) {
        throw new Error("Failed to store player mappings");
      }

      // Store tickets
      await kv.atomic()
        .set(this.KEYS.TICKETS.PLAYER(playerTicket), { playerName, expiryTime })
        .set(this.KEYS.TICKETS.PLAYER_NAME(playerName), {
          ticket: playerTicket,
          expiryTime,
        })
        .commit();

      if (isAdmin && adminTicket) {
        await kv.set(this.KEYS.TICKETS.ADMIN(), {
          ticket: adminTicket,
          expiryTime,
        });
      }

      // Initialize or update player stats
      const statsResult = await kv.get(this.KEYS.PLAYER.STATS(playerName));
      const stats = statsResult.value || {};

      if (!stats.firstJoin) {
        await this.updatePlayerStats(kv, playerName, {
          firstJoin: now,
          lastSeen: now,
          totalPlayTime: 0,
          loginCount: 1,
        });
      } else {
        await this.updatePlayerStats(kv, playerName, {
          lastSeen: now,
          loginCount: (stats.loginCount || 0) + 1,
        });
      }
      // Initialize session
      const sessionId = crypto.randomUUID();
      const sessionData: SessionData = {
        startTime: now,
        startLocation: { x, y, z, dimension },
        clientInfo: {
          ip: params.ip || "unknown",
          version: params.version || "unknown",
        },
      };

      await kv.atomic()
        .set(this.KEYS.PLAYER.SESSIONS(playerName), {
          [sessionId]: sessionData,
        })
        .set(this.KEYS.PLAYER.CURRENT_SESSION(playerName), sessionId)
        .commit();

      await this.cleanupOldSessions(kv, playerName);

      // Send welcome sequence
      await new Promise((resolve) =>
        setTimeout(resolve, this.CONFIG.MESSAGE_DELAY)
      );

      const welcomeMsg = await this.createWelcomeMessage(playerName);
      await this.sendMessageWithRetry(tellraw, playerName, welcomeMsg);

      // Send login credentials
      await this.sendMessageWithRetry(
        tellraw,
        playerName,
        this.createLoginMessage(playerTicket, false),
      );

      if (isAdmin && adminTicket) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await this.sendMessageWithRetry(
          tellraw,
          playerName,
          this.createLoginMessage(adminTicket, true),
        );
      }
    } catch (error) {
      log(`Error: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: "Session initialization failed",
      }).render();

      await tellraw(playerName, errorMsg);
    }
  }

  @Event("player_left")
  async handlePlayerLeft({ params, kv, log }: ScriptContext): Promise<void> {
    const { playerId, playerName, x, y, z, dimension } = params;

    try {
      const now = new Date().toISOString();
      log(`Session end: ${playerName} (ID: ${playerId})`);

      const currentSessionResult = await kv.get(
        this.KEYS.PLAYER.CURRENT_SESSION(playerName),
      );
      if (!currentSessionResult.value) {
        log(`No active session found for ${playerName}`);
        return;
      }

      const sessionId = currentSessionResult.value;
      const sessionResult = await kv.get(this.KEYS.PLAYER.SESSIONS(playerName));
      const sessions = sessionResult.value || {};
      const sessionData = sessions[sessionId];

      if (!sessionData) {
        log(`No session data found for ${playerName} (${sessionId})`);
        return;
      }

      // Calculate session duration
      const duration =
        (new Date(now).getTime() - new Date(sessionData.startTime).getTime()) /
        1000;
      const updatedSession = {
        ...sessionData,
        endTime: now,
        endLocation: { x, y, z, dimension },
        duration,
      };

      // Update stats with new playtime
      const statsResult = await kv.get(this.KEYS.PLAYER.STATS(playerName));
      const stats = statsResult.value || {};
      const totalPlayTime = (stats.totalPlayTime || 0) + duration;

      // Atomic update
      const result = await kv.atomic()
        .set(this.KEYS.PLAYER.SESSIONS(playerName), {
          ...sessions,
          [sessionId]: updatedSession,
        })
        .set(this.KEYS.PLAYER.STATS(playerName), {
          ...stats,
          totalPlayTime,
          lastSeen: now,
        })
        .delete(this.KEYS.PLAYER.CURRENT_SESSION(playerName))
        .commit();

      if (!result.ok) {
        throw new Error("Failed to update session data");
      }

      // Clean up tickets
      const ticketResult = await kv.get(
        this.KEYS.TICKETS.PLAYER_NAME(playerName),
      );
      if (ticketResult.value) {
        await kv.delete(this.KEYS.TICKETS.PLAYER(ticketResult.value.ticket));
        await kv.delete(this.KEYS.TICKETS.PLAYER_NAME(playerName));
      }

      log(
        `Session closed for ${playerName} - Duration: ${
          Math.floor(duration / 60)
        }m ${Math.floor(duration % 60)}s`,
      );
    } catch (error) {
      log(`Error in session end: ${error.message}`);
    }
  }

  @Command(["session", "ticket"])
  @Description("Request a new login token")
  @Permission("player")
  async loginCommand(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      log(`Login request from ${sender}`);

      const ticketData = await kv.get(this.KEYS.TICKETS.PLAYER_NAME(sender));
      if (!ticketData.value) {
        throw new Error("No active token found");
      }

      const ticket = ticketData.value.ticket;
      const expiryTime = new Date(ticketData.value.expiryTime);

      if (expiryTime < new Date()) {
        throw new Error("Token expired - Please reconnect");
      }

      const messages = await this.sendMessageWithRetry(
        tellraw,
        sender,
        this.createLoginMessage(ticket, false),
      );

      return { messages, success: true };
    } catch (error) {
      log(`Login error: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Login Failed",
        description: error.message,
      }).render();

      const messages = await tellraw(sender, errorMsg);
      return { messages, success: false };
    }
  }

  @Command(["session", "info"])
  @Description("View your current session information")
  @Permission("player")
  async sessionInfo(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const currentSessionResult = await kv.get(
        this.KEYS.PLAYER.CURRENT_SESSION(sender),
      );
      if (!currentSessionResult.value) {
        throw new Error("No active session found");
      }

      const sessionId = currentSessionResult.value;
      const sessionResult = await kv.get(this.KEYS.PLAYER.SESSIONS(sender));
      const sessions = sessionResult.value || {};
      const sessionData = sessions[sessionId];

      if (!sessionData) {
        throw new Error("Session data not found");
      }

      const duration =
        (Date.now() - new Date(sessionData.startTime).getTime()) / 1000;
      const durationStr = this.formatDuration(duration);

      const infoMessage = container([
        text("Session Info\n", { style: { color: "gold" } }),
        text("Duration: ", { style: { color: "gray" } }),
        text(durationStr + "\n", { style: { color: "white" } }),
        text("Client: ", { style: { color: "gray" } }),
        text(sessionData.clientInfo?.version || "unknown", {
          style: { color: "white" },
        }),
        text("\n\n"),
        button("View History", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/session history",
          },
        }),
      ]).render();

      const messages = await tellraw(sender, infoMessage);
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      }).render();

      const messages = await tellraw(sender, errorMsg);
      return { messages };
    }
  }

  @Command(["session", "history"])
  @Description("View your session history")
  @Permission("player")
  async sessionHistory(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const sessionsResult = await kv.get(this.KEYS.PLAYER.SESSIONS(sender));
      const sessions = sessionsResult.value || {};
      const sessionList = Object.entries(sessions)
        .sort(([, a], [, b]) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        )
        .slice(0, 5);

      if (sessionList.length === 0) {
        throw new Error("No session history found");
      }

      const historyMessage = container([
        text("Recent Sessions\n", { style: { color: "gold" } }),
        ...sessionList.flatMap(([id, session], index) => {
          const duration = session.duration ||
            (session.endTime
              ? (new Date(session.endTime).getTime() -
                new Date(session.startTime).getTime()) / 1000
              : (Date.now() - new Date(session.startTime).getTime()) / 1000);

          const durationStr = this.formatDuration(duration);
          const date = new Date(session.startTime).toLocaleDateString();

          return [
            text(`${date} `, { style: { color: "yellow" } }),
            text(`(${durationStr})\n`, { style: { color: "gray" } }),
          ];
        }),
      ]).render();

      const messages = await tellraw(sender, historyMessage);
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      }).render();

      const messages = await tellraw(sender, errorMsg);
      return { messages };
    }
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [
      hours > 0 ? `${hours}h` : null,
      minutes > 0 ? `${minutes}m` : null,
      `${Math.floor(seconds % 60)}s`,
    ].filter(Boolean).join(" ");
  }

  @Socket("ticket_module")
  async ticketAuth(
    { params, kv, auth, log }: ScriptContext,
  ): Promise<{ success: boolean; token?: any; error?: string }> {
    const { ticket, socket } = params;

    try {
      log(`Ticket authentication attempt from socket ${socket?.id}`);

      if (!ticket || !socket?.id) {
        throw new Error("Invalid request parameters");
      }

      // Check ticket expiry
      const now = new Date();
      const adminTicketData = await kv.get(this.KEYS.TICKETS.ADMIN());
      const playerTicketData = await kv.get(this.KEYS.TICKETS.PLAYER(ticket));

      const isAdmin = adminTicketData.value?.ticket === ticket;
      const ticketData = isAdmin
        ? adminTicketData.value
        : playerTicketData.value;

      if (!ticketData || new Date(ticketData.expiryTime) < now) {
        log(`Invalid or expired ticket attempt from socket ${socket.id}`);
        return {
          success: false,
          error: "Authentication failed: Token expired or invalid",
        };
      }

      // Handle admin authentication flow
      if (isAdmin) {
        log(`Admin token validation from socket ${socket.id}`);
        await kv.set(this.KEYS.TICKETS.PENDING_ADMIN_SOCKET(socket.id), {
          timestamp: now.toISOString(),
        });
        return {
          success: true,
          token: null,
          message: "Admin validation successful",
        };
      }

      // Check for pending admin status
      const isPendingAdmin = await kv.get(
        this.KEYS.TICKETS.PENDING_ADMIN_SOCKET(socket.id),
      );
      const playerName = ticketData.playerName;
      const playerId = await auth.getPlayerIdFromName(playerName);

      if (!playerId) {
        log(`Player not found for token auth: ${playerName}`);
        throw new Error("Authentication failed: Player not found");
      }

      // Determine role and permissions
      const isOperator = isPendingAdmin.value ||
        playerName === Deno.env.get("DENORITE_ADMIN_USER");
      const role = isOperator ? "operator" : "player";
      const permissionLevel = isOperator ? 4 : 1;

      // Generate authentication token
      const token = await auth.createToken({
        id: playerId,
        name: playerName,
        role,
        permissionLevel,
        sessionStart: now.toISOString(),
      });

      log(`Generated authentication token for ${playerName} with role ${role}`);

      // Clean up admin socket state if needed
      if (isPendingAdmin.value) {
        await kv.delete(this.KEYS.TICKETS.PENDING_ADMIN_SOCKET(socket.id));
        log(`Cleaned up pending admin socket state for ${socket.id}`);
      }

      // Update user role and permissions if admin
      if (isOperator) {
        const result = await kv.atomic()
          .set(this.KEYS.PLAYER.ROLE(playerName), role)
          .set(this.KEYS.PLAYER.PERMISSION_LEVEL(playerName), permissionLevel)
          .commit();

        if (!result.ok) {
          log(
            `Warning: Failed to update role and permissions for ${playerName}`,
          );
        } else {
          log(`Updated role and permissions for ${playerName}`);
        }
      }

      // Return success response with user data
      return {
        success: true,
        token,
        user: {
          username: playerName,
          role,
          permissionLevel,
          authenticated: now.toISOString(),
        },
      };
    } catch (error) {
      // Log error details
      log(`Token authentication error: ${error.message}`);
      log(`Stack: ${error.stack}`);

      // Return error response
      return {
        success: false,
        error: "Authentication failed: " + error.message,
      };
    }
  }

  @Socket("get_sessions")
  @Permission("player")
  async getSessions({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { playerName } = params;
      const sessionsResult = await kv.get(
        this.KEYS.PLAYER.SESSIONS(playerName),
      );
      const sessions = sessionsResult.value || {};

      return {
        success: true,
        data: Object.values(sessions)
          .sort((a: any, b: any) =>
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
          ),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("get_current_session")
  @Permission("player")
  async getCurrentSession({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { playerName } = params;
      const currentSessionResult = await kv.get(
        this.KEYS.PLAYER.CURRENT_SESSION(playerName),
      );
      if (!currentSessionResult.value) {
        return {
          success: true,
          data: null,
        };
      }

      const sessionId = currentSessionResult.value;
      const sessionsResult = await kv.get(
        this.KEYS.PLAYER.SESSIONS(playerName),
      );
      const sessions = sessionsResult.value || {};
      const sessionData = sessions[sessionId];

      return {
        success: true,
        data: sessionData,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
