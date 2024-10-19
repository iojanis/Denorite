// team_leave.ts
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

    // Remove player from the team in Minecraft
    try {
      await api.team('leave', sender);
    } catch (error) {
      log(`Error removing player ${sender} from Minecraft team: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while removing you from the team in Minecraft.",
        color: "red"
      }));
      return;
    }

    team.members = team.members.filter(member => member !== sender);

    if (team.members.length === 0) {
      // Delete the team if it's empty
      await kv.atomic()
        .delete(["teams", teamId])
        .delete(["playerTeams", sender])
        .commit();

      await api.team('remove', teamId);

      await api.tellraw(sender, JSON.stringify({
        text: `You have left the team "${team.name}". The team has been disbanded as it's now empty.`,
        color: "green"
      }));
    } else {
      if (team.leader === sender) {
        // Transfer leadership to the next member
        team.leader = team.members[0];
      }

      await kv.atomic()
        .set(["teams", teamId], team)
        .delete(["playerTeams", sender])
        .commit();

      await api.tellraw(sender, JSON.stringify({
        text: `You have left the team "${team.name}".`,
        color: "green"
      }));
    }

    log(`Player ${sender} left team "${team.name}"`);
  } catch (error) {
    log(`Error leaving team for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while leaving the team.",
      color: "red"
    }));
  }
}
