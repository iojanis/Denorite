// team_setcolor.ts
import type { ScriptContext } from "../types.d.ts";

const validColors = ["red", "blue", "green", "yellow", "purple", "aqua", "white", "gray"];

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { color } = args;

  try {
    if (!validColors.includes(color)) {
      await api.tellraw(sender, JSON.stringify({
        text: `Invalid color. Valid colors are: ${validColors.join(", ")}`,
        color: "red"
      }));
      return;
    }

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
        text: "Only the team leader can change the team color.",
        color: "red"
      }));
      return;
    }

    // Set the team color in Minecraft
    try {
      await api.team('modify', teamId, 'color', color);
    } catch (error) {
      log(`Error setting color for Minecraft team ${teamId}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while setting the team color in Minecraft.",
        color: "red"
      }));
      return;
    }

    team.color = color;
    await kv.set(["teams", teamId], team);

    await api.tellraw(sender, JSON.stringify({
      text: `Team color has been set to ${color}.`,
      color: color
    }));

    log(`Player ${sender} set team "${team.name}" color to ${color}`);
  } catch (error) {
    log(`Error setting team color for ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while setting the team color.",
      color: "red"
    }));
  }
}
