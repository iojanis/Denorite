// team_list.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender } = params;

  try {
    const teams = kv.list({ prefix: ["teams"] });
    const teamList = [];

    for await (const team of teams) {
      teamList.push(team.value);
    }

    if (teamList.length === 0) {
      await api.tellraw(sender, JSON.stringify({
        text: "There are no teams currently.",
        color: "yellow"
      }));
      return;
    }

    await api.tellraw(sender, JSON.stringify({
      text: "List of Teams:",
      color: "gold"
    }));

    for (const team of teamList) {
      await api.tellraw(sender, JSON.stringify({
        text: `${team.name} (${team.members.length} members)`,
        color: team.color
      }));
    }

    log(`Player ${sender} listed all teams`);
  } catch (error) {
    log(`Error listing teams for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while listing teams.",
      color: "red"
    }));
  }
}
