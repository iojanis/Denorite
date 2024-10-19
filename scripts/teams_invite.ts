// team_invite.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { player } = args;

  try {
    const playerTeamRecord = await kv.get(["playerTeams", sender]);
    if (!playerTeamRecord.value) {
      await api.tellraw(sender, JSON.stringify({
        text: "You are not in a team.",
        color: "red"
      }));
      return;
    }

    const teamId = playerTeamRecord.value;
    const teamRecord = await kv.get(["teams", teamId]);
    const team = teamRecord.value;

    if (team.leader !== sender) {
      await api.tellraw(sender, JSON.stringify({
        text: "Only the team leader can invite players.",
        color: "red"
      }));
      return;
    }

    const invitedPlayerTeamRecord = await kv.get(["playerTeams", player]);
    if (invitedPlayerTeamRecord.value) {
      await api.tellraw(sender, JSON.stringify({
        text: "The player you're trying to invite is already in a team.",
        color: "red"
      }));
      return;
    }

    // Send invitation to the player
    await api.tellraw(player, JSON.stringify({
      text: `You have been invited to join team "${team.name}". Type "/team join ${team.name}" to accept.`,
      color: "green"
    }));

    await api.tellraw(sender, JSON.stringify({
      text: `Invitation sent to ${player}.`,
      color: "green"
    }));

    log(`Player ${sender} invited ${player} to team "${team.name}"`);
  } catch (error) {
    log(`Error inviting player for ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while sending the invitation.",
      color: "red"
    }));
  }
}
