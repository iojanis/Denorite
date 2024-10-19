// zone_edit.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { id, description, teleport, sale, price } = args;

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
        text: "You don't have permission to edit this zone.",
        color: "red"
      }));
      return;
    }

    const teamRecord = await kv.get(["teams", zone.team]);
    const team = teamRecord.value;
    if (team.leader !== sender) {
      await api.tellraw(sender, JSON.stringify({
        text: "Only the team leader can edit zones.",
        color: "red"
      }));
      return;
    }

    if (description) zone.description = description;
    if (teleport !== undefined) zone.teleport = teleport;
    if (sale !== undefined) zone.sale = sale;
    if (price !== undefined) zone.price = price;

    await kv.set(["zones", id], zone);

    if (description) {
      await updateBlockDisplay(zone.center, description, zone.name, sendToMinecraft);
    }

    await api.tellraw(sender, JSON.stringify({
      text: `Zone "${zone.name}" has been updated successfully.`,
      color: "green"
    }));
    log(`Player ${sender} updated zone "${zone.name}"`);
  } catch (error) {
    log(`Error editing zone for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while editing the zone.",
      color: "red"
    }));
  }
}

async function updateBlockDisplay(position: any, description: string, name: string, sendToMinecraft: Function) {
  // First, remove existing displays
  await sendToMinecraft({
    type: "command",
    data: `kill @e[type=block_display,tag=zone_display,x=${position.x},y=${position.y},z=${position.z},distance=..5]`
  });

  // Then summon new displays
  await summonBlockDisplay(position, description, name, sendToMinecraft);
}


async function summonBlockDisplay(position: any, description: string, name: string, sendToMinecraft: Function) {
  const descriptionCommand = `summon block_display ${position.x} ${position.y} ${position.z} {Tags: ["zone_display"], Passengers:[{id:"minecraft:text_display", billboard:"vertical", text:"{\\"text\\":\\"${description}\\",\\"color\\":\\"white\\",\\"bold\\":false,\\"italic\\":false,\\"underlined\\":false,\\"strikethrough\\":false,\\"font\\":\\"minecraft:uniform\\"}",text_opacity:255,background:0,alignment:"center",line_width:200,transformation:[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.5,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0]}]}`;

  const nameCommand = `summon block_display ${position.x} ${position.y + 1} ${position.z} {Tags: ["zone_display"], Passengers:[{id:"minecraft:text_display", billboard:"vertical", text:"{\\"text\\":\\"${name}\\",\\"color\\":\\"gold\\",\\"bold\\":true,\\"italic\\":false,\\"underlined\\":false,\\"strikethrough\\":false,\\"font\\":\\"minecraft:uniform\\"}",text_opacity:255,background:0,alignment:"center",line_width:200,transformation:[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.5,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0]}]}`;

  await sendToMinecraft({ type: "command", data: descriptionCommand });
  await sendToMinecraft({ type: "command", data: nameCommand });
}
