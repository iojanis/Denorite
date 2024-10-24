import { Module, Command, Description, Permission, Socket, Argument, Event } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

@Module({
  name: 'Sessions',
  version: '1.0.3'
})
export class Sessions {
  private generateTicket(length: number = 5): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let ticket = '';
    for (let i = 0; i < length; i++) {
      ticket += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return ticket;
  }

  @Event('player_joined')
  async handlePlayerJoined({ params, kv, log }: ScriptContext): Promise<void> {
    const { playerId, playerName, x, y, z, dimension } = params;

    log(`Player joined: ${playerName} (ID: ${playerId})`);

    try {
      const now = new Date().toISOString();

      // Store player ID/name mappings
      await kv.atomic()
        .set(['playerNameToId', playerName], playerId)
        .set(['playerIdToName', playerId], playerName)
        .commit();

      // Generate and store new player ticket
      const playerTicket = this.generateTicket();
      await kv.set(['tickets', 'player', playerTicket], playerName);
      await kv.set(['tickets', 'playerName', playerName], playerTicket);

      // Generate and store new admin ticket
      const adminTicket = this.generateTicket();
      await kv.set(['tickets', 'admin'], adminTicket);

      log(`Generated new tickets - Player: ${playerTicket}, Admin: ${adminTicket}`);

      // Initialize or update player data
      const firstJoinResult = await kv.get<string>(['player', playerName, 'firstJoin']);
      const loginCountResult = await kv.get<number>(['player', playerName, 'loginCount']);

      if (!firstJoinResult.value) {
        // New player
        await kv.set(['player', playerName, 'firstJoin'], now);
        await kv.set(['player', playerName, 'totalPlayTime'], 0);
        await kv.set(['player', playerName, 'loginCount'], 1);
        log(`New player registered: ${playerName} (ID: ${playerId})`);
      } else {
        // Existing player
        await kv.set(['player', playerName, 'loginCount'], (loginCountResult.value || 0) + 1);
        log(`Updated existing player data for ${playerName} (ID: ${playerId})`);
      }

      await kv.set(['player', playerName, 'lastSeen'], now);

      const sessionData = {
        startTime: now,
        startLocation: { x, y, z, dimension }
      };

      const sessionId = crypto.randomUUID();
      await kv.set(['player', playerName, 'sessions', sessionId], sessionData);
      await kv.set(['player', playerName, 'currentSession'], sessionId);

    } catch (error) {
      log(`Error in handlePlayerJoined for ${playerName} (ID: ${playerId}): ${error}`);
    }
  }

  @Event('player_left')
  async handlePlayerLeft({ params, kv, log }: ScriptContext): Promise<void> {
    const { playerId, playerName, x, y, z, dimension } = params;

    log(`Player left: ${playerName} (ID: ${playerId})`);

    try {
      const now = new Date().toISOString();

      // Retrieve current session ID
      const currentSessionResult = await kv.get<string>(['player', playerName, 'currentSession']);
      if (!currentSessionResult.value) {
        log(`No current session found for player ${playerName} (ID: ${playerId})`);
        return;
      }

      const sessionId = currentSessionResult.value;

      // Retrieve and update session data
      const sessionDataResult = await kv.get(['player', playerName, 'sessions', sessionId]);
      if (!sessionDataResult.value) {
        log(`No session data found for player ${playerName} (ID: ${playerId}, Session ID: ${sessionId})`);
        return;
      }

      const sessionData = sessionDataResult.value;
      sessionData.endTime = now;
      sessionData.endLocation = { x, y, z, dimension };
      sessionData.duration = (new Date(now).getTime() - new Date(sessionData.startTime).getTime()) / 1000; // in seconds

      await kv.set(['player', playerName, 'sessions', sessionId], sessionData);
      log(`Updated session data for player ${playerName} (ID: ${playerId}, Session ID: ${sessionId})`);

      // Update player data
      await kv.set(['player', playerName, 'lastSeen'], now);
      const totalPlayTimeResult = await kv.get<number>(['player', playerName, 'totalPlayTime']);
      await kv.set(['player', playerName, 'totalPlayTime'], (totalPlayTimeResult.value || 0) + sessionData.duration);

      log(`Updated player data for ${playerName} (ID: ${playerId})`);

      // Remove current session
      await kv.delete(['player', playerName, 'currentSession']);

    } catch (error) {
      log(`Error in handlePlayerLeft for ${playerName} (ID: ${playerId}): ${error}`);
    }
  }

  @Socket('ticket_module')
  async ticketLogin({ params, kv, auth, log }: ScriptContext): Promise<void> {
    try {
      const { ticket, socket } = params;
      log(`Received ticket login request - Ticket: ${ticket}, Socket ID: ${socket?.id}`);

      // Validate required parameters
      if (!ticket || !socket?.id) {
        log(`Invalid request parameters - Ticket: ${ticket}, Socket ID: ${socket?.id}`);
        if (socket) {
          socket.send(JSON.stringify({
            type: 'authenticated',
            success: false,
            message: 'Invalid request: ticket is required'
          }));
        }
        return;
      }

      // Check admin ticket
      const adminTicketResult = await kv.get(['tickets', 'admin']);
      log(`Admin ticket check - Admin ticket in DB: ${adminTicketResult.value}, Provided ticket: ${ticket}`);

      const isAdminTicket = adminTicketResult.value === ticket;

      if (isAdminTicket) {
        log(`Admin ticket matched. Attempting to store pending status for socket ID: ${socket.id}`);

        try {
          log(`Setting KV with key ['tickets', 'pending_admin_socket', '${socket.id}'] and value 1`);
          await kv.set(['tickets', 'pending_admin_socket', socket.id], 1);
          log('Successfully stored pending admin status');
        } catch (kvError) {
          log(`Error storing pending admin status: ${kvError}`);
          throw kvError;
        }

        socket.send(JSON.stringify({
          type: 'admin_validated',
          message: 'Please provide player ticket for operator access'
        }));
        return;
      }

      // Check for pending admin validation
      log(`Checking pending admin status for socket ID: ${socket.id}`);
      const isPendingAdmin = await kv.get(['tickets', 'pending_admin_socket', socket.id]);
      log(`Pending admin status: ${JSON.stringify(isPendingAdmin.value)}`);

      // Look up player by ticket
      log(`Looking up player for ticket: ${ticket}`);
      const playerName = await kv.get(['tickets', 'player', ticket]);
      log(`Player lookup result: ${JSON.stringify(playerName.value)}`);

      if (!playerName.value) {
        log('No player found for ticket');
        socket.send(JSON.stringify({
          type: 'authenticated',
          success: false,
          message: 'Invalid ticket'
        }));
        return;
      }

      // Get player ID
      log(`Getting player ID for name: ${playerName.value}`);
      const playerId = await auth.getPlayerIdFromName(playerName.value);
      log(`Player ID result: ${playerId}`);

      if (!playerId) {
        log('Player ID not found');
        socket.send(JSON.stringify({
          type: 'authenticated',
          success: false,
          message: 'Player not found'
        }));
        return;
      }

      // Check if player already has operator role
      const playerRoleResult = await kv.get(['player', playerName.value, 'role']);
      const existingRole = playerRoleResult.value || 'player';
      const isExistingOperator = existingRole === 'operator';

      log(`Player role check - Existing role: ${existingRole}, Is pending admin: ${isPendingAdmin.value === 1}`);

      // Determine final role and permission level
      const isOperator = isPendingAdmin.value === 1 || isExistingOperator;
      const role = isOperator ? 'operator' : 'player';
      const permissionLevel = isOperator ? 4 : 1;

      // Store the role if it's being elevated
      if (isPendingAdmin.value === 1) {
        await kv.set(['player', playerName.value, 'role'], role);
        log(`Updated player role to ${role}`);
      }

      log(`Creating token payload with role: ${role}, permissionLevel: ${permissionLevel}`);
      const tokenPayload = {
        id: playerId,
        name: playerName.value,
        role,
        permissionLevel
      };

      log('Generating auth token');
      const token = await auth.createToken(tokenPayload);

      if (isPendingAdmin.value === 1) {
        log('Cleaning up pending admin status');
        await kv.delete(['tickets', 'pending_admin_socket', socket.id]);
      }

      log('Sending success response');
      socket.send(JSON.stringify({
        type: 'authenticated',
        success: true,
        token,
        user: {
          username: playerName.value,
          role,
          permissionLevel
        },
        message: `Authenticated as ${playerName.value} (${role})`
      }));

    } catch (error) {
      log(`Error in ticketLogin: ${error}`);
      log(`Error stack: ${(error as Error).stack}`);
      if (params.socket) {
        params.socket.send(JSON.stringify({
          type: 'authenticated',
          success: false,
          message: 'Authentication failed: ' + (error instanceof Error ? error.message : 'Unknown error')
        }));
      }
    }
  }

  @Command(['playtime'])
  @Socket('playtime')
  @Description('View your total playtime')
  @Permission('player')
  async playtimeCommand({ params, kv, api, sendToPlayer }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      console.dir(params)
      const totalPlayTimeResult = await kv.get<number>(['player', sender, 'totalPlayTime']);

      console.dir(totalPlayTimeResult.value)

      if (!totalPlayTimeResult.value) {
        await api.executeCommand(`tellraw ${sender} {"text":"No playtime data found.","color":"red"}`);
        return;
      }

      // sendToPlayer()

      const totalPlayTime = totalPlayTimeResult.value;
      const hours = Math.floor(totalPlayTime / 3600);
      const minutes = Math.floor((totalPlayTime % 3600) / 60);

      await api.executeCommand(`tellraw ${sender} {"text":"Total playtime: ${hours}h ${minutes}m","color":"green"}`);
    } catch (error) {
      await api.executeCommand(`tellraw ${sender} {"text":"Error retrieving playtime data.","color":"red"}`);
    }
  }
}
