// zone_info.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { id } = args;

  try {
    const zoneRecord = await kv.get(["zones", id]);
    if (!zoneRecord.value) {
      await api.tellraw(sender, JSON.stringify({
        text: "Zone not found.",
        color: "red"
      }));
      return;
    }

    const zone = zoneRecord.value;
    const teamRecord = await kv.get(["teams", zone.team]);
    const team = teamRecord.value;

    await api.tellraw(sender, JSON.stringify({
      text: `Zone Information for "${zone.name}":`,
      color: "gold"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `Description: ${zone.description}`,
      color: "yellow"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `Owner Team: ${team.name}`,
      color: "yellow"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `Teleport Allowed: ${zone.teleport}`,
      color: "yellow"
    }));
    await api.tellraw(sender, JSON.stringify({
      text: `For Sale: ${zone.sale}`,
      color: "yellow"
    }));
    if (zone.sale) {
      await api.tellraw(sender, JSON.stringify({
        text: `Price: ${zone.price} XP`,
        color: "yellow"
      }));
    }

    log(`Player ${sender} viewed info for zone "${zone.name}"`);
  } catch (error) {
    log(`Error getting zone info for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while fetching zone information.",
      color: "red"
    }));
  }
}
