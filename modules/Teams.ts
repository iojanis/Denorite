import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";
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
  isPublic: boolean;
  description: string;
  invites: string[];
  maxMembers: number;
}

interface TeamInvite {
  teamId: string;
  invitedBy: string;
  timestamp: string;
  expires: string;
}

@Module({
  name: "Teams",
  version: "1.0.2",
  description: "Advanced team management with economy and zones integration",
})
export class Teams {
  private readonly TEAM_CREATION_COST = 1;
  private readonly DEFAULT_MAX_MEMBERS = 10;
  private readonly INVITE_EXPIRY_MINUTES = 30;
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

  private createSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
  }

  private async getPlayerTeam(
    kv: any,
    playerName: string,
  ): Promise<string | null> {
    const result = await kv.get(["player", playerName, "team"]);
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

  private async removeTeamProtection(api: any, teamId: string): Promise<void> {
    try {
      await api.executeCommand(`team remove ${teamId}`);
    } catch (error) {
      throw new Error(`Failed to remove team protection: ${error.message}`);
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

  private async cleanExpiredInvites(kv: any, teamId: string): Promise<void> {
    const teamResult = await kv.get(["teams", teamId]);
    const team = teamResult.value as TeamData;

    if (!team) return;

    const now = new Date();
    const invitesResult = await kv.get(["teams", "invites", teamId]);
    const invites = (invitesResult.value as TeamInvite[]) || [];

    const validInvites = invites.filter((invite) => {
      const expiry = new Date(invite.expires);
      return expiry > now;
    });

    if (validInvites.length !== invites.length) {
      await kv.set(["teams", "invites", teamId], validInvites);
    }
  }

  private isPlayerInvited(invites: TeamInvite[], playerName: string): boolean {
    const now = new Date();
    return invites.some((invite) => {
      const expiry = new Date(invite.expires);
      return invite.teamId === playerName && expiry > now;
    });
  }

  @Command(["teams"])
  @Description("Team management commands")
  @Permission("player")
  async teams(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const helpMenu = container([
        text("=== Team Commands ===\n", {
          style: { color: "gold", styles: ["bold"] },
        }),

        button("/teams create <name> <description>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams create ",
          },
        }),
        text(" - Create a new team (costs 1 XPL)\n", {
          style: { color: "gray" },
        }),

        button("/teams info", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/teams info",
          },
        }),
        text(" - View your team's information\n", {
          style: { color: "gray" },
        }),

        button("/teams list", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/teams list",
          },
        }),
        text(" - Browse all teams\n", { style: { color: "gray" } }),

        button("/teams invite <player>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams invite ",
          },
        }),
        text(" - Invite a player to your team\n", {
          style: { color: "gray" },
        }),

        button("/teams join <teamId>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams join ",
          },
        }),
        text(" - Join a public team or accept invite\n", {
          style: { color: "gray" },
        }),

        button("/teams settings", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/teams settings",
          },
        }),
        text(" - Manage team settings\n", { style: { color: "gray" } }),

        divider(),
        text("Team Management:\n", { style: { color: "yellow" } }),

        button("/teams promote <player>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams promote ",
          },
        }),
        text(" - Promote to officer\n", { style: { color: "gray" } }),

        button("/teams demote <player>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams demote ",
          },
        }),
        text(" - Demote from officer\n", { style: { color: "gray" } }),

        button("/teams kick <player>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams kick ",
          },
        }),
        text(" - Remove from team\n", { style: { color: "gray" } }),

        divider(),
        text("Team Economy:\n", { style: { color: "yellow" } }),

        button("/teams deposit <amount>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams deposit ",
          },
        }),
        text(" - Add XPL to team bank\n", { style: { color: "gray" } }),

        button("/teams withdraw <amount>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/teams withdraw ",
          },
        }),
        text(" - Take XPL from team bank\n", { style: { color: "gray" } }),
      ]);

      const messages = await tellraw(
        sender,
        helpMenu.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "create"])
  @Description("Create a new team (costs 1 XPL)")
  @Permission("player")
  @Argument([
    { name: "name", type: "string", description: "Team name" },
    { name: "description", type: "string", description: "Team description" },
  ])
  async createTeam({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { name, description } = args;
    const teamId = this.createSlug(name);

    try {
      // Check if player has enough XPL
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

      // Check if team name exists
      const existingTeam = await kv.get(["teams", teamId]);
      if (existingTeam.value) {
        throw new Error("A team with this name already exists");
      }

      // Create team data
      const team: TeamData = {
        id: teamId,
        name,
        description,
        leader: sender,
        officers: [],
        members: [sender],
        color: "white",
        createdAt: new Date().toISOString(),
        balance: 0,
        isPublic: false,
        invites: [],
        maxMembers: this.DEFAULT_MAX_MEMBERS,
      };

      // Setup team protection and execute transaction
      await this.setupTeamProtection(api, teamId, name);

      const result = await kv
        .atomic()
        .check(existingTeam)
        .check({
          key: ["plugins", "economy", "balances", sender],
          versionstamp: balanceResult.versionstamp,
        })
        .set(["teams", teamId], team)
        .set(["player", sender, "team"], teamId)
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(balance - this.TEAM_CREATION_COST)),
        )
        .commit();

      if (!result.ok) {
        await this.removeTeamProtection(api, teamId);
        throw new Error("Failed to create team - transaction failed");
      }

      await this.updatePlayerTeam(api, teamId, sender);

      const successMsg = container([
        text("🎉 Team Created Successfully! 🎉\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("Name: ", { style: { color: "gray" } }),
        text(name + "\n", { style: { color: "white", styles: ["bold"] } }),
        text("Description: ", { style: { color: "gray" } }),
        text(description + "\n", { style: { color: "white" } }),
        text("Cost: ", { style: { color: "gray" } }),
        text(`${this.TEAM_CREATION_COST} XPL\n`, { style: { color: "gold" } }),
        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("Team Settings", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams settings",
          },
        }),
        text(" "),
        button("Invite Players", {
          variant: "success",
          onClick: {
            action: "suggest_command",
            value: "/teams invite ",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );

      log(`Player ${sender} created team ${name} (${teamId})`);
      return { messages };
    } catch (error) {
      log(`Error creating team: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Team Creation Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
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
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      // Get team data
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      // Check permissions
      if (team.leader !== sender && !team.officers.includes(sender)) {
        throw new Error("Only team leaders and officers can invite players");
      }

      // Check team capacity
      if (team.members.length >= team.maxMembers) {
        throw new Error("Team has reached maximum member capacity");
      }

      // Check if player is already a member
      if (team.members.includes(targetPlayer)) {
        throw new Error("This player is already a member of your team");
      }

      // Clean expired invites
      await this.cleanExpiredInvites(kv, teamId);

      // Get current invites
      const invitesResult = await kv.get(["teams", "invites", teamId]);
      const invites = (invitesResult.value as TeamInvite[]) || [];

      // Check if already invited
      if (this.isPlayerInvited(invites, targetPlayer)) {
        throw new Error("This player already has a pending invitation");
      }

      // Create new invite
      const invite: TeamInvite = {
        teamId,
        invitedBy: sender,
        timestamp: new Date().toISOString(),
        expires: new Date(
          Date.now() + this.INVITE_EXPIRY_MINUTES * 60000,
        ).toISOString(),
      };

      invites.push(invite);
      await kv.set(["teams", "invites", teamId], invites);

      // Send invitation message
      const inviteMsg = container([
        text("🎫 Team Invitation 🎫\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("You've been invited to join ", { style: { color: "gray" } }),
        text(team.name + "\n", {
          style: { color: team.color, styles: ["bold"] },
        }),
        text("Invited by: ", { style: { color: "gray" } }),
        text(sender + "\n", { style: { color: "green" } }),
        text("Description: ", { style: { color: "gray" } }),
        text(team.description + "\n", { style: { color: "white" } }),
        text("Members: ", { style: { color: "gray" } }),
        text(`${team.members.length}/${team.maxMembers}\n`, {
          style: { color: "aqua" },
        }),
        divider(),
        button("Accept Invitation", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: `/teams join ${teamId}`,
          },
        }),
        text(" "),
        button("Decline", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: `/teams decline ${teamId}`,
          },
        }),
        text("\n"),
        text("This invitation expires in ", { style: { color: "gray" } }),
        text(`${this.INVITE_EXPIRY_MINUTES} minutes`, {
          style: { color: "yellow" },
        }),
      ]);

      await tellraw(
        targetPlayer,
        inviteMsg.render({ platform: "minecraft", player: targetPlayer }),
      );

      // Confirm to sender
      const confirmMsg = container([
        text("Invitation sent to ", { style: { color: "green" } }),
        text(targetPlayer, { style: { color: "yellow" } }),
        text("\nExpires in ", { style: { color: "gray" } }),
        text(`${this.INVITE_EXPIRY_MINUTES} minutes`, {
          style: { color: "yellow" },
        }),
      ]);

      const messages = await tellraw(
        sender,
        confirmMsg.render({ platform: "minecraft", player: sender }),
      );

      log(`${sender} invited ${targetPlayer} to team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error in team invite: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Invitation Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "join"])
  @Description("Join a team (public or invited)")
  @Permission("player")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID to join" },
  ])
  async joinTeam(
    { params, kv, api, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { teamId } = args;

    try {
      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      // Check if team is full
      if (team.members.length >= team.maxMembers) {
        throw new Error("This team has reached its maximum member capacity");
      }

      // Check if player can join
      if (
        !team.isPublic && team.leader !== sender &&
        !team.officers.includes(sender)
      ) {
        const invitesResult = await kv.get(["teams", "invites", teamId]);
        const invites = (invitesResult.value as TeamInvite[]) || [];

        if (!this.isPlayerInvited(invites, sender)) {
          throw new Error(
            "This team is private and requires an invitation to join",
          );
        }
      }

      // Get current team if any
      const currentTeamId = await this.getPlayerTeam(kv, sender);

      // Add to team members if not already a member
      if (!team.members.includes(sender)) {
        team.members.push(sender);
      }

      // Update team and player data
      const result = await kv.atomic()
        .set(["teams", teamId], team)
        .set(["players", sender, "team"], teamId)
        .commit();

      if (!result.ok) {
        throw new Error("Failed to join team");
      }

      // Update game team if needed
      if (currentTeamId !== teamId) {
        await this.updatePlayerTeam(api, teamId, sender, currentTeamId);
      }

      // Clean up invitation if exists
      await kv.delete(["teams", "invites", teamId, sender]);

      // Success message
      const successMsg = container([
        text("✨ Welcome to ", { style: { color: "green" } }),
        text(team.name, { style: { color: team.color, styles: ["bold"] } }),
        text("! ✨\n", { style: { color: "green" } }),
        text("Members: ", { style: { color: "gray" } }),
        text(`${team.members.length}/${team.maxMembers}\n`, {
          style: { color: "aqua" },
        }),
        divider(),
        button("View Team Info", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams info",
          },
        }),
      ]);

      // Notify other team members
      const joinMsg = container([
        text(sender, { style: { color: "yellow" } }),
        text(" has joined the team!", { style: { color: "green" } }),
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(
            member,
            joinMsg.render({ platform: "minecraft", player: member }),
          );
        }
      }

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      log(`${sender} joined team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error joining team: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Failed to Join Team",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "switch"])
  @Description("Switch to another team you are a member of")
  @Permission("player")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID to switch to" },
  ])
  async switchTeam(
    { params, kv, api, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { teamId } = args;

    try {
      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      if (!team.members.includes(sender)) {
        throw new Error("You are not a member of this team");
      }

      // Get current team if any
      const currentTeamId = await this.getPlayerTeam(kv, sender);
      if (currentTeamId === teamId) {
        throw new Error("You are already in this team");
      }

      // Update player's active team
      const result = await kv.atomic()
        .set(["players", sender, "team"], teamId)
        .commit();

      if (!result.ok) {
        throw new Error("Failed to switch teams");
      }

      // Update game team
      await this.updatePlayerTeam(api, teamId, sender, currentTeamId);

      const successMsg = container([
        text("✨ Switched to ", { style: { color: "green" } }),
        text(team.name, { style: { color: team.color, styles: ["bold"] } }),
        text("! ✨\n", { style: { color: "green" } }),
        button("View Team Info", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams info",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      log(`${sender} switched to team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error switching teams: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Failed to Switch Teams",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "leave"])
  @Description("Leave your current team")
  @Permission("player")
  async leaveTeam(
    { params, kv, api, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in any team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader === sender) {
        throw new Error(
          "Team leaders cannot leave. Transfer leadership first with /teams transfer <player>",
        );
      }

      // Remove from team members and officers
      team.members = team.members.filter((member) => member !== sender);
      team.officers = team.officers.filter((officer) => officer !== sender);

      // Update team data and remove player's active team
      const result = await kv.atomic()
        .set(["teams", teamId], team)
        .delete(["players", sender, "team"])
        .commit();

      if (!result.ok) {
        throw new Error("Failed to leave team");
      }

      // Remove from game team
      await this.updatePlayerTeam(api, null, sender, teamId);

      const successMsg = container([
        text("You have left ", { style: { color: "yellow" } }),
        text(team.name, { style: { color: team.color, styles: ["bold"] } }),
        text("\n"),
        button("Browse Teams", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams list",
          },
        }),
      ]);

      // Notify other team members
      const leaveMsg = container([
        text(sender, { style: { color: "yellow" } }),
        text(" has left the team", { style: { color: "red" } }),
      ]);

      for (const member of team.members) {
        await tellraw(
          member,
          leaveMsg.render({ platform: "minecraft", player: member }),
        );
      }

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      log(`${sender} left team ${team.name}`);
      return { messages };
    } catch (error) {
      log(`Error leaving team: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Failed to Leave Team",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "settings"])
  @Description("Manage team settings")
  @Permission("player")
  async teamSettings(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (team.leader !== sender) {
        throw new Error("Only team leaders can modify team settings");
      }

      const settingsMenu = container([
        text("⚙️ Team Settings ⚙️\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("Team: ", { style: { color: "gray" } }),
        text(team.name + "\n", {
          style: { color: team.color, styles: ["bold"] },
        }),
        divider(),

        // Public/Private Toggle
        text("Visibility: ", { style: { color: "gray" } }),
        button(team.isPublic ? "Public" : "Private", {
          variant: team.isPublic ? "success" : "outline",
          onClick: {
            action: "run_command",
            value: `/teams modify ${teamId} visibility ${!team.isPublic}`,
          },
        }),
        text(" - Allow players to join without invitation\n", {
          style: { color: "gray" },
        }),

        // Description
        text("Description: ", { style: { color: "gray" } }),
        text(team.description + "\n", { style: { color: "white" } }),
        button("Change Description", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: `/teams modify ${teamId} description `,
          },
        }),
        text("\n"),

        // Color (read-only for regular users)
        text("Team Color: ", { style: { color: "gray" } }),
        text(team.color, { style: { color: team.color } }),
        text(" (Contact an operator to change)\n", {
          style: { color: "gray" },
        }),

        // Member Limit
        text("Member Limit: ", { style: { color: "gray" } }),
        text(`${team.members.length}/${team.maxMembers}\n`, {
          style: { color: "aqua" },
        }),
        button("Change Limit", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: `/teams modify ${teamId} maxmembers `,
          },
        }),
        text("\n"),

        divider(),
        text("Member Management:\n", { style: { color: "yellow" } }),
        button("View Members", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams members",
          },
        }),
        text(" "),
        button("Pending Invites", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams invites",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        settingsMenu.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "modify"])
  @Description("Modify team settings")
  @Permission("player")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID" },
    {
      name: "setting",
      type: "string",
      description: "Setting to modify (visibility/description/maxmembers)",
    },
    { name: "value", type: "string", description: "New value" },
  ])
  async modifyTeam(
    { params, kv, api, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { teamId, setting, value } = args;

    try {
      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      if (team.leader !== sender) {
        throw new Error("Only the team leader can modify settings");
      }

      switch (setting.toLowerCase()) {
        case "visibility":
          team.isPublic = value.toLowerCase() === "true";
          break;
        case "description":
          team.description = value;
          break;
        case "maxmembers":
          const newLimit = parseInt(value);
          if (isNaN(newLimit) || newLimit < team.members.length) {
            throw new Error(
              "Invalid member limit. Must be greater than current member count.",
            );
          }
          team.maxMembers = newLimit;
          break;
        default:
          throw new Error(
            "Invalid setting. Use visibility, description, or maxmembers",
          );
      }

      await kv.set(["teams", teamId], team);

      const successMsg = container([
        text("Team Setting Updated\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Setting: ", { style: { color: "gray" } }),
        text(setting + "\n", { style: { color: "yellow" } }),
        text("New Value: ", { style: { color: "gray" } }),
        text(value + "\n", { style: { color: "aqua" } }),
        divider(),
        button("Back to Settings", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/teams settings",
          },
        }),
      ]);

      // Notify team members
      const updateMsg = container([
        text("Team Update: ", { style: { color: "yellow" } }),
        text(`${setting} has been changed to `, { style: { color: "gray" } }),
        text(value, { style: { color: "aqua" } }),
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(
            member,
            updateMsg.render({ platform: "minecraft", player: member }),
          );
        }
      }

      log(`${sender} modified team ${team.name} setting: ${setting}=${value}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error modifying team: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Modification Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "color"])
  @Description("Set a team's color (Operator only)")
  @Permission("operator")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID" },
    { name: "color", type: "string", description: "New team color" },
  ])
  async setTeamColor(
    { params, kv, api, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { teamId, color } = args;

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

      // Update team color
      team.color = color;
      await kv.set(["teams", teamId], team);

      // Update game team display
      // await this.updateTeamDisplay(api, teamId, team.name, color);

      const successMsg = container([
        text("Team Color Updated\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Team: ", { style: { color: "gray" } }),
        text(team.name + "\n", { style: { color: color, styles: ["bold"] } }),
        text("New Color: ", { style: { color: "gray" } }),
        text(color, { style: { color: color } }),
      ]);

      // Notify team members
      const updateMsg = container([
        text("Team color has been updated to ", { style: { color: "gray" } }),
        text(color, { style: { color: color } }),
        text(" by ", { style: { color: "gray" } }),
        text(sender, { style: { color: "yellow" } }),
      ]);

      for (const member of team.members) {
        await tellraw(
          member,
          updateMsg.render({ platform: "minecraft", player: member }),
        );
      }

      log(`${sender} updated team ${team.name} color to ${color}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error setting team color: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Color Change Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
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

    try {
      const teams = [];
      const entriesIterator = kv.list({ prefix: ["teams"] });
      for await (const entry of entriesIterator) {
        if (entry.key[1] !== "invites" && entry.key[1] !== "operations") {
          teams.push(entry.value as TeamData);
        }
      }

      if (teams.length === 0) {
        const noTeamsMsg = container([
          text("No teams have been created yet!", {
            style: { color: "yellow" },
          }),
        ]);
        const messages = await tellraw(
          sender,
          noTeamsMsg.render({ platform: "minecraft", player: sender }),
        );
        return { messages };
      }

      const teamsList = container([
        text("📋 Teams List 📋\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(`${teams.length} teams found\n`, { style: { color: "gray" } }),
        divider(),
        ...teams.flatMap((team) => [
          text(team.name + " ", {
            style: { color: team.color, styles: ["bold"] },
          }),
          text(team.isPublic ? "🌐" : "🔒", {
            style: { color: "gray" },
          }),
          text("\n"),

          // Member count
          text("Members: ", { style: { color: "gray" } }),
          text(`${team.members.length}/${team.maxMembers}\n`, {
            style: { color: "aqua" },
          }),

          // Description
          text("Description: ", { style: { color: "gray" } }),
          text(team.description + "\n", { style: { color: "white" } }),

          // Quick actions
          button("Info", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: `/teams info ${team.id}`,
            },
          }),
          text(" "),
          ...(team.isPublic
            ? [
              button("Join", {
                variant: "success",
                onClick: {
                  action: "run_command",
                  value: `/teams join ${team.id}`,
                },
              }),
            ]
            : [
              text("(Private Team)", {
                style: { color: "gray" },
              }),
            ]),
          divider(),
        ]),
      ]);

      const messages = await tellraw(
        sender,
        teamsList.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "info"])
  @Description("View detailed team information")
  @Permission("player")
  @Argument([
    {
      name: "teamId",
      type: "string",
      description: "Team ID (optional)",
      required: false,
    },
  ])
  async teamInfo({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;

    try {
      let teamId = args.teamId;
      if (!teamId) {
        teamId = await this.getPlayerTeam(kv, sender);
        if (!teamId) {
          throw new Error("You are not in a team");
        }
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      // Format creation date
      const creationDate = new Date(team.createdAt).toLocaleDateString(
        "en-US",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
        },
      );

      const teamInfo = container([
        text(`${team.name}\n`, {
          style: { color: team.color, styles: ["bold"] },
        }),
        text(team.isPublic ? "🌐 Public Team" : "🔒 Private Team", {
          style: { color: team.isPublic ? "green" : "gray" },
        }),
        text("\n"),
        divider(),

        // Description
        text("📝 Description\n", { style: { color: "yellow" } }),
        text(team.description + "\n\n", { style: { color: "white" } }),

        // Leadership
        text("👑 Leadership\n", { style: { color: "gold" } }),
        text("Leader: ", { style: { color: "gray" } }),
        text(team.leader + "\n", { style: { color: "yellow" } }),
        text("Officers: ", { style: { color: "gray" } }),
        text(team.officers.join(", ") || "None\n", {
          style: { color: "aqua" },
        }),
        text("\n"),

        // Members
        text("👥 Members: ", { style: { color: "yellow" } }),
        text(`${team.members.length}/${team.maxMembers}\n`, {
          style: { color: "aqua" },
        }),
        ...(team.members.length > 0
          ? [
            text(team.members.join(", ") + "\n", { style: { color: "white" } }),
          ]
          : []),
        text("\n"),

        // Economy
        text("💰 Team Bank\n", { style: { color: "gold" } }),
        text("Balance: ", { style: { color: "gray" } }),
        text(`${team.balance} XPL\n`, { style: { color: "yellow" } }),
        text("\n"),

        // Creation Info
        text("📅 Created: ", { style: { color: "gray" } }),
        text(creationDate + "\n", { style: { color: "white" } }),

        divider(),

        // Actions
        ...(team.members.includes(sender)
          ? [
            button("Team Settings", {
              variant: "outline",
              onClick: {
                action: "run_command",
                value: "/teams settings",
              },
            }),
            text(" "),
            button("Deposit XPL", {
              variant: "ghost",
              onClick: {
                action: "suggest_command",
                value: "/teams deposit ",
              },
            }),
          ]
          : team.isPublic
          ? [
            button("Join Team", {
              variant: "success",
              onClick: {
                action: "run_command",
                value: `/teams join ${team.id}`,
              },
            }),
          ]
          : [
            text("This team requires an invitation to join", {
              style: { color: "gray" },
            }),
          ]),
      ]);

      const messages = await tellraw(
        sender,
        teamInfo.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
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
        throw new Error(`Insufficient funds. You have ${playerBalance} XPL`);
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      const result = await kv
        .atomic()
        .check({
          key: ["plugins", "economy", "balances", sender],
          versionstamp: balanceResult.versionstamp,
        })
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(playerBalance - amount)),
        )
        .set(["teams", teamId], {
          ...team,
          balance: team.balance + amount,
        })
        .commit();

      if (!result.ok) {
        throw new Error("Transaction failed");
      }

      const successMsg = container([
        text("💰 Team Deposit Success 💰\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("Amount: ", { style: { color: "gray" } }),
        text(`${amount} XPL\n`, { style: { color: "yellow" } }),
        text("New Team Balance: ", { style: { color: "gray" } }),
        text(`${team.balance + amount} XPL\n`, { style: { color: "gold" } }),
        text("Your Balance: ", { style: { color: "gray" } }),
        text(`${playerBalance - amount} XPL`, { style: { color: "green" } }),
      ]);

      // Notify team members
      const notifyMsg = container([
        text(sender, { style: { color: "yellow" } }),
        text(" deposited ", { style: { color: "gray" } }),
        text(`${amount} XPL`, { style: { color: "gold" } }),
        text(" to the team bank", { style: { color: "gray" } }),
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(
            member,
            notifyMsg.render({ platform: "minecraft", player: member }),
          );
        }
      }

      log(`${sender} deposited ${amount} XPL to team ${team.name}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error in team deposit: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Deposit Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
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
        throw new Error(
          `Insufficient team funds. Team has ${team.balance} XPL`,
        );
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
        .check({
          key: ["plugins", "economy", "balances", sender],
          versionstamp: balanceResult.versionstamp,
        })
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(playerBalance + amount)),
        )
        .set(["teams", teamId], {
          ...team,
          balance: team.balance - amount,
        })
        .commit();

      if (!result.ok) {
        throw new Error("Transaction failed");
      }

      const successMsg = container([
        text("💰 Team Withdrawal Success 💰\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("Amount: ", { style: { color: "gray" } }),
        text(`${amount} XPL\n`, { style: { color: "yellow" } }),
        text("Remaining Team Balance: ", { style: { color: "gray" } }),
        text(`${team.balance - amount} XPL\n`, { style: { color: "gold" } }),
        text("Your New Balance: ", { style: { color: "gray" } }),
        text(`${playerBalance + amount} XPL`, { style: { color: "green" } }),
      ]);

      // Notify team members
      const notifyMsg = container([
        text(sender, { style: { color: "yellow" } }),
        text(" withdrew ", { style: { color: "gray" } }),
        text(`${amount} XPL`, { style: { color: "gold" } }),
        text(" from the team bank", { style: { color: "gray" } }),
      ]);

      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(
            member,
            notifyMsg.render({ platform: "minecraft", player: member }),
          );
        }
      }

      log(`${sender} withdrew ${amount} XPL from team ${team.name}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error in team withdrawal: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Withdrawal Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "demote"])
  @Description("Demote an officer to regular member")
  @Permission("player")
  @Argument([
    { name: "player", type: "player", description: "Officer to demote" },
  ])
  async demoteOfficer(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      // Get team data
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      // Check permissions
      if (team.leader !== sender) {
        throw new Error("Only the team leader can demote officers");
      }

      // Check if target is an officer
      if (!team.officers.includes(targetPlayer)) {
        throw new Error("This player is not an officer");
      }

      // Update team data
      team.officers = team.officers.filter((officer) =>
        officer !== targetPlayer
      );

      const result = await kv.atomic()
        .set(["teams", teamId], team)
        .commit();

      if (!result.ok) {
        throw new Error("Failed to demote officer");
      }

      // Notify players
      const successMsg = container([
        text("Officer Demotion\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(targetPlayer, { style: { color: "yellow" } }),
        text(" has been demoted to member", { style: { color: "white" } }),
      ]);

      const targetMsg = container([
        text("You have been demoted to member in ", {
          style: { color: "yellow" },
        }),
        text(team.name, { style: { color: team.color, styles: ["bold"] } }),
      ]);

      // Notify target player
      await tellraw(
        targetPlayer,
        targetMsg.render({ platform: "minecraft", player: targetPlayer }),
      );

      log(`${sender} demoted ${targetPlayer} in team ${team.name}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error in officer demotion: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Demotion Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "kick"])
  @Description("Remove a player from the team")
  @Permission("player")
  @Argument([
    { name: "player", type: "player", description: "Player to kick" },
  ])
  async kickMember(
    { params, kv, api, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const targetPlayer = args.player;

    try {
      // Get team data
      const teamId = await this.getPlayerTeam(kv, sender);
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      // Check permissions
      if (team.leader !== sender && !team.officers.includes(sender)) {
        throw new Error("Only team leaders and officers can kick members");
      }

      // Prevent kicking the leader
      if (targetPlayer === team.leader) {
        throw new Error("The team leader cannot be kicked");
      }

      // Officers can't kick other officers
      if (team.officers.includes(targetPlayer) && team.leader !== sender) {
        throw new Error("Officers cannot kick other officers");
      }

      // Check if player is in the team
      if (!team.members.includes(targetPlayer)) {
        throw new Error("This player is not in your team");
      }

      // Update team data
      team.members = team.members.filter((member) => member !== targetPlayer);
      team.officers = team.officers.filter((officer) =>
        officer !== targetPlayer
      );

      const result = await kv.atomic()
        .set(["teams", teamId], team)
        .delete(["player", targetPlayer, "team"])
        .commit();

      if (!result.ok) {
        throw new Error("Failed to kick member");
      }

      // Remove from game team
      await this.updatePlayerTeam(api, null, targetPlayer, teamId);

      // Notify players
      const successMsg = container([
        text("Member Kicked\n", { style: { color: "gold", styles: ["bold"] } }),
        text(targetPlayer, { style: { color: "yellow" } }),
        text(" has been removed from the team", { style: { color: "white" } }),
      ]);

      const targetMsg = container([
        text("You have been kicked from ", { style: { color: "red" } }),
        text(team.name, { style: { color: team.color, styles: ["bold"] } }),
      ]);

      // Notify target player
      await tellraw(
        targetPlayer,
        targetMsg.render({ platform: "minecraft", player: targetPlayer }),
      );

      // Notify other team members
      const teamMsg = container([
        text(targetPlayer, { style: { color: "yellow" } }),
        text(" was kicked from the team by ", { style: { color: "red" } }),
        text(sender, { style: { color: "yellow" } }),
      ]);

      for (const member of team.members) {
        if (member !== sender && member !== targetPlayer) {
          await tellraw(
            member,
            teamMsg.render({ platform: "minecraft", player: member }),
          );
        }
      }

      log(`${sender} kicked ${targetPlayer} from team ${team.name}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error in team kick: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Kick Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["teams", "decline"])
  @Description("Decline a team invitation")
  @Permission("player")
  @Argument([
    { name: "teamId", type: "string", description: "Team ID to decline" },
  ])
  async declineInvite(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { teamId } = args;

    try {
      // Get team data and invites
      const teamResult = await kv.get(["teams", teamId]);
      const team = teamResult.value as TeamData;

      if (!team) {
        throw new Error("Team not found");
      }

      const invitesResult = await kv.get(["teams", "invites", teamId]);
      const invites = (invitesResult.value as TeamInvite[]) || [];

      // Check if player has an invite
      const invite = invites.find((inv) =>
        inv.teamId === teamId &&
        new Date(inv.expires) > new Date()
      );

      if (!invite) {
        throw new Error("You do not have a pending invitation from this team");
      }

      // Remove the invitation
      const updatedInvites = invites.filter((inv) =>
        !(inv.teamId === teamId && new Date(inv.expires) > new Date())
      );

      await kv.set(["teams", "invites", teamId], updatedInvites);

      // Notify players
      const successMsg = container([
        text("Invitation Declined\n", {
          style: { color: "yellow", styles: ["bold"] },
        }),
        text("You declined the invitation to join ", {
          style: { color: "gray" },
        }),
        text(team.name, { style: { color: team.color, styles: ["bold"] } }),
      ]);

      // Notify team leader
      const leaderMsg = container([
        text(sender, { style: { color: "yellow" } }),
        text(" declined the invitation to join your team", {
          style: { color: "red" },
        }),
      ]);

      await tellraw(
        team.leader,
        leaderMsg.render({ platform: "minecraft", player: team.leader }),
      );

      log(`${sender} declined invitation to team ${team.name}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error declining team invite: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Failed to Decline Invitation",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Event("player_joined")
  async handlePlayerJoin({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<void> {
    const { playerName } = params;

    try {
      const teamId = await this.getPlayerTeam(kv, playerName);
      if (teamId) {
        const teamResult = await kv.get(["teams", teamId]);
        const team = teamResult.value as TeamData;

        if (team && team.members.includes(playerName)) {
          await this.updatePlayerTeam(api, teamId, playerName);

          const welcomeMsg = container([
            text("Welcome back to ", { style: { color: "green" } }),
            text(team.name, {
              style: { color: team.color, styles: ["bold"] },
            }),
            text("!\n", { style: { color: "green" } }),
            button("View Team Info", {
              variant: "outline",
              onClick: {
                action: "run_command",
                value: "/teams info",
              },
            }),
          ]);

          await tellraw(
            playerName,
            welcomeMsg.render({ platform: "minecraft", player: playerName }),
          );
        }
      }
    } catch (error) {
      log(`Error in player join handler: ${error.message}`);
    }
  }

  @Socket("get_team_data")
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
          isMember: team.members.includes(playerName),
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
      const teams = [];
      const entriesIterator = kv.list({ prefix: ["teams"] });
      for await (const entry of entriesIterator) {
        if (entry.key[1] !== "invites" && entry.key[1] !== "operations") {
          teams.push(entry.value);
        }
      }

      return {
        success: true,
        data: teams.map((team: TeamData) => ({
          id: team.id,
          name: team.name,
          description: team.description,
          memberCount: team.members.length,
          maxMembers: team.maxMembers,
          isPublic: team.isPublic,
          color: team.color,
          leader: team.leader,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("get_team_invites")
  async getTeamInvites({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { teamId } = params;
      await this.cleanExpiredInvites(kv, teamId);

      const invitesResult = await kv.get(["teams", "invites", teamId]);
      const invites = invitesResult.value || [];

      return {
        success: true,
        data: invites,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
