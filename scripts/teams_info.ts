// team_info.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender } = params;

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

    await api.tellraw(sender, JSON.stringify({
      text: `Team Information for "${team.name}":`,
      color: "gold"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `Leader: ${team.leader}`,
      color: "yellow"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `Color: ${team.color}`,
      color: "yellow"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `Members: ${team.members.join(", ")}`,
      color: "yellow"
    }));

    log(`Player ${sender} viewed info for team "${team.name}"`);
  } catch (error) {
    log(`Error getting team info for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while fetching team information.",
      color: "red"
    }));
  }
}
