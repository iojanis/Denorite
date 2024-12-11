import {
  Module,
  Command,
  Description,
  Permission,
  Socket,
  Argument,
  Event,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

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
  type: "add" | "remove" | "promote" | "demote" | "leave";
  teamId: string;
  player: string;
  timestamp: string;
}

@Module({
  name: "Teams",
  version: "1.0.1",
  description: "Team management with economy and Leukocyte integration",
})
export class Teams {
  private readonly TEAM_CREATION_COST = 1;
  private readonly VALID_COLORS = [
    "aqua",
    "black",
    "blue",
    "dark_aqua",
    "dark_blue",
    "dark_gray",
    "dark_green",
    "dark_purple",
    "dark_red",
    "gold",
    "gray",
    "green",
    "light_purple",
    "red",
    "white",
    "yellow",
  ];

  // Helper methods remain unchanged
  private createSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async getPlayerTeam(
    kv: any,
    playerName: string,
  ): Promise<string | null> {
    const result = await kv.get(["players", playerName, "team"]);
    return result.value;
  }

  private async setupTeamProtection(
    api: any,
    teamId: string,
    teamName: string,
    color: string = "white",
  ): Promise<void> {
    try {
      await api.executeCommand(`team add ${teamId} {"text":"${teamName}"}`);
      await api.executeCommand(`team modify ${teamId} color ${color}`);
      await api.executeCommand(`team modify ${teamId} friendlyFire false`);
      await api.executeCommand(
        `team modify ${teamId} nametagVisibility hideForOtherTeams`,
      );
      await api.executeCommand(
        `team modify ${teamId} seeFriendlyInvisibles true`,
      );
    } catch (error) {
      try {
        await api.executeCommand(`team remove ${teamId}`);
      } catch {}
      throw new Error(`Failed to setup team: ${error.message}`);
    }
  }

  private async updatePlayerTeam(
    api: any,
    teamId: string | null,
    playerName: string,
    oldTeamId?: string,
  ): Promise<void> {
    try {
      if (oldTeamId) {
        await api.executeCommand(`team leave ${playerName}`);
      }
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

  private async processQueuedOperations(
    kv: any,
    api: any,
    playerName: string,
  ): Promise<void> {
    const queueResult = await kv.get(["teams", "operations", playerName]);
    const operations = (queueResult.value as TeamOperationQueue[]) || [];

    if (operations.length === 0) return;

    for (const op of operations) {
      const teamResult = await kv.get(["teams", op.teamId]);
      const team = teamResult.value as TeamData;

      if (!team) continue;

      switch (op.type) {
        case "add":
          team.members.push(playerName);
          await this.updatePlayerTeam(api, op.teamId, playerName);
          break;
        case "remove":
          team.members = team.members.filter((p) => p !== playerName);
          team.officers = team.officers.filter((p) => p !== playerName);
          await this.updatePlayerTeam(api, null, playerName, op.teamId);
          break;
        case "promote":
          if (!team.officers.includes(playerName)) {
            team.officers.push(playerName);
          }
          break;
        case "demote":
          team.officers = team.officers.filter((p) => p !== playerName);
          break;
      }

      await kv.set(["teams", op.teamId], team);
    }

    await kv.delete(["teams", "operations", playerName]);
  }

  @Event("player_joined")
  async handlePlayerJoin({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { playerName } = params;
    let messages = [];

    try {
      await this.delay(1000);
      await this.processQueuedOperations(kv, api, playerName);

      const teamId = await this.getPlayerTeam(kv, playerName);
      if (teamId) {
        const teamResult = await kv.get(["teams", teamId]);
        const team = teamResult.value as TeamData;

        if (team && team.members.includes(playerName)) {
          await this.updatePlayerTeam(api, teamId, playerName);
          messages = await tellraw(playerName, [
            { text: "Welcome back to ", color: "yellow" },
            { text: team.name, color: team.color },
            { text: "!\n", color: "yellow" },
            {
              text: "[View Team Info]",
              color: "green",
              clickEvent: {
                action: "run_command",
                value: "/teams info",
              },
              hoverEvent: {
                action: "show_text",
                value: "Click to view team details",
              },
            },
          ]);
        }
      }
      return { messages };
    } catch (error) {
      log(`Error in handlePlayerJoin for ${playerName}: ${error.message}`);
      messages = await tellraw(playerName, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams"])
  @Description("Team management commands")
  @Permission("player")
  async teams({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(sender, [
        { text: "=== Team Commands ===\n", color: "gold", bold: true },

        { text: "/teams create <name>", color: "yellow" },
        { text: " - Create a new team (costs 1 XPL)\n", color: "gray" },

        {
          text: "/teams info",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/teams info",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view team info",
          },
        },
        { text: " - View your team's information\n", color: "gray" },

        {
          text: "/teams list",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/teams list",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to list all teams",
          },
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
            value: "/teams leave",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to leave your team",
          },
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
            value: "/teams ",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to write a team command",
          },
        },
      ]);

      return { messages };
    } catch (error) {
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "create"])
  @Description("Create a new team (costs 1 XPL)")
  @Permission("player")
  @Argument([{ name: "name", type: "string", description: "Team name" }])
  async createTeam({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const teamName = args.name;
    const teamId = this.createSlug(teamName);
    let messages = [];

    try {
      const currentTeam = await this.getPlayerTeam(kv, sender);
      if (currentTeam) {
        throw new Error("You are already in a team");
      }

      const existingTeam = await kv.get(["teams", teamId]);
      if (existingTeam.value) {
        throw new Error("A team with this name already exists");
      }

      const balanceResult = await kv.get([
        "plugins",
        "economy",
        "balances",
        sender,
      ]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (balance < this.TEAM_CREATION_COST) {
        throw new Error(
          `You need ${this.TEAM_CREATION_COST} XPL to create a team`,
        );
      }

      await this.setupTeamProtection(api, teamId, teamName);

      const team: TeamData = {
        id: teamId,
        name: teamName,
        leader: sender,
        officers: [],
        members: [sender],
        color: "white",
        createdAt: new Date().toISOString(),
        balance: 0,
      };

      const result = await kv
        .atomic()
        .check(existingTeam)
        .set(["teams", teamId], team)
        .set(["players", sender, "team"], teamId)
        .mutate({
          type: "sum",
          key: ["plugins", "economy", "balances", sender],
          value: new Deno.KvU64(BigInt(balance - this.TEAM_CREATION_COST)),
        })
        .commit();

      if (!result.ok) {
        await this.removeTeamProtection(api, teamId);
        throw new Error("Failed to create team");
      }

      await this.updatePlayerTeam(api, teamId, sender);

      messages = await tellraw(sender, [
        { text: "=== Team Created ===\n", color: "gold", bold: true },
        { text: "Name: ", color: "gray" },
        { text: teamName + "\n", color: "white" },
        { text: "Cost: ", color: "gray" },
        { text: `${this.TEAM_CREATION_COST} XPL\n`, color: "gold" },
        { text: "\n" },
        {
          text: "[View Team Info]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: "/teams info",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view team details",
          },
        },
      ]);

      log(`Player ${sender} created team ${teamName} (${teamId})`);
      return { messages };
    } catch (error) {
      log(`Error creating team by ${sender}: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "invite"])
  @Description("Invite a player to your team")
  @Permission("player")
  @Argument([
    { name: "player", type: "player", description: "Player to invite" },
  ])
  async invitePlayer({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender && !team.officers.includes(sender)) {
        throw new Error("Only team leaders and officers can invite players");
      }

      const targetTeam = await this.getPlayerTeam(kv, targetPlayer);
      if (targetTeam) {
        throw new Error("This player is already in a team");
      }

      // Send invitation to target player
      await tellraw(targetPlayer, [
        { text: "=== Team Invitation ===\n", color: "gold", bold: true },
        { text: `${sender} has invited you to join `, color: "yellow" },
        { text: team.name, color: team.color },
        { text: "\n\n" },
        {
          text: "[Accept]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: `/teams join ${team.id}`,
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to join team",
          },
        },
        { text: " " },
        {
          text: "[Decline]",
          color: "red",
          clickEvent: {
            action: "run_command",
            value: `/teams decline ${team.id}`,
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to decline invitation",
          },
        },
      ]);

      messages = await tellraw(sender, [
        { text: "Invitation sent to ", color: "green" },
        { text: targetPlayer, color: "yellow" },
      ]);

      log(`${sender} invited ${targetPlayer} to team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team invite: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "decline"])
  @Description("Decline a team invitation")
  @Permission("player")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID to decline" },
  ])
  async declineInvite({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const teamId = args.teamId;
    let messages = [];

    try {
      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      messages = await tellraw(sender, [
        { text: "You declined the invitation to join ", color: "yellow" },
        { text: team.name, color: team.color },
      ]);

      await tellraw(team.leader, [
        { text: sender, color: "yellow" },
        { text: " declined the team invitation", color: "yellow" },
      ]);

      log(`${sender} declined invitation to team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error declining team invite: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "join"])
  @Description("Join a team after being invited")
  @Permission("player")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID to join" },
  ])
  async joinTeam({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const teamId = args.teamId;
    let messages = [];

    try {
      const currentTeam = await this.getPlayerTeam(kv, sender);
      if (currentTeam) {
        throw new Error("You are already in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      team.members.push(sender);

      const result = await kv
        .atomic()
        .set(["teams", teamId], team)
        .set(["players", sender, "team"], teamId)
        .commit();

      if (!result.ok) {
        throw new Error("Failed to join team");
      }

      await this.updatePlayerTeam(api, teamId, sender);

      messages = await tellraw(sender, [
        { text: "=== Welcome to ", color: "gold" },
        { text: team.name, color: team.color },
        { text: " ===\n", color: "gold" },
        {
          text: "[View Team Info]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: "/teams info",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view team details",
          },
        },
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(member, [
            { text: sender, color: "yellow" },
            { text: " has joined the team!", color: team.color },
          ]);
        }
      }

      log(`${sender} joined team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team join: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "leave"])
  @Description("Leave your current team")
  @Permission("player")
  async leaveTeam({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader === sender && team.members.length > 1) {
        throw new Error("Team leaders must transfer leadership before leaving");
      }

      team.members = team.members.filter((m) => m !== sender);
      team.officers = team.officers.filter((o) => o !== sender);

      if (team.members.length === 0) {
        await kv
          .atomic()
          .delete(["teams", teamId])
          .delete(["players", sender, "team"])
          .commit();

        await this.removeTeamProtection(api, teamId);

        messages = await tellraw(sender, [
          { text: "You left the team. ", color: "yellow" },
          {
            text: "Team has been disbanded as it is now empty.",
            color: "gold",
          },
        ]);
      } else {
        await kv
          .atomic()
          .set(["teams", teamId], team)
          .delete(["players", sender, "team"])
          .commit();

        await this.updatePlayerTeam(api, null, sender, teamId);

        messages = await tellraw(sender, [
          { text: "You have left ", color: "yellow" },
          { text: team.name, color: team.color },
        ]);

        for (const member of team.members) {
          await tellraw(member, [
            { text: sender, color: "yellow" },
            { text: " has left the team", color: team.color },
          ]);
        }
      }

      log(`${sender} left team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team leave: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "promote"])
  @Description("Promote a team member to officer")
  @Permission("player")
  @Argument([
    { name: "player", type: "player", description: "Player to promote" },
  ])
  async promotePlayer({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error("Only team leaders can promote members");
      }

      if (!team.members.includes(targetPlayer)) {
        throw new Error("This player is not in your team");
      }

      if (team.officers.includes(targetPlayer)) {
        throw new Error("This player is already an officer");
      }

      const operation: TeamOperationQueue = {
        type: "promote",
        teamId,
        player: targetPlayer,
        timestamp: new Date().toISOString(),
      };

      await kv.set(["teams", "operations", targetPlayer], [operation]);

      team.officers.push(targetPlayer);
      await kv.set(["teams", teamId], team);

      messages = await tellraw(sender, [
        { text: "Promoted ", color: "green" },
        { text: targetPlayer, color: "yellow" },
        { text: " to team officer", color: "green" },
      ]);

      await tellraw(targetPlayer, [
        { text: "=== Promotion ===\n", color: "gold", bold: true },
        {
          text: "You have been promoted to team officer in ",
          color: team.color,
        },
        { text: team.name, color: team.color, bold: true },
        { text: "!\n", color: team.color },
        {
          text: "[View Team Info]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: "/teams info",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view team details",
          },
        },
      ]);

      log(`${sender} promoted ${targetPlayer} to officer in team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team promotion: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "demote"])
  @Description("Demote a team officer to member")
  @Permission("player")
  @Argument([
    { name: "player", type: "player", description: "Player to demote" },
  ])
  async demotePlayer({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error("Only team leaders can demote officers");
      }

      if (!team.officers.includes(targetPlayer)) {
        throw new Error("This player is not an officer");
      }

      const operation: TeamOperationQueue = {
        type: "demote",
        teamId,
        player: targetPlayer,
        timestamp: new Date().toISOString(),
      };

      await kv.set(["teams", "operations", targetPlayer], [operation]);

      team.officers = team.officers.filter((o) => o !== targetPlayer);
      await kv.set(["teams", teamId], team);

      messages = await tellraw(sender, [
        { text: "Demoted ", color: "yellow" },
        { text: targetPlayer, color: "gold" },
        { text: " to team member", color: "yellow" },
      ]);

      await tellraw(targetPlayer, [
        { text: "You have been demoted to team member in ", color: team.color },
        { text: team.name, color: team.color, bold: true },
      ]);

      log(`${sender} demoted ${targetPlayer} in team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team demotion: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "transfer"])
  @Description("Transfer team leadership to another member")
  @Permission("player")
  @Argument([
    {
      name: "newLeader",
      type: "player",
      description: "Player to transfer leadership to",
    },
  ])
  async transferLeadership({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const newLeader = args.newLeader;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error("Only the team leader can transfer leadership");
      }

      if (!team.members.includes(newLeader)) {
        throw new Error("That player is not in your team");
      }

      team.leader = newLeader;
      if (!team.officers.includes(sender)) {
        team.officers.push(sender);
      }

      await kv.set(["teams", teamId], team);

      messages = await tellraw(sender, [
        { text: "=== Leadership Transfer ===\n", color: "gold", bold: true },
        { text: "You transferred leadership to ", color: "yellow" },
        { text: newLeader, color: "green" },
        { text: "\nYou are now a team officer", color: "yellow" },
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(member, [
            { text: "=== Team Update ===\n", color: "gold", bold: true },
            { text: "New team leader: ", color: "yellow" },
            { text: newLeader, color: team.color, bold: true },
          ]);
        }
      }

      log(`${sender} transferred team ${team.name} leadership to ${newLeader}`);
      return { messages };
    } catch (error) {
      log(`Error in leadership transfer: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "color"])
  @Description("Set team color (operators only)")
  @Permission("operator")
  @Argument([
    { name: "team", type: "string", description: "Team ID" },
    { name: "color", type: "string", description: "Team color" },
  ])
  async setTeamColor({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { args } = params;
    const { team: teamId, color } = args;
    let messages = [];

    try {
      if (!this.VALID_COLORS.includes(color)) {
        throw new Error(
          `Invalid color. Valid colors: ${this.VALID_COLORS.join(", ")}`,
        );
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      await api.executeCommand(`team modify ${teamId} color ${color}`);
      team.color = color;
      await kv.set(["teams", teamId], team);

      messages = await tellraw(team.leader, [
        { text: "=== Team Update ===\n", color: "gold", bold: true },
        { text: "Team color has been updated to ", color: "yellow" },
        { text: color, color: color, bold: true },
      ]);

      for (const member of team.members) {
        await tellraw(member, [
          { text: "Team color has been updated to ", color: "yellow" },
          { text: color, color: color, bold: true },
        ]);
      }

      log(`Team ${team.name} color set to ${color}`);
      return { messages };
    } catch (error) {
      log(`Error setting team color: ${error.message}`);
      messages = await tellraw(team.leader, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "deposit"])
  @Description("Deposit XPL into team bank")
  @Permission("player")
  @Argument([
    { name: "amount", type: "integer", description: "Amount to deposit" },
  ])
  async depositToTeam({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const amount = args.amount;
    let messages = [];

    try {
      if (amount <= 0) {
        throw new Error("Amount must be positive");
      }

      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const balanceResult = await kv.get([
        "plugins",
        "economy",
        "balances",
        sender,
      ]);
      const playerBalance = balanceResult.value
        ? Number(balanceResult.value)
        : 0;

      if (playerBalance < amount) {
        throw new Error("Insufficient funds");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      const result = await kv
        .atomic()
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(playerBalance - parseInt(amount))),
        )
        .set(["teams", teamId], {
          ...team,
          balance: team.balance + parseInt(amount),
        })
        .commit();

      if (!result.ok) {
        throw new Error("Failed to process deposit");
      }

      messages = await tellraw(sender, [
        { text: "=== Team Deposit ===\n", color: "gold", bold: true },
        { text: "Amount: ", color: "gray" },
        { text: `${amount} XPL\n`, color: "yellow" },
        { text: "New team balance: ", color: "gray" },
        { text: `${team.balance + parseInt(amount)} XPL`, color: "gold" },
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(member, [
            { text: sender, color: "yellow" },
            { text: " deposited ", color: "gray" },
            { text: `${amount} XPL`, color: "gold" },
            { text: " to team bank", color: "gray" },
          ]);
        }
      }

      log(`${sender} deposited ${amount} XPL to team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team deposit: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "withdraw"])
  @Description("Withdraw XPL from team bank (leader only)")
  @Permission("player")
  @Argument([
    { name: "amount", type: "integer", description: "Amount to withdraw" },
  ])
  async withdrawFromTeam({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const amount = args.amount;
    let messages = [];

    try {
      if (amount <= 0) {
        throw new Error("Amount must be positive");
      }

      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error("Only the team leader can withdraw funds");
      }

      if (team.balance < amount) {
        throw new Error("Insufficient team funds");
      }

      const balanceResult = await kv.get([
        "plugins",
        "economy",
        "balances",
        sender,
      ]);
      const playerBalance = balanceResult.value
        ? Number(balanceResult.value)
        : 0;

      const result = await kv
        .atomic()
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(playerBalance + parseInt(amount))),
        )
        .set(["teams", teamId], {
          ...team,
          balance: team.balance - parseInt(amount),
        })
        .commit();

      if (!result.ok) {
        throw new Error("Failed to process withdrawal");
      }

      messages = await tellraw(sender, [
        { text: "=== Team Withdrawal ===\n", color: "gold", bold: true },
        { text: "Amount: ", color: "gray" },
        { text: `${amount} XPL\n`, color: "yellow" },
        { text: "Remaining team balance: ", color: "gray" },
        { text: `${team.balance - parseInt(amount)} XPL`, color: "gold" },
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(member, [
            { text: sender, color: "yellow" },
            { text: " withdrew ", color: "gray" },
            { text: `${amount} XPL`, color: "gold" },
            { text: " from team bank", color: "gray" },
          ]);
        }
      }

      log(`${sender} withdrew ${amount} XPL from team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team withdrawal: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "kick"])
  @Description("Kick a player from your team")
  @Permission("player")
  @Argument([{ name: "player", type: "player", description: "Player to kick" }])
  async kickPlayer({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender && !team.officers.includes(sender)) {
        throw new Error("Only team leaders and officers can kick members");
      }

      if (!team.members.includes(targetPlayer)) {
        throw new Error("That player is not in your team");
      }

      if (team.leader === targetPlayer) {
        throw new Error("Cannot kick the team leader");
      }

      if (team.officers.includes(targetPlayer) && sender !== team.leader) {
        throw new Error("Only the team leader can kick officers");
      }

      const operation: TeamOperationQueue = {
        type: "remove",
        teamId,
        player: targetPlayer,
        timestamp: new Date().toISOString(),
      };

      await kv.set(["teams", "operations", targetPlayer], [operation]);

      team.members = team.members.filter((m) => m !== targetPlayer);
      team.officers = team.officers.filter((o) => o !== targetPlayer);
      await kv.set(["teams", teamId], team);
      await kv.delete(["players", targetPlayer, "team"]);

      await this.updatePlayerTeam(api, null, targetPlayer, teamId);

      messages = await tellraw(sender, [
        { text: "=== Team Kick ===\n", color: "gold", bold: true },
        { text: "Kicked ", color: "yellow" },
        { text: targetPlayer, color: "red" },
        { text: " from the team", color: "yellow" },
      ]);

      await tellraw(targetPlayer, [
        { text: "=== Kicked ===\n", color: "red", bold: true },
        { text: "You have been kicked from ", color: "yellow" },
        { text: team.name, color: team.color },
      ]);

      for (const member of team.members) {
        if (member !== sender && member !== targetPlayer) {
          await tellraw(member, [
            { text: targetPlayer, color: "red" },
            { text: " has been kicked from the team by ", color: "yellow" },
            { text: sender, color: team.color },
          ]);
        }
      }

      log(`${sender} kicked ${targetPlayer} from team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team kick: ${error.message}`);
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "info"])
  @Description("View team information")
  @Permission("player")
  async teamInfo({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      messages = await tellraw(sender, [
        { text: "=== Team Information ===\n", color: "gold", bold: true },
        { text: "Name: ", color: "gray" },
        { text: `${team.name}\n`, color: team.color },
        { text: "Leader: ", color: "gray" },
        { text: `${team.leader}\n`, color: "white" },
        { text: "Officers: ", color: "gray" },
        { text: `${team.officers.join(", ") || "None"}\n`, color: "white" },
        { text: "Members: ", color: "gray" },
        { text: `${team.members.length}\n`, color: "white" },
        { text: "Balance: ", color: "gray" },
        { text: `${team.balance} XPL\n`, color: "gold" },
        { text: "Created: ", color: "gray" },
        {
          text: new Date(team.createdAt).toLocaleDateString() + "\n",
          color: "white",
        },
        { text: "\n" },
        {
          text: "[Team Commands]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: "/teams",
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view team commands",
          },
        },
      ]);

      return { messages };
    } catch (error) {
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "list"])
  @Description("List all teams")
  @Permission("player")
  async listTeams({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const teams = [];
      const entriesIterator = kv.list({ prefix: ["teams"] });
      for await (const entry of entriesIterator) {
        if (
          entry.value &&
          typeof entry.value === "object" &&
          "name" in entry.value
        ) {
          teams.push(entry.value as TeamData);
        }
      }

      if (teams.length === 0) {
        messages = await tellraw(sender, [
          { text: "No teams have been created yet", color: "yellow" },
        ]);
        return { messages };
      }

      const messageComponents = [
        { text: "=== Teams List ===\n", color: "gold", bold: true },
      ];

      for (const team of teams) {
        messageComponents.push(
          { text: "\n" + team.name, color: team.color, bold: true },
          { text: "\nLeader: ", color: "gray" },
          { text: team.leader, color: "white" },
          { text: "\nMembers: ", color: "gray" },
          { text: team.members.length.toString(), color: "white" },
          {
            text: " [Join]",
            color: "green",
            clickEvent: {
              action: "run_command",
              value: `/teams join ${team.id}`,
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to join team",
            },
          },
        );
      }

      messages = await tellraw(sender, messageComponents);
      return { messages };
    } catch (error) {
      messages = await tellraw(sender, [
        { text: "Error: ", color: "red" },
        { text: error.message, color: "white" },
      ]);
      return { messages, error: error.message };
    }
  }

  // Socket endpoints remain unchanged as they don't use tellraw
  @Socket("team_data")
  async getTeamData({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { playerName } = params;
      const teamId = await this.getPlayerTeam(kv, playerName);
      if (!teamId) {
        return { success: true, data: null };
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      return {
        success: true,
        data: {
          ...team,
          isLeader: team.leader === playerName,
          isOfficer: team.officers.includes(playerName),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("list_teams")
  async getAllTeams({ kv }: ScriptContext): Promise<any> {
    try {
      const teamsResult = await kv.get(["teams"]);
      return {
        success: true,
        data: teamsResult.value || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("team_members")
  async getTeamMembers({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { teamId } = params;
      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        return {
          success: false,
          error: "Team not found",
        };
      }

      return {
        success: true,
        data: {
          members: team.members,
          officers: team.officers,
          leader: team.leader,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
