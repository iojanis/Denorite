import { Module, Command, Description, Permission, Socket, Argument, Event } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

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

@Module({
  name: 'Sessions',
  version: '1.1.2',
  // description: 'Advanced session management with secure tickets'
})
export class Sessions {
  private readonly TICKET_EXPIRY = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_SESSIONS_STORED = 10;

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateTicket(length: number = 5): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let ticket = '';
    for (let i = 0; i < length; i++) {
      ticket += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return ticket;
  }

  private async cleanupOldSessions(kv: any, playerName: string): Promise<void> {
    const sessionsResult = await kv.get(['player', playerName, 'sessions']);
    const sessions = sessionsResult.value || {};

    const sessionIds = Object.keys(sessions);
    if (sessionIds.length > this.MAX_SESSIONS_STORED) {
      const sortedSessions = sessionIds
        .map(id => ({ id, startTime: new Date(sessions[id].startTime).getTime() }))
        .sort((a, b) => b.startTime - a.startTime);

      const toDelete = sortedSessions.slice(this.MAX_SESSIONS_STORED);
      for (const session of toDelete) {
        await kv.delete(['player', playerName, 'sessions', session.id]);
      }
    }
  }

  private formatTicketMessage(ticket: string): string {
    // Create a message with obfuscated ticket that reveals on hover
    return JSON.stringify([
      {
        text: "Your login ticket (valid for 30 minutes):\n",
        color: "gold"
      },
      {
        text: "[ ",
        color: "white"
      },
      {
        text: "█████",  // Visible placeholder
        color: "green",
        obfuscated: true,
        hoverEvent: {
          action: "show_text",
          value: {
            text: ticket,
            color: "green",
            bold: true
          }
        },
        clickEvent: {
          action: "copy_to_clipboard",
          value: ticket
        }
      },
      {
        text: " ]",
        color: "white"
      },
      {
        text: "\nHover to reveal • Click to copy",
        color: "gray",
        italic: true
      },
      {
        text: "\nKeep this ticket secure - it provides access to your account!",
        color: "red",
        italic: true
      }
    ]);
  }

  private async updatePlayerStats(kv: any, playerName: string, updates: Partial<PlayerStats>): Promise<void> {
    const result = await kv.get(['player', playerName, 'stats']);
    const currentStats = result.value || {};
    await kv.set(['player', playerName, 'stats'], { ...currentStats, ...updates });
  }

  @Event('player_joined')
  async handlePlayerJoined({ params, kv, log, api }: ScriptContext): Promise<void> {
    const { playerId, playerName, x, y, z, dimension } = params;
    const adminUsername = Deno.env.get('DENORITE_ADMIN_USER');
    const isAdmin = playerName === adminUsername;

    try {
      const now = new Date().toISOString();
      log(`Player joined: ${playerName} (ID: ${playerId})`);

      // Store player ID/name mappings atomically
      const mappingResult = await kv.atomic()
        .set(['playerNameToId', playerName], playerId)
        .set(['playerIdToName', playerId], playerName)
        .commit();

      if (!mappingResult.ok) {
        throw new Error('Failed to store player mappings');
      }

      // Generate tickets with expiry
      const playerTicket = this.generateTicket();
      const adminTicket = this.generateTicket();
      const expiryTime = new Date(Date.now() + this.TICKET_EXPIRY).toISOString();

      await kv.atomic()
        .set(['tickets', 'player', playerTicket], { playerName, expiryTime })
        .set(['tickets', 'playerName', playerName], { ticket: playerTicket, expiryTime })
        .set(['tickets', 'admin'], { ticket: adminTicket, expiryTime })
        .commit();

      log(`Generated new tickets for ${playerName} (expires: ${expiryTime}) admin ticket: ${adminTicket}`);

      // Initialize or update player stats
      const statsResult = await kv.get(['player', playerName, 'stats']);
      const stats = statsResult.value || {};

      if (!stats.firstJoin) {
        // New player initialization
        await this.updatePlayerStats(kv, playerName, {
          firstJoin: now,
          lastSeen: now,
          totalPlayTime: 0,
          loginCount: 1
        });

        // Welcome new player
        await api.tellraw(playerName, JSON.stringify({
          text: "Welcome to the server! This appears to be your first visit.",
          color: "light_purple",
          bold: true
        }));
      } else {
        // Update existing player stats
        await this.updatePlayerStats(kv, playerName, {
          lastSeen: now,
          loginCount: (stats.loginCount || 0) + 1
        });

        // Welcome back message
        const lastSeen = new Date(stats.lastSeen).toLocaleString();
        await api.tellraw(playerName, JSON.stringify({
          text: `Welcome back! Last seen: ${lastSeen}`,
          color: "aqua"
        }));
      }

      // Create new session
      const sessionId = crypto.randomUUID();
      const sessionData: SessionData = {
        startTime: now,
        startLocation: { x, y, z, dimension },
        clientInfo: {
          ip: params.ip || 'unknown',
          version: params.version || 'unknown'
        }
      };

      await kv.atomic()
        .set(['player', playerName, 'sessions', sessionId], sessionData)
        .set(['player', playerName, 'currentSession'], sessionId)
        .commit();

      // Clean up old sessions
      await this.cleanupOldSessions(kv, playerName);

      // Send tickets with delay to ensure client is ready
      await this.delay(100);

      if (isAdmin) {
        // Send both tickets to admin
        await api.tellraw(playerName, JSON.stringify({
          text: "\n=== ADMIN ACCESS ===",
          color: "dark_red",
          bold: true
        }));

        // Send player ticket
        await api.tellraw(playerName, this.formatTicketMessage(playerTicket));

        // Send admin ticket
        await api.tellraw(playerName, JSON.stringify({
          text: "\nADMIN TICKET:",
          color: "dark_red",
          bold: true
        }));
        await api.tellraw(playerName, this.formatTicketMessage(adminTicket));
      } else {
        // Send only player ticket to regular players
        await api.tellraw(playerName, this.formatTicketMessage(playerTicket));
      }

      // Send session info
      await api.tellraw(playerName, JSON.stringify({
        text: `Session started: ${new Date(now).toLocaleString()}`,
        color: "gray",
        italic: true
      }));

    } catch (error) {
      log(`Error in handlePlayerJoined for ${playerName}: ${error.message}`);
      log(`Stack: ${error.stack}`);
    }
  }

  @Event('player_left')
  async handlePlayerLeft({ params, kv, log }: ScriptContext): Promise<void> {
    const { playerId, playerName, x, y, z, dimension } = params;

    try {
      const now = new Date().toISOString();

      // Get current session
      const currentSessionResult = await kv.get<string>(['player', playerName, 'currentSession']);
      if (!currentSessionResult.value) {
        log(`No active session found for ${playerName}`);
        return;
      }

      const sessionId = currentSessionResult.value;
      const sessionResult = await kv.get(['player', playerName, 'sessions', sessionId]);
      const sessionData = sessionResult.value as SessionData;

      if (!sessionData) {
        log(`No session data found for ${playerName} (Session: ${sessionId})`);
        return;
      }

      // Update session data
      const duration = (new Date(now).getTime() - new Date(sessionData.startTime).getTime()) / 1000;
      const updatedSession: SessionData = {
        ...sessionData,
        endTime: now,
        endLocation: { x, y, z, dimension },
        duration
      };

      // Update player stats with new playtime
      const statsResult = await kv.get(['player', playerName, 'stats']);
      const stats = statsResult.value || {};
      const totalPlayTime = (stats.totalPlayTime || 0) + duration;

      // Atomic update of session and stats
      await kv.atomic()
        .set(['player', playerName, 'sessions', sessionId], updatedSession)
        .set(['player', playerName, 'stats'], { ...stats, totalPlayTime, lastSeen: now })
        .delete(['player', playerName, 'currentSession'])
        .commit();

      log(`Session ended for ${playerName} - Duration: ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`);

    } catch (error) {
      log(`Error in handlePlayerLeft for ${playerName}: ${error.message}`);
      log(`Stack: ${error.stack}`);
    }
  }

  @Socket('ticket_module')
  async ticketLogin({ params, kv, auth, log }: ScriptContext): Promise<void> {
    const { ticket, socket } = params;

    try {
      if (!ticket || !socket?.id) {
        throw new Error('Invalid request parameters');
      }

      // Check ticket expiry
      const now = new Date();
      const adminTicketData = await kv.get(['tickets', 'admin']);
      const playerTicketData = await kv.get(['tickets', 'player', ticket]);

      const isAdmin = adminTicketData.value?.ticket === ticket;
      const ticketData = isAdmin ? adminTicketData.value : playerTicketData.value;

      if (!ticketData || new Date(ticketData.expiryTime) < now) {
        socket.send(JSON.stringify({
          type: 'authenticated',
          success: false,
          message: 'Ticket expired or invalid'
        }));
        return;
      }

      if (isAdmin) {
        await kv.set(['tickets', 'pending_admin_socket', socket.id], { timestamp: now.toISOString() });
        socket.send(JSON.stringify({
          type: 'admin_validated',
          message: 'Please provide player ticket for operator access'
        }));
        return;
      }

      const isPendingAdmin = await kv.get(['tickets', 'pending_admin_socket', socket.id]);
      const playerName = ticketData.playerName;
      const playerId = await auth.getPlayerIdFromName(playerName);

      if (!playerId) {
        throw new Error('Player not found');
      }

      // Determine role and permissions
      const statsResult = await kv.get(['player', playerName, 'stats']);
      const stats = statsResult.value || {};
      const existingRole = stats.role || 'player';
      const isOperator = isPendingAdmin.value || existingRole === 'operator';
      const role = isOperator ? 'operator' : 'player';
      const permissionLevel = isOperator ? 4 : 1;

      await kv.set(['player', playerName, 'role'], role)
      await kv.set(['player', playerName, 'permissionLevel'], permissionLevel)

      // Update role if elevated
      if (isPendingAdmin.value) {
        await this.updatePlayerStats(kv, playerName, { role });
      }

      // Generate token
      const token = await auth.createToken({
        id: playerId,
        name: playerName,
        role,
        permissionLevel
      });

      // Cleanup
      if (isPendingAdmin.value) {
        await kv.delete(['tickets', 'pending_admin_socket', socket.id]);
      }

      socket.send(JSON.stringify({
        type: 'authenticated',
        success: true,
        token,
        user: { username: playerName, role, permissionLevel },
        message: `Authenticated as ${playerName} (${role})`
      }));

    } catch (error) {
      log(`Error in ticketLogin: ${error.message}`);
      log(`Stack: ${error.stack}`);

      if (socket) {
        socket.send(JSON.stringify({
          type: 'authenticated',
          success: false,
          message: 'Authentication failed: ' + error.message
        }));
      }
    }
  }

  @Command(['playtime'])
  @Description('View your playtime statistics')
  @Permission('player')
  async playtimeCommand({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const statsResult = await kv.get(['player', sender, 'stats']);
      const stats = statsResult.value || {};

      if (!stats.totalPlayTime) {
        await api.tellraw(sender, JSON.stringify({
          text: "No playtime data found.",
          color: "red"
        }));
        return;
      }

      const totalPlayTime = stats.totalPlayTime;
      const hours = Math.floor(totalPlayTime / 3600);
      const minutes = Math.floor((totalPlayTime % 3600) / 60);
      const firstJoinDate = new Date(stats.firstJoin).toLocaleDateString();
      const loginCount = stats.loginCount || 0;

      await api.tellraw(sender, JSON.stringify([
        { text: "=== Playtime Statistics ===\n", color: "gold", bold: true },
        { text: `Total Playtime: ${hours}h ${minutes}m\n`, color: "green" },
        { text: `First Join: ${firstJoinDate}\n`, color: "aqua" },
        { text: `Login Count: ${loginCount}`, color: "yellow" }
      ]));

    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: "Error retrieving playtime data.",
        color: "red"
      }));
    }
  }

  @Socket('playtime')
  async getPlaytimeStats({ params, kv, auth }: ScriptContext): Promise<any> {
    try {
      const { playerName } = params;
      const statsResult = await kv.get(['player', playerName, 'stats']);
      const stats = statsResult.value || {};

      return {
        success: true,
        data: {
          totalPlayTime: stats.totalPlayTime || 0,
          firstJoin: stats.firstJoin,
          lastSeen: stats.lastSeen,
          loginCount: stats.loginCount || 0
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
