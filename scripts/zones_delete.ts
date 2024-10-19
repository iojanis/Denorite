// zone_delete.ts
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
    const playerTeamRecord = await kv.get(["playerTeams", sender]);
    if (!playerTeamRecord.value || playerTeamRecord.value !== zone.team) {
      await api.tellraw(sender, JSON.stringify({
        text: "You don't have permission to delete this zone.",
        color: "red"
      }));
      return;
    }

    const teamRecord = await kv.get(["teams", zone.team]);
    const team = teamRecord.value;
    if (team.leader !== sender) {
      await api.tellraw(sender, JSON.stringify({
        text: "Only the team leader can delete zones.",
        color: "red"
      }));
      return;
    }

    await api.teleport(sender, zone.center.x, zone.center.y, zone.center.z);
    await removeCommandBlocks(zone, sendToMinecraft);
    await kv.delete(["zones", id]);

    await api.tellraw(sender, JSON.stringify({
      text: `Zone "${zone.name}" has been deleted successfully.`,
      color: "green"
    }));
    log(`Player ${sender} deleted zone "${zone.name}"`);
  } catch (error) {
    log(`Error deleting zone for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while deleting the zone.",
      color: "red"
    }));
  }
}

async function removeCommandBlocks(zone: any, sendToMinecraft: Function) {
  const { positions } = zone;
  const [p2] = positions;

  const commands = [
    `fill ${p2.x + 127} 0 ${p2.z + 127} ${p2.x + 129} 2 ${p2.z + 129} air replace repeating_command_block`,
    `fill ${p2.x + 127} 0 ${p2.z + 127} ${p2.x + 129} 2 ${p2.z + 129} air replace redstone_block`,
    `kill @e[type=block_display,tag=zone_display,x=${zone.center.x},y=${zone.center.y},z=${zone.center.z},distance=..5]`
  ];

  for (const command of commands) {
    await sendToMinecraft({ type: "command", data: command });
  }
}
