// team_join.ts
import type { ScriptContext } from "../types.d.ts";
import { slugify } from "../utils.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { name } = args;

  try {
    const teamId = slugify(name);
    const teamRecord = await kv.get(["teams", teamId]);

    if (!teamRecord.value) {
      await api.tellraw(sender, JSON.stringify({
        text: `Team "${name}" does not exist.`,
        color: "red"
      }));
      return;
    }

    const team = teamRecord.value;

    const playerTeamRecord = await kv.get(["playerTeams", sender]);
    if (playerTeamRecord.value) {
      await api.tellraw(sender, JSON.stringify({
        text: "You are already in a team. Leave your current team first.",
        color: "red"
      }));
      return;
    }

    // Add the player to the team in Minecraft
    try {
      await api.team('join', teamId, sender);
    } catch (error) {
      log(`Error adding player ${sender} to Minecraft team: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while adding you to the team in Minecraft.",
        color: "red"
      }));
      return;
    }

    team.members.push(sender);

    await kv.atomic()
      .set(["teams", teamId], team)
      .set(["playerTeams", sender], teamId)
      .commit();

    await api.tellraw(sender, JSON.stringify({
      text: `You have joined the team "${name}".`,
      color: "green"
    }));
    log(`Player ${sender} joined team "${name}"`);
  } catch (error) {
    log(`Error joining team for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while joining the team.",
      color: "red"
    }));
  }
}
