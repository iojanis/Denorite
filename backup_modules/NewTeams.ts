import { Module, Command, Description, Permission, Argument, Event } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface TeamData {
  id: string;
  name: string;
  leader: string;
  officers: string[];
  members: string[];
  color: string;
  createdAt: string;
  balance: number;
}

interface TeamOperationQueue {
  type: 'add' | 'remove' | 'promote' | 'demote' | 'leave';
  teamId: string;
  player: string;
  timestamp: string;
}

@Module({
  name: 'Teams',
  version: '1.1.0',
  description: 'Team management with economy integration'
})
export class Teams {
  private readonly TEAM_CREATION_COST = 1;
  private readonly VALID_COLORS = ['aqua', 'black', 'blue', 'dark_aqua', 'dark_blue', 'dark_gray', 'dark_green',
    'dark_purple', 'dark_red', 'gold', 'gray', 'green', 'light_purple', 'red', 'white', 'yellow'];

  // Keep existing private helper methods...

  @Command(['teams'])
  @Description('Team management commands')
  @Permission('player')
  async teams({ params, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(sender, JSON.stringify([
        {text: "=== Team Commands ===\n", color: "gold", bold: true},
        {text: "/teams create <name>", color: "yellow"},
        {text: ` - Create a new team (costs ${this.TEAM_CREATION_COST} XPL)\n`, color: "gray"},
        // ... Rest of help menu formatting
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
  @Description('Create a new team')
  @Permission('player')
  @Argument([
    { name: 'name', type: 'string', description: 'Team name' }
  ])
  async createTeam({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean, team?: TeamData }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const currentTeam = await this.getPlayerTeam(kv, sender);
      if (currentTeam) {
        throw new Error('You are already in a team');
      }

      const teamId = this.createSlug(args.name);
      const existingTeam = await kv.get(['teams', teamId]);
      if (existingTeam.value) {
        throw new Error('A team with this name already exists');
      }

      // Check balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < this.TEAM_CREATION_COST) {
        throw new Error(`You need ${this.TEAM_CREATION_COST} XPL to create a team`);
      }

      // Create team
      const team: TeamData = {
        id: teamId,
        name: args.name,
        leader: sender,
        officers: [],
        members: [sender],
        color: 'white',
        createdAt: new Date().toISOString(),
        balance: 0
      };

      // Setup protection and process creation
      await this.setupTeamProtection(kv, teamId, args.name);

      const result = await kv.atomic()
        .check(existingTeam)
        .set(['teams', teamId], team)
        .set(['players', sender, 'team'], teamId)
        .mutate({
          type: 'sum',
          key: ['plugins', 'economy', 'balances', sender],
          value: new Deno.KvU64(BigInt(balance - this.TEAM_CREATION_COST))
        })
        .commit();

      if (!result.ok) {
        throw new Error('Failed to create team');
      }

      messages = await tellraw(sender, JSON.stringify([
        {text: "Team Created Successfully!\n", color: "green", bold: true},
        {text: "Name: ", color: "gray"},
        {text: args.name, color: "white"},
        {text: "\nCost: ", color: "gray"},
        {text: `${this.TEAM_CREATION_COST} XPL`, color: "gold"},
        {text: "\n\nUse ", color: "gray"},
        {
          text: "/teams invite <player>",
          color: "yellow",
          clickEvent: {
            action: "suggest_command",
            value: "/teams invite "
          }
        },
        {text: " to add members", color: "gray"}
      ]));

      log(`Player ${sender} created team ${args.name} (${teamId})`);
      return { messages, success: true, team };
    } catch (error) {
      log(`Error creating team: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }
  @Command(['teams', 'invite'])
  @Description('Invite a player to your team')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to invite' }
  ])
  async invitePlayer({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

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

      const targetTeam = await this.getPlayerTeam(kv, args.player);
      if (targetTeam) {
        throw new Error('This player is already in a team');
      }

      messages = await tellraw(args.player, JSON.stringify([
        {text: "⚡ Team Invitation ⚡\n", color: "gold", bold: true},
        {text: `${sender}`, color: "green"},
        {text: " has invited you to join ", color: "yellow"},
        {text: team.name, color: team.color, bold: true},
        {text: "\n\n"},
        {
          text: "[Accept]",
          color: "green",
          bold: true,
          clickEvent: {
            action: "run_command",
            value: `/teams join ${team.id}`
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to join team"
          }
        },
        {text: "   "},
        {
          text: "[Decline]",
          color: "red",
          bold: true,
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

      messages = await tellraw(sender, JSON.stringify({
        text: `Invitation sent to ${args.player}`,
        color: "green"
      }));

      log(`${sender} invited ${args.player} to team ${team.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in team invite: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['teams', 'join'])
  @Description('Join a team after being invited')
  @Permission('player')
  @Argument([
    { name: 'teamId', type: 'string', description: 'Team ID to join' }
  ])
  async joinTeam({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean, team?: TeamData }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const currentTeam = await this.getPlayerTeam(kv, sender);
      if (currentTeam) {
        throw new Error('You are already in a team');
      }

      const teamResult = await kv.get(['teams', args.teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error('Team not found');
      }

      // Update team data
      team.members.push(sender);
      const result = await kv.atomic()
        .check(teamResult)
        .set(['teams', args.teamId], team)
        .set(['players', sender, 'team'], args.teamId)
        .commit();

      if (!result.ok) {
        throw new Error('Failed to join team');
      }

      // Notify all members
      const baseMessage = {
        text: `${sender} has joined the team!`,
        color: team.color
      };

      messages = await Promise.all(
        team.members.map(member =>
          tellraw(member, JSON.stringify(baseMessage))
        )
      );

      log(`${sender} joined team ${team.name}`);
      return { messages, success: true, team };
    } catch (error) {
      log(`Error joining team: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['teams', 'info'])
  @Description('View team information')
  @Permission('player')
  async teamInfo({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], team?: TeamData }> {
    const { sender } = params;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      messages = await tellraw(sender, JSON.stringify([
        {text: "⚡ Team Information ⚡\n", color: "gold", bold: true},
        {text: "Name: ", color: "gray"},
        {text: `${team.name}\n`, color: team.color, bold: true},
        {text: "Leader: ", color: "gray"},
        {text: `${team.leader}\n`, color: "white"},
        {text: "Officers: ", color: "gray"},
        {text: `${team.officers.join(', ') || 'None'}\n`, color: "white"},
        {text: "Members: ", color: "gray"},
        {text: `${team.members.length}\n`, color: "white"},
        {text: "Balance: ", color: "gray"},
        {text: `${team.balance} XPL\n`, color: "gold"},
        {text: "Created: ", color: "gray"},
        {text: new Date(team.createdAt).toLocaleDateString(), color: "white"},
        {text: "\n\nActions:\n", color: "yellow", bold: true},
        team.leader === sender ? [
          {
            text: "[Manage Members]",
            color: "aqua",
            clickEvent: {
              action: "suggest_command",
              value: "/teams promote "
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to promote/demote members"
            }
          },
          {text: "  "},
          {
            text: "[Bank]",
            color: "gold",
            clickEvent: {
              action: "suggest_command",
              value: "/teams deposit "
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to manage team bank"
            }
          }
        ] : []
      ]));

      log(`Team info displayed for ${sender}`);
      return { messages, team };
    } catch (error) {
      log(`Error displaying team info: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['teams', 'deposit'])
  @Description('Deposit XPL into team bank')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'Amount to deposit' }
  ])
  async depositToTeam({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      if (args.amount <= 0) {
        throw new Error('Amount must be positive');
      }

      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      // Check player balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const playerBalance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (playerBalance < args.amount) {
        throw new Error(`Insufficient funds. You have ${playerBalance} XPL`);
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      // Update balances atomically
      const result = await kv.atomic()
        .check(balanceResult)
        .check(teamResult)
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(playerBalance - args.amount)))
        .set(['teams', teamId], {
          ...team,
          balance: team.balance + args.amount
        })
        .commit();

      if (!result.ok) {
        throw new Error('Failed to process deposit');
      }

      // Notify team members
      const notifications = team.members.map(member =>
        tellraw(member, JSON.stringify([
          {text: "Team Bank Deposit\n", color: "gold", bold: true},
          {text: sender, color: "green"},
          {text: " deposited ", color: "gray"},
          {text: `${args.amount} XPL`, color: "yellow"},
          {text: "\nNew balance: ", color: "gray"},
          {text: `${team.balance + args.amount} XPL`, color: "gold"}
        ]))
      );

      messages = await Promise.all(notifications);

      log(`${sender} deposited ${args.amount} XPL to team ${team.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in team deposit: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['teams', 'withdraw'])
  @Description('Withdraw XPL from team bank (leader only)')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'Amount to withdraw' }
  ])
  async withdrawFromTeam({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      if (args.amount <= 0) {
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

      if (team.balance < args.amount) {
        throw new Error(`Insufficient team funds. Available: ${team.balance} XPL`);
      }

      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const playerBalance = balanceResult.value ? Number(balanceResult.value) : 0;

      // Update balances atomically
      const result = await kv.atomic()
        .check(balanceResult)
        .check(teamResult)
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(playerBalance + args.amount)))
        .set(['teams', teamId], {
          ...team,
          balance: team.balance - args.amount
        })
        .commit();

      if (!result.ok) {
        throw new Error('Failed to process withdrawal');
      }

      // Notify team members
      const notifications = team.members.map(member =>
        tellraw(member, JSON.stringify([
          {text: "Team Bank Withdrawal\n", color: "gold", bold: true},
          {text: sender, color: "green"},
          {text: " withdrew ", color: "gray"},
          {text: `${args.amount} XPL`, color: "yellow"},
          {text: "\nRemaining balance: ", color: "gray"},
          {text: `${team.balance - args.amount} XPL`, color: "gold"}
        ]))
      );

      messages = await Promise.all(notifications);

      log(`${sender} withdrew ${args.amount} XPL from team ${team.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in team withdrawal: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['teams', 'promote'])
  @Description('Promote a team member to officer')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to promote' }
  ])
  async promotePlayer({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error('You are not in a team');
      }

      const teamResult = await kv.get(['teams', teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error('Only the team leader can promote members');
      }

      if (!team.members.includes(args.player)) {
        throw new Error('This player is not in your team');
      }

      if (team.officers.includes(args.player)) {
        throw new Error('This player is already an officer');
      }

      // Update team data
      team.officers.push(args.player);
      await kv.set(['teams', teamId], team);

      // Notify affected players
      messages = await Promise.all([
        tellraw(args.player, JSON.stringify({
          text: "You have been promoted to team officer!",
          color: team.color
        })),
        tellraw(sender, JSON.stringify({
          text: `${args.player} has been promoted to officer`,
          color: "green"
        }))
      ]);

      log(`${sender} promoted ${args.player} to officer in team ${team.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in team promotion: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['teams', 'transfer'])
  @Description('Transfer team leadership')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'New team leader' }
  ])
  async transferLeadership({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

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

      if (!team.members.includes(args.player)) {
        throw new Error('This player is not in your team');
      }

      // Update leadership
      const oldLeader = team.leader;
      team.leader = args.player;
      if (!team.officers.includes(oldLeader)) {
        team.officers.push(oldLeader);
      }

      await kv.set(['teams', teamId], team);

      // Notify all team members
      const notifications = team.members.map(member =>
        tellraw(member, JSON.stringify([
          {text: "Leadership Transfer\n", color: "gold", bold: true},
          {text: args.player, color: "green"},
          {text: " is now the leader of ", color: "yellow"},
          {text: team.name, color: team.color, bold: true}
        ]))
      );

      messages = await Promise.all(notifications);

      log(`${sender} transferred team ${team.name} leadership to ${args.player}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in leadership transfer: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Event('player_joined')
  async handlePlayerJoin({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { playerName } = params;
    let messages = [];

    try {
      await this.delay(1000);
      await this.processQueuedOperations(kv, playerName);

      const teamId = await this.getPlayerTeam(kv, playerName);
      if (teamId) {
        const teamResult = await kv.get(['teams', teamId]);
        const team = teamResult.value as TeamData;

        if (team && team.members.includes(playerName)) {
          messages = await tellraw(playerName, JSON.stringify({
            text: `Welcome back to team ${team.name}!`,
            color: team.color
          }));
        }
      }

      return { messages };
    } catch (error) {
      log(`Error in player join handler: ${error.message}`);
      return { messages };
    }
  }
}
