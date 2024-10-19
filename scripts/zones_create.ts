// zone_create.ts
import type { ScriptContext } from "../types.d.ts";
import { slugify } from "../utils.ts";

export default async function({ params, kv, sendToMinecraft, api, log, config }: ScriptContext) {
  const { sender, args } = params;
  const { name, size, description } = args;

  try {
    const playerTeamRecord = await kv.get(["playerTeams", sender]);
    if (!playerTeamRecord.value) {
      await api.tellraw(sender, JSON.stringify({
        text: "You must be in a team to create a zone.",
        color: "red"
      }));
      return;
    }

    const teamId = playerTeamRecord.value;
    const teamRecord = await kv.get(["teams", teamId]);
    const team = teamRecord.value;

    if (team.leader !== sender) {
      await api.tellraw(sender, JSON.stringify({
        text: "Only the team leader can create zones.",
        color: "red"
      }));
      return;
    }

    const minZoneSize = await config.get('MIN_ZONE_SIZE') || 32;
    const maxZoneSize = await config.get('MAX_ZONE_SIZE') || 256;
    if (size < minZoneSize || size > maxZoneSize) {
      await api.tellraw(sender, JSON.stringify({
        text: `Zone size must be between ${minZoneSize} and ${maxZoneSize}.`,
        color: "red"
      }));
      return;
    }

    const basePrice = await config.get('BASE_ZONE_PRICE') || 111;
    const price = basePrice * (size / minZoneSize);

    const playerXp = await api.xpQuery(sender, 'points');
    if (playerXp < price) {
      await api.tellraw(sender, JSON.stringify({
        text: `You don't have enough XP to create this zone. Cost: ${price} XP`,
        color: "red"
      }));
      return;
    }

    const playerLocation = await api.getPlayerPosition(sender);
    const zoneId = slugify(name);
    const newZone = {
      id: zoneId,
      name,
      team: teamId,
      description,
      positions: createPositions(playerLocation, size),
      center: playerLocation,
      teleport: false,
      sale: false,
      price: 0
    };

    // Check for overlapping zones
    const existingZones = kv.list({ prefix: ["zones"] });
    for await (const existingZone of existingZones) {
      if (isOverlapping(newZone, existingZone.value)) {
        await api.tellraw(sender, JSON.stringify({
          text: "This zone overlaps with an existing zone.",
          color: "red"
        }));
        return;
      }
    }

    await api.xp('remove', sender, price, 'points');
    await kv.set(["zones", zoneId], newZone);

    await setCommandBlocks(newZone, teamId, sendToMinecraft);
    await summonBlockDisplay(newZone.center, description, name, sendToMinecraft);

    await api.tellraw(sender, JSON.stringify({
      text: `Zone "${name}" has been created successfully.`,
      color: "green"
    }));
    log(`Player ${sender} created zone "${name}"`);
  } catch (error) {
    log(`Error creating zone for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while creating the zone.",
      color: "red"
    }));
  }
}

function createPositions(center: any, size: number): [any, any, any, any] {
  const halfSize = size / 2;
  return [
    { x: center.x - halfSize, y: center.y, z: center.z - halfSize },
    { x: center.x + halfSize, y: center.y, z: center.z - halfSize },
    { x: center.x + halfSize, y: center.y, z: center.z + halfSize },
    { x: center.x - halfSize, y: center.y, z: center.z + halfSize }
  ];
}

function isOverlapping(zone1: Zone, zone2: Zone): boolean {
  const [p1, p2, p3, p4] = zone1.positions;
  const [q1, q2, q3, q4] = zone2.positions;
  return !(p1.x > q2.x || p2.x < q1.x || p1.z > q3.z || p3.z < q1.z);
}

async function setCommandBlocks(zone: any, teamId: string, sendToMinecraft: Function) {
  const { positions } = zone;
  const [p1, p2, p3, p4] = positions;

  const commands = [
    {
      delay: 0,
      x: p2.x + 128,
      y: 2,
      z: p2.z + 128,
      nx: p2.x + 4,
      nz: p2.z + 4,
      dx: 247,
      dy: 256,
      dz: 247,
      mode: 'survival',
      target: `team=${teamId}`
    },
    {
      delay: 3 * 200,
      x: p2.x + 128,
      y: 1,
      z: p2.z + 127,
      nx: p2.x,
      nz: p2.z,
      dx: 250,
      dy: 256,
      dz: 2,
      mode: 'survival',
      target: `team=!${teamId}`
    },
    {
      delay: 3 * 200,
      x: p2.x + 129,
      y: 1,
      z: p2.z + 128,
      nx: p1.x - 3,
      nz: p1.z,
      dx: 2,
      dy: 256,
      dz: 250,
      mode: 'survival',
      target: `team=!${teamId}`
    },
    {
      delay: 3 * 200,
      x: p2.x + 128,
      y: 1,
      z: p2.z + 129,
      nx: p3.x + 3,
      nz: p3.z - 3,
      dx: 250,
      dy: 256,
      dz: 2,
      mode: 'survival',
      target: `team=!${teamId}`
    },
    {
      delay: 3 * 200,
      x: p2.x + 127,
      y: 1,
      z: p2.z + 128,
      nx: p2.x,
      nz: p2.z + 3,
      dx: 2,
      dy: 256,
      dz: 250,
      mode: 'survival',
      target: `team=!${teamId}`
    },
    {
      delay: 6 * 200,
      x: p2.x + 128,
      y: 0,
      z: p2.z + 128,
      nx: p2.x + 4,
      nz: p2.z + 4,
      dx: 247,
      dy: 256,
      dz: 247,
      mode: 'adventure',
      target: `team=!${teamId}`
    }
  ];

  for (const command of commands) {
    await new Promise(resolve => setTimeout(resolve, command.delay));
    await sendToMinecraft({
      type: "command",
      data: `setblock ${command.x} ${command.y} ${command.z} repeating_command_block{auto: 1b, Command:"/gamemode ${command.mode} @a[x=${command.nx},y=${p1.y},z=${command.nz},dx=${command.dx},dy=${command.dy},dz=${command.dz},gamemode=${command.mode === 'survival' ? 'adventure' : 'survival'},${command.target}]"} replace`
    });
  }

  // Activate the command blocks
  await new Promise(resolve => setTimeout(resolve, 15 * 200));
  await sendToMinecraft({
    type: "command",
    data: `setblock ${p2.x + 128} 1 ${p2.z + 128} minecraft:stone`
  });
  await sendToMinecraft({
    type: "command",
    data: `setblock ${p2.x + 128} 1 ${p2.z + 128} minecraft:redstone_block`
  });
}

async function summonBlockDisplay(position: any, description: string, name: string, sendToMinecraft: Function) {
  const descriptionCommand = `summon block_display ${position.x} ${position.y} ${position.z} {Tags: ["zone_display"], Passengers:[{id:"minecraft:text_display", billboard:"vertical", text:"{\\"text\\":\\"${description}\\",\\"color\\":\\"white\\",\\"bold\\":false,\\"italic\\":false,\\"underlined\\":false,\\"strikethrough\\":false,\\"font\\":\\"minecraft:uniform\\"}",text_opacity:255,background:0,alignment:"center",line_width:200,transformation:[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.5,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0]}]}`;

  const nameCommand = `summon block_display ${position.x} ${position.y + 1} ${position.z} {Tags: ["zone_display"], Passengers:[{id:"minecraft:text_display", billboard:"vertical", text:"{\\"text\\":\\"${name}\\",\\"color\\":\\"gold\\",\\"bold\\":true,\\"italic\\":false,\\"underlined\\":false,\\"strikethrough\\":false,\\"font\\":\\"minecraft:uniform\\"}",text_opacity:255,background:0,alignment:"center",line_width:200,transformation:[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.5,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0]}]}`;

  await sendToMinecraft({ type: "command", data: descriptionCommand });
  await sendToMinecraft({ type: "command", data: nameCommand });
}
