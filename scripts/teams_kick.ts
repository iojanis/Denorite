// team_kick.ts
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
        text: "Only the team leader can kick players.",
        color: "red"
      }));
      return;
    }

    if (!team.members.includes(player)) {
      await api.tellraw(sender, JSON.stringify({
        text: "This player is not in your team.",
        color: "red"
      }));
      return;
    }

    // Remove player from the team in Minecraft
    try {
      await api.team('leave', player);
    } catch (error) {
      log(`Error removing player ${player} from Minecraft team: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while removing the player from the team in Minecraft.",
        color: "red"
      }));
      return;
    }

    team.members = team.members.filter(member => member !== player);

    await kv.atomic()
      .set(["teams", teamId], team)
      .delete(["playerTeams", player])
      .commit();

    await api.tellraw(sender, JSON.stringify({
      text: `${player} has been kicked from the team.`,
      color: "green"
    }));

    await api.tellraw(player, JSON.stringify({
      text: `You have been kicked from team "${team.name}".`,
      color: "red"
    }));

    log(`Player ${sender} kicked ${player} from team "${team.name}"`);
  } catch (error) {
    log(`Error kicking player for ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while kicking the player.",
      color: "red"
    }));
  }
}
