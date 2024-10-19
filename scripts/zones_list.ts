// zone_list.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender } = params;

  try {
    const zones = kv.list({ prefix: ["zones"] });
    const zoneList = [];

    for await (const zone of zones) {
      zoneList.push(zone.value);
    }

    if (zoneList.length === 0) {
      await api.tellraw(sender, JSON.stringify({
        text: "There are no zones currently.",
        color: "yellow"
      }));
      return;
    }

    await api.tellraw(sender, JSON.stringify({
      text: "List of Zones:",
      color: "gold"
    }));

    for (const zone of zoneList) {
      const teamRecord = await kv.get(["teams", zone.team]);
      const team = teamRecord.value;
      await api.tellraw(sender, JSON.stringify({
        text: `${zone.name} (Owned by ${team.name})`,
        color: "white"
      }));
    }

    log(`Player ${sender} listed all zones`);
  } catch (error) {
    log(`Error listing zones for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while listing zones.",
      color: "red"
    }));
  }
}
