import { Module, Command, Description, Permission, Socket, Argument, Event } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface TeamData {
  id: string;           // Slug of team name
  name: string;         // Display name
  leader: string;       // Player name of leader
  officers: string[];   // Player names of officers
  members: string[];    // Player names of regular members
  color: string;        // Team color (set by operators)
  createdAt: string;    // ISO date string
  balance: number;      // Team XPL balance
}

interface TeamOperationQueue {
  type: 'add' | 'remove' | 'promote' | 'demote' | 'leave';
  teamId: string;
  player: string;
  timestamp: string;
}

@Module({
  name: 'Teams',
  version: '1.0.1',
  description: 'Team management with economy and Leukocyte integration'
})
export class Teams {
  private readonly TEAM_CREATION_COST = 1;  // XPL cost to create a team
  private readonly VALID_COLORS = ['aqua', 'black', 'blue', 'dark_aqua', 'dark_blue', 'dark_gray', 'dark_green',
    'dark_purple', 'dark_red', 'gold', 'gray', 'green', 'light_purple', 'red', 'white', 'yellow'];

  private createSlug(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async getPlayerTeam(kv: any, playerName: string): Promise<string | null> {
    const result = await kv.get(['players', playerName, 'team']);
    return result.value;
  }

  private async setupTeamProtection(api: any, teamId: string, teamName: string, color: string = 'white'): Promise<void> {
    try {
      // Create Minecraft team
      await api.executeCommand(`team add ${teamId} {"text":"${teamName}"}`);
      await api.executeCommand(`team modify ${teamId} color ${color}`);
      await api.executeCommand(`team modify ${teamId} friendlyFire false`);
      await api.executeCommand(`team modify ${teamId} nametagVisibility hideForOtherTeams`);
      await api.executeCommand(`team modify ${teamId} seeFriendlyInvisibles true`);
    } catch (error) {
      // Cleanup on failure
      try {
        await api.executeCommand(`team remove ${teamId}`);
      } catch {} // Ignore cleanup errors
      throw new Error(`Failed to setup team: ${error.message}`);
    }
  }

  private async updatePlayerTeam(api: any, teamId: string | null, playerName: string, oldTeamId?: string): Promise<void> {
    try {
      // Remove from old team if applicable
      if (oldTeamId) {
        await api.executeCommand(`team leave ${playerName}`);
      }

      // Add to new team if applicable
      if (teamId) {
        await api.executeCommand(`team join ${teamId} ${playerName}`);
      }
    } catch (error) {
      throw new Error(`Failed to update player team: ${error.message}`);
    }
  }

  private async removeTeamProtection(api: any, teamId: string): Promise<void> {
    try {
      await api.executeCommand(`team remove ${teamId}`);
    } catch (error) {
      throw new Error(`Failed to remove team: ${error.message}`);
    }
  }

  private async processQueuedOperations(kv: any, api: any, playerName: string): Promise<void> {
    const queueResult = await kv.get(['teams', 'operations', playerName]);
    const operations = queueResult.value as TeamOperationQueue[] || [];

    if (operations.length === 0) return;

    for (const op of operations) {
      const teamResult = await kv.get(['teams', op.teamId]);
      const team = teamResult.value as TeamData;

      if (!team) continue;

      switch (op.type) {
        case 'add':
          team.members.push(playerName);
          await this.updatePlayerTeam(api, op.teamId, playerName);
          break;
        case 'remove':
          team.members = team.members.filter(p => p !== playerName);
          team.officers = team.officers.filter(p => p !== playerName);
          await this.updatePlayerTeam(api, null, playerName, op.teamId);
          break;
        case 'promote':
          if (!team.officers.includes(playerName)) {
            team.officers.push(playerName);
          }
          break;
        case 'demote':
          team.officers = team.officers.filter(p => p !== playerName);
          break;
      }

      await kv.set(['teams', op.teamId], team);
    }

    await kv.delete(['teams', 'operations', playerName]);
  }

  @Event('player_joined')
  async handlePlayerJoin({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { playerName } = params;

    try {
      await this.delay(1000);

      await this.processQueuedOperations(kv, api, playerName);

      const teamId = await this.getPlayerTeam(kv, playerName);
      if (teamId) {
        const teamResult = await kv.get(['teams', teamId]);
        const team = teamResult.value as TeamData;

        if (team && team.members.includes(playerName)) {
          await this.updatePlayerTeam(api, teamId, playerName);
          await api.tellraw(playerName, JSON.stringify({
            text: `Welcome back to team ${team.name}!`,
            color: team.color || 'white'
          }));
        }
      }
    } catch (error) {
      log(`Error in handlePlayerJoin for ${playerName}: ${error.message}`);
    }
  }

  @Command(['teams'])
  @Description('Team management commands')
  @Permission('player')
  async teams({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(sender, JSON.stringify([
        { text: "=== Team Commands ===\n", color: "gold", bold: true },

        { text: "/teams create <name>", color: "yellow" },
        { text: " - Create a new team (costs 1 XPL)\n", color: "gray" },

        {
          text: "/teams info",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/teams info"
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view team info"
          }
        },
        { text: " - View your team's information\n", color: "gray" },

        {
          text: "/teams list",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/teams list"
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to list all teams"
          }
        },
        { text: " - List all teams\n", color: "gray" },

        { text: "/teams invite <player>", color: "yellow" },
        { text: " - Invite a player to your team\n", color: "gray" },

        { text: "/teams join <teamId>", color: "yellow" },
        { text: " - Join a team after being invited\n", color: "gray" },

        {
          text: "/teams leave",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/teams leave"
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to leave your team"
          }
        },
        { text: " - Leave your current team\n", color: "gray" },

        { text: "/teams promote <player>", color: "yellow" },
        { text: " - Promote a team member to officer\n", color: "gray" },

        { text: "/teams demote <player>", color: "yellow" },
        { text: " - Demote a team officer to member\n", color: "gray" },

        { text: "/teams transfer <player>", color: "yellow" },
        { text: " - Transfer team leadership\n", color: "gray" },

        { text: "/teams kick <player>", color: "yellow" },
        { text: " - Kick a player from your team\n", color: "gray" },

        { text: "/teams deposit <amount>", color: "yellow" },
        { text: " - Deposit XPL into team bank\n", color: "gray" },

        { text: "/teams withdraw <amount>", color: "yellow" },
        { text: " - Withdraw XPL from team bank\n", color: "gray" },

        { text: "\nOperator Commands:\n", color: "gold" },
        { text: "/teams color <team> <color>", color: "yellow" },
        { text: " - Set team color", color: "gray" },

        { text: "\n\n", color: "white" },
        {
          text: "[Suggest Command]",
          color: "green",
          clickEvent: {
            action: "suggest_command",
            value: "/teams "
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to write a team command"
          }
        }
      ]));

      return { messages };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['teams', 'create'])
  @Description('Create a new team (costs 1 XPL)')
  @Permission('player')
  @Argument([
    { name: 'name', type: 'string', description: 'Team name' }
  ])
  async createTeam({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const teamName = args.name;
    const teamId = this.createSlug(teamName);

    try {
      const currentTeam = await this.getPlayerTeam(kv, sender);
      if (currentTeam) {
        throw new Error('You are already in a team');
      }

      const existingTeam = await kv.get(['teams', teamId]);
      if (existingTeam.value) {
        throw new Error('A team with this name already exists');
      }

      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (balance < this.TEAM_CREATION_COST) {
        throw new Error(`You need ${this.TEAM_CREATION_COST} XPL to create a team`);
      }

      // Setup team protection in Leukocyte
      await this.setupTeamProtection(api, teamId, teamName);

      const team: TeamData = {
        id: teamId,
        name: teamName,
        leader: sender,
        officers: [],
        members: [sender],
        color: 'white',
        createdAt: new Date().toISOString(),
        balance: 0
      };

      const result = await kv.atomic()
        .check(existingTeam)
        .set(['teams', teamId], team)
        .set(['players', sender, 'team'], teamId)
        .mutate({
          type: 'sum',
          key: ['plugins', 'economy', 'balances', sender],
          value: new Deno.KvU64(BigInt(balance-this.TEAM_CREATION_COST))
        })
        .commit();

      if (!result.ok) {
        await this.removeTeamProtection(api, teamId);
        throw new Error('Failed to create team');
      }

      // Add leader to team protection
      await this.updatePlayerTeam(api, teamId, sender);

      await api.tellraw(sender, JSON.stringify([
        { text: "Team created successfully!\n", color: "green" },
        { text: `Name: `, color: "gray" },
        { text: teamName, color: "white" },
        { text: "\nCost: ", color: "gray" },
        { text: `${this.TEAM_CREATION_COST} XPL`, color: "gold" }
      ]));

      log(`Player ${sender} created team ${teamName} (${teamId})`);
    } catch (error) {
      log(`Error creating team by ${sender}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'invite'])
  @Description('Invite a player to your team')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to invite' }
  ])
  async invitePlayer({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender && !team.officers.includes(sender)) {
        throw new Error('Only team leaders and officers can invite players');
      }

      const targetTeam = await this.getPlayerTeam(kv, targetPlayer);
      if (targetTeam) {
        throw new Error('This player is already in a team');
      }

      await api.tellraw(targetPlayer, JSON.stringify([
        { text: "Team Invitation\n", color: "gold", bold: true },
        { text: `${sender} has invited you to join `, color: "yellow" },
        { text: team.name, color: team.color },
        { text: "\n\n" },
        {
          text: "[Accept]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: `/teams join ${team.id}`
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to join team"
          }
        },
        { text: " " },
        {
          text: "[Decline]",
          color: "red",
          clickEvent: {
            action: "run_command",
            value: `/teams decline ${team.id}`
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to decline invitation"
          }
        }
      ]));

      await api.tellraw(sender, JSON.stringify({
        text: `Invitation sent to ${targetPlayer}`,
        color: "green"
      }));

      log(`${sender} invited ${targetPlayer} to team ${team.name}`);
    } catch (error) {
      log(`Error in team invite: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'decline'])
  @Description('Decline a team invitation')
  @Permission('player')
  @Argument([
    { name: 'teamId', type: 'string', description: 'Team ID to decline' }
  ])
  async declineInvite({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const teamId = args.teamId;

    try {
      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error('Team not found');
      }

      await api.tellraw(sender, JSON.stringify({
        text: `You declined the invitation to join ${team.name}`,
        color: "yellow"
      }));

      await api.tellraw(team.leader, JSON.stringify({
        text: `${sender} declined the team invitation`,
        color: "yellow"
      }));

      log(`${sender} declined invitation to team ${team.name}`);
    } catch (error) {
      log(`Error declining team invite: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'join'])
  @Description('Join a team after being invited')
  @Permission('player')
  @Argument([
    { name: 'teamId', type: 'string', description: 'Team ID to join' }
  ])
  async joinTeam({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const teamId = args.teamId;

    try {
      const currentTeam = await this.getPlayerTeam(kv, sender);
      if (currentTeam) {
        throw new Error('You are already in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error('Team not found');
      }

      team.members.push(sender);

      const result = await kv.atomic()
        .set(['teams', teamId], team)
        .set(['players', sender, 'team'], teamId)
        .commit();

      if (!result.ok) {
        throw new Error('Failed to join team');
      }

      await this.updatePlayerTeam(api, teamId, sender);

      for (const member of team.members) {
        await api.tellraw(member, JSON.stringify({
          text: `${sender} has joined the team!`,
          color: team.color
        }));
      }

      log(`${sender} joined team ${team.name}`);
    } catch (error) {
      log(`Error in team join: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'leave'])
  @Description('Leave your current team')
  @Permission('player')
  async leaveTeam({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader === sender && team.members.length > 1) {
        throw new Error('Team leaders must transfer leadership before leaving');
      }

      team.members = team.members.filter(m => m !== sender);
      team.officers = team.officers.filter(o => o !== sender);

      if (team.members.length === 0) {
        await kv.atomic()
          .delete(['teams', teamId])
          .delete(['players', sender, 'team'])
          .commit();

        await this.removeTeamProtection(api, teamId);

        await api.tellraw(sender, JSON.stringify({
          text: "You left the team. Team has been disbanded as it is now empty.",
          color: "yellow"
        }));
      } else {
        await kv.atomic()
          .set(['teams', teamId], team)
          .delete(['players', sender, 'team'])
          .commit();

        await this.updatePlayerTeam(api, null, sender, teamId);

        for (const member of team.members) {
          await api.tellraw(member, JSON.stringify({
            text: `${sender} has left the team`,
            color: team.color
          }));
        }
      }

      log(`${sender} left team ${team.name}`);
    } catch (error) {
      log(`Error in team leave: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'promote'])
  @Description('Promote a team member to officer')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to promote' }
  ])
  async promotePlayer({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error('Only team leaders can promote members');
      }

      if (!team.members.includes(targetPlayer)) {
        throw new Error('This player is not in your team');
      }

      if (team.officers.includes(targetPlayer)) {
        throw new Error('This player is already an officer');
      }

      // Add to operations queue
      const operation: TeamOperationQueue = {
        type: 'promote',
        teamId,
        player: targetPlayer,
        timestamp: new Date().toISOString()
      };

      await kv.set(
        ['teams', 'operations', targetPlayer],
        [operation]
      );

      // Update immediately if player is online
      try {
        team.officers.push(targetPlayer);
        await kv.set(['teams', teamId], team);

        await api.tellraw(targetPlayer, JSON.stringify({
          text: `You have been promoted to team officer!`,
          color: team.color
        }));

        await api.tellraw(sender, JSON.stringify({
          text: `${targetPlayer} has been promoted to officer`,
          color: "green"
        }));
      } catch (error) {
        log(`Error in immediate promotion: ${error.message}`);
      }

      log(`${sender} promoted ${targetPlayer} to officer in team ${team.name}`);
    } catch (error) {
      log(`Error in team promotion: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'demote'])
  @Description('Demote a team officer to member')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to demote' }
  ])
  async demotePlayer({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error('Only team leaders can demote officers');
      }

      if (!team.officers.includes(targetPlayer)) {
        throw new Error('This player is not an officer');
      }

      // Add to operations queue
      const operation: TeamOperationQueue = {
        type: 'demote',
        teamId,
        player: targetPlayer,
        timestamp: new Date().toISOString()
      };

      await kv.set(
        ['teams', 'operations', targetPlayer],
        [operation]
      );

      // Update immediately if player is online
      try {
        team.officers = team.officers.filter(o => o !== targetPlayer);
        await kv.set(['teams', teamId], team);

        await api.tellraw(targetPlayer, JSON.stringify({
          text: `You have been demoted to team member`,
          color: team.color
        }));

        await api.tellraw(sender, JSON.stringify({
          text: `${targetPlayer} has been demoted to member`,
          color: "yellow"
        }));
      } catch (error) {
        log(`Error in immediate demotion: ${error.message}`);
      }

      log(`${sender} demoted ${targetPlayer} in team ${team.name}`);
    } catch (error) {
      log(`Error in team demotion: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'transfer'])
  @Description('Transfer team leadership to another member')
  @Permission('player')
  @Argument([
    { name: 'newLeader', type: 'player', description: 'Player to transfer leadership to' }
  ])
  async transferLeadership({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const newLeader = args.newLeader;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error('Only the team leader can transfer leadership');
      }

      if (!team.members.includes(newLeader)) {
        throw new Error('That player is not in your team');
      }

      // Update leadership
      team.leader = newLeader;
      if (!team.officers.includes(sender)) {
        team.officers.push(sender); // Make old leader an officer
      }

      await kv.set(['teams', teamId], team);

      // Notify team members
      for (const member of team.members) {
        await api.tellraw(member, JSON.stringify([
          { text: "Team leadership has been transferred\n", color: "gold" },
          { text: "New leader: ", color: "gray" },
          { text: newLeader, color: team.color }
        ]));
      }

      log(`${sender} transferred team ${team.name} leadership to ${newLeader}`);
    } catch (error) {
      log(`Error in leadership transfer: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'color'])
  @Description('Set team color (operators only)')
  @Permission('operator')
  @Argument([
    { name: 'team', type: 'string', description: 'Team ID' },
    { name: 'color', type: 'string', description: 'Team color' }
  ])
  async setTeamColor({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { args } = params;
    const { team: teamId, color } = args;

    try {
      if (!this.VALID_COLORS.includes(color)) {
        throw new Error(`Invalid color. Valid colors: ${this.VALID_COLORS.join(', ')}`);
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error('Team not found');
      }

      // Update both Minecraft team and data
      await api.executeCommand(`team modify ${teamId} color ${color}`);
      team.color = color;
      await kv.set(['teams', teamId], team);

      // Notify team members
      for (const member of team.members) {
        await api.tellraw(member, JSON.stringify({
          text: `Team color has been updated to ${color}`,
          color
        }));
      }

      log(`Team ${team.name} color set to ${color}`);
    } catch (error) {
      log(`Error setting team color: ${error.message}`);
      throw error;
    }
  }

  @Command(['teams', 'deposit'])
  @Description('Deposit XPL into team bank')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'Amount to deposit' }
  ])
  async depositToTeam({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const amount = args.amount;

    try {
      if (amount <= 0) {
        throw new Error('Amount must be positive');
      }

      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      // Check player balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const playerBalance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (playerBalance < amount) {
        throw new Error('Insufficient funds');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      // Update balances atomically
      const result = await kv.atomic()
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(playerBalance - amount)))
        .set(['teams', teamId], {
          ...team,
          balance: team.balance + amount
        })
        .commit();

      if (!result.ok) {
        throw new Error('Failed to process deposit');
      }

      // Notify team members
      for (const member of team.members) {
        await api.tellraw(member, JSON.stringify({
          text: `${sender} deposited ${amount} XPL to team bank`,
          color: "green"
        }));
      }

      log(`${sender} deposited ${amount} XPL to team ${team.name}`);
    } catch (error) {
      log(`Error in team deposit: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'info'])
  @Description('View team information')
  @Permission('player')
  async teamInfo({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      await api.tellraw(sender, JSON.stringify([
        { text: "=== Team Information ===\n", color: "gold", bold: true },
        { text: "Name: ", color: "gray" },
        { text: `${team.name}\n`, color: team.color },
        { text: "Leader: ", color: "gray" },
        { text: `${team.leader}\n`, color: "white" },
        { text: "Officers: ", color: "gray" },
        { text: `${team.officers.join(', ') || 'None'}\n`, color: "white" },
        { text: "Members: ", color: "gray" },
        { text: `${team.members.length}\n`, color: "white" },
        { text: "Balance: ", color: "gray" },
        { text: `${team.balance} XPL\n`, color: "gold" },
        { text: "Created: ", color: "gray" },
        { text: new Date(team.createdAt).toLocaleDateString(), color: "white" }
      ]));
    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'list'])
  @Description('List all teams')
  @Permission('player')
  async listTeams({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      // Fetch teams using Deno.KV list
      const teams = [];
      const entriesIterator = kv.list({ prefix: ['teams'] });
      for await (const entry of entriesIterator) {
        teams.push(entry.value);
      }

      if (teams.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "No teams have been created yet",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: "=== Teams List ===",
        color: "gold",
        bold: true
      }));

      for (const team of teams) {
        await api.tellraw(sender, JSON.stringify([
          { text: `\n${team.name}`, color: team.color, bold: true },
          { text: `\nLeader: ${team.leader}`, color: "white" },
          { text: `\nMembers: ${team.members.length}`, color: "gray" }
        ]));
      }
    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Socket('team_data')
  async getTeamData({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { playerName } = params;

      const teamId = await this.getPlayerTeam(kv, playerName);
      if (!teamId) {
        return { success: true, data: null };
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      return {
        success: true,
        data: {
          ...team,
          isLeader: team.leader === playerName,
          isOfficer: team.officers.includes(playerName)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Socket('list_teams')
  async getAllTeams({ kv }: ScriptContext): Promise<any> {
    try {
      const teamsResult = await kv.get(['teams']);
      return {
        success: true,
        data: teamsResult.value || []
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Socket('team_members')
  async getTeamMembers({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { teamId } = params;
      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        return {
          success: false,
          error: 'Team not found'
        };
      }

      return {
        success: true,
        data: {
          members: team.members,
          officers: team.officers,
          leader: team.leader
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Command(['teams', 'withdraw'])
  @Description('Withdraw XPL from team bank (leader only)')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'Amount to withdraw' }
  ])
  async withdrawFromTeam({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const amount = args.amount;

    try {
      if (amount <= 0) {
        throw new Error('Amount must be positive');
      }

      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error('Only the team leader can withdraw funds');
      }

      if (team.balance < amount) {
        throw new Error('Insufficient team funds');
      }

      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const playerBalance = balanceResult.value ? Number(balanceResult.value) : 0;

      // Update balances atomically
      const result = await kv.atomic()
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(playerBalance + amount)))
        .set(['teams', teamId], {
          ...team,
          balance: team.balance - amount
        })
        .commit();

      if (!result.ok) {
        throw new Error('Failed to process withdrawal');
      }

      // Notify team members
      for (const member of team.members) {
        await api.tellraw(member, JSON.stringify({
          text: `${sender} withdrew ${amount} XPL from team bank`,
          color: "yellow"
        }));
      }

      log(`${sender} withdrew ${amount} XPL from team ${team.name}`);
    } catch (error) {
      log(`Error in team withdrawal: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['teams', 'kick'])
  @Description('Kick a player from your team')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to kick' }
  ])
  async kickPlayer({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender && !team.officers.includes(sender)) {
        throw new Error('Only team leaders and officers can kick members');
      }

      if (!team.members.includes(targetPlayer)) {
        throw new Error('That player is not in your team');
      }

      if (team.leader === targetPlayer) {
        throw new Error('Cannot kick the team leader');
      }

      if (team.officers.includes(targetPlayer) && sender !== team.leader) {
        throw new Error('Only the team leader can kick officers');
      }

      // Add to operations queue
      const operation: TeamOperationQueue = {
        type: 'remove',
        teamId,
        player: targetPlayer,
        timestamp: new Date().toISOString()
      };

      await kv.set(
        ['teams', 'operations', targetPlayer],
        [operation]
      );

      // Update immediately if player is online
      try {
        team.members = team.members.filter(m => m !== targetPlayer);
        team.officers = team.officers.filter(o => o !== targetPlayer);
        await kv.set(['teams', teamId], team);
        await kv.delete(['players', targetPlayer, 'team']);

        await this.updatePlayerTeam(api, null, targetPlayer, teamId);

        await api.tellraw(targetPlayer, JSON.stringify({
          text: `You have been kicked from team ${team.name}`,
          color: "red"
        }));

        for (const member of team.members) {
          await api.tellraw(member, JSON.stringify({
            text: `${targetPlayer} has been kicked from the team`,
            color: "yellow"
          }));
        }
      } catch (error) {
        log(`Error in immediate kick: ${error.message}`);
      }

      log(`${sender} kicked ${targetPlayer} from team ${team.name}`);
    } catch (error) {
      log(`Error in team kick: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }
}
