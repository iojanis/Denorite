import { Module, Command, Description, Permission, Socket, Argument, Event } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface Position {
  x: number;
  y: number;
  z: number;
}

interface Zone {
  id: string;
  name: string;
  teamId: string;
  description: string;
  positions: [Position, Position, Position, Position];
  center: Position;
  teleportEnabled: boolean;
  forSale: boolean;
  price: number;
  createdAt: string;
  createdBy: string;
}

@Module({
  name: 'Zones',
  version: '1.0.1',
  description: 'Zone management with teams and economy integration'
})
export class Zones {
  private readonly ZONE_SIZE = 128;
  private readonly ZONE_COST = 111;

  private createSlug(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '');
  }

  private createPositions(x: number, y: number, z: number): [Position, Position, Position, Position] {
    return [
      { x: x - this.ZONE_SIZE, y, z: z - this.ZONE_SIZE },
      { x: x + this.ZONE_SIZE, y, z: z - this.ZONE_SIZE },
      { x: x + this.ZONE_SIZE, y, z: z + this.ZONE_SIZE },
      { x: x - this.ZONE_SIZE, y, z: z + this.ZONE_SIZE }
    ];
  }

  private isOverlapping(newZone: Zone, existingZone: Zone): boolean {
    // Add buffer zone of 1 block to prevent adjacent zones
    const buffer = 1;
    const [p1, p2, p3, p4] = newZone.positions;
    const [q1, q2, q3, q4] = existingZone.positions;

    return !(
      p1.x > (q2.x + buffer) ||
      p2.x < (q1.x - buffer) ||
      p1.z > (q3.z + buffer) ||
      p3.z < (q1.z - buffer)
    );
  }

  private isCoordinateInZone(coord: Position, zone: Zone): boolean {
    const [p1, p2, p3, p4] = zone.positions;
    const { x, z } = coord;

    return !(p1.x > x || p2.x < x || p1.z > z || p3.z < z);
  }

  private createSquareCoordinates(position: Position) {
    const centerX = Math.round(position.x);
    const centerZ = Math.round(position.z);
    const centerY = Math.round(position.y);

    return {
      centerX,
      centerZ,
      centerY,
      point1X: centerX + 129,
      point1Z: centerZ - 127,
      point2X: centerX - 127,
      point2Z: centerZ - 127,
      point3X: centerX - 127,
      point3Z: centerZ + 129,
      point4X: centerX + 129,
      point4Z: centerZ + 129,
      point1Y: 0,
      centerYCoordinate: 0,
      point4Y: 0
    };
  }

  private async setupZoneProtection(rcon: any, coords: any, teamId: string): Promise<void> {
    // Command block content needs proper escaping for JSON strings
    const commandBlocks = [
      {
        // Center - Team members survival mode
        x: coords.point2X + 128,
        y: 2,
        z: coords.point2Z + 128,
        block: `repeating_command_block{auto:1b,Command:"gamemode survival @a[x=${coords.point2X + 4},y=0,z=${coords.point2Z + 4},dx=247,dy=256,dz=247,gamemode=adventure,team=${teamId}]"}`
      },
      {
        // North border
        x: coords.point2X + 128,
        y: 1,
        z: coords.point2Z + 127,
        block: `repeating_command_block{auto:1b,Command:"gamemode survival @a[x=${coords.point2X},y=0,z=${coords.point2Z},dx=250,dy=256,dz=2,gamemode=adventure,team=!${teamId}]"}`
      },
      {
        // East border
        x: coords.point2X + 129,
        y: 1,
        z: coords.point2Z + 128,
        block: `repeating_command_block{auto:1b,Command:"gamemode survival @a[x=${coords.point1X - 3},y=0,z=${coords.point1Z},dx=2,dy=256,dz=250,gamemode=adventure,team=!${teamId}]"}`
      },
      {
        // South border
        x: coords.point2X + 128,
        y: 1,
        z: coords.point2Z + 129,
        block: `repeating_command_block{auto:1b,Command:"gamemode survival @a[x=${coords.point3X + 3},y=0,z=${coords.point3Z - 3},dx=250,dy=256,dz=2,gamemode=adventure,team=!${teamId}]"}`
      },
      {
        // West border
        x: coords.point2X + 127,
        y: 1,
        z: coords.point2Z + 128,
        block: `repeating_command_block{auto:1b,Command:"gamemode survival @a[x=${coords.point2X},y=0,z=${coords.point2Z + 3},dx=2,dy=256,dz=250,gamemode=adventure,team=!${teamId}]"}`
      },
      {
        // Center - Non-team members adventure mode
        x: coords.point2X + 128,
        y: 0,
        z: coords.point2Z + 128,
        block: `repeating_command_block{auto:1b,Command:"gamemode adventure @a[x=${coords.point2X + 4},y=0,z=${coords.point2Z + 4},dx=247,dy=256,dz=247,gamemode=survival,team=!${teamId}]"}`
      }
    ];

    try {
      // Place all command blocks
      for (const cmd of commandBlocks) {
        const command = `setblock ${cmd.x} ${cmd.y} ${cmd.z} ${cmd.block}`;
        await rcon.executeCommand(command);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Place stone then redstone to power the system
      await rcon.executeCommand(
        `setblock ${coords.point2X + 128} 1 ${coords.point2Z + 128} stone`
      );
      await new Promise(resolve => setTimeout(resolve, 200));

      await rcon.executeCommand(
        `setblock ${coords.point2X + 128} 1 ${coords.point2Z + 128} redstone_block`
      );

      // Add visual markers for zone boundaries
      const markers = [
        { x: coords.point1X, z: coords.point1Z },
        { x: coords.point2X, z: coords.point2Z },
        { x: coords.point3X, z: coords.point3Z },
        { x: coords.point4X, z: coords.point4Z }
      ];

      for (const marker of markers) {
        await rcon.executeCommand(
          `setblock ${marker.x} ${coords.centerY} ${marker.z} glowstone`
        );
      }
    } catch (error) {
      throw new Error(`Failed to setup zone protection: ${error.message}`);
    }
  }

  private async createZoneDisplay(api: any, coords: any, name: string, description: string): Promise<void> {
    await api.summon(
      'minecraft:text_display',
      coords.centerX,
      coords.centerY,
      coords.centerZ,
      `{text:'${JSON.stringify(description)}',background:0,transformation:{translation:[0f,0f,0f],scale:[1f,1f,1f]}}`
    );

    await api.summon(
      'minecraft:text_display',
      coords.centerX,
      coords.centerY + 1,
      coords.centerZ,
      `{text:'${JSON.stringify(name)}',background:0,transformation:{translation:[0f,0f,0f],scale:[1f,1f,1f]}}`
    );
  }

  private async removeZoneProtection(api: any, coords: any): Promise<void> {
    const blocks = [
      { x: coords.point2X + 128, y: 2, z: coords.point2Z + 128 },   // Center
      { x: coords.point2X + 128, y: 1, z: coords.point2Z + 127 },   // North
      { x: coords.point2X + 129, y: 1, z: coords.point2Z + 128 },   // East
      { x: coords.point2X + 128, y: 1, z: coords.point2Z + 129 },   // South
      { x: coords.point2X + 127, y: 1, z: coords.point2Z + 128 },   // West
      { x: coords.point2X + 128, y: 0, z: coords.point2Z + 128 },   // Adventure mode
      { x: coords.point2X + 128, y: 1, z: coords.point2Z + 128 }    // Redstone block
    ];

    for (const block of blocks) {
      await api.setBlock(block.x, block.y, block.z, 'minecraft:air');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  @Command(['zone', 'create'])
  @Description('Create a new zone (costs 111 XPL)')
  @Permission('player')
  @Argument([
    { name: 'name', type: 'string', description: 'Zone name' },
    { name: 'description', type: 'string', description: 'Zone description' }
  ])
  async createZone({ params, kv, api, log, rcon }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { name, description } = args;

    try {
      // Check if player is a team leader
      const teamResult = await kv.get(['players', sender, 'team']);
      const teamId = teamResult.value;
      if (!teamId) {
        throw new Error('You must be in a team to create a zone');
      }

      const teamDataResult = await kv.get(['teams', teamId]);
      const teamData = teamDataResult.value;
      if (!teamData || teamData.leader !== sender) {
        throw new Error('Only team leaders can create zones');
      }

      // Check player balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < this.ZONE_COST) {
        throw new Error(`You need ${this.ZONE_COST} XPL to create a zone`);
      }

      // Get player position
      const position = await api.getPlayerPosition(sender);
      const zoneId = this.createSlug(name);

      // Create new zone object
      const newZone: Zone = {
        id: zoneId,
        name,
        teamId,
        description,
        positions: this.createPositions(position.x, position.y, position.z),
        center: position,
        teleportEnabled: false,
        forSale: false,
        price: 0,
        createdAt: new Date().toISOString(),
        createdBy: sender
      };

      // Check for overlapping zones
      const zonesResult = await kv.get(['zones']);
      const existingZones = zonesResult.value || [];
      const overlapping = existingZones.some(zone => this.isOverlapping(newZone, zone));

      if (overlapping) {
        throw new Error('This zone overlaps with an existing zone or is too close to another zone. Zones must have at least 1 block spacing between them.');
      }

      // Create zone and deduct XPL
      const result = await kv.atomic()
        .check(zonesResult)
        .mutate({
          type: 'sum',
          key: ['plugins', 'economy', 'balances', sender],
          value: new Deno.KvU64(BigInt(balance-this.ZONE_COST))
        })
        .set(['zones', zoneId], newZone)
        .commit();

      if (!result.ok) {
        throw new Error('Failed to create zone');
      }

      // Set up command blocks for zone protection
      const coords = this.createSquareCoordinates(position);
      await this.setupZoneProtection(rcon, coords, teamId);

      // Display zone info
      await this.createZoneDisplay(api, coords, name, description);

      // Notify team members
      const notificationMessage = JSON.stringify([
        { text: "New Team Zone Created!\n", color: "gold", bold: true },
        { text: `Name: `, color: "gray" },
        { text: name, color: teamData.color },
        { text: "\nCreated by: ", color: "gray" },
        { text: sender, color: "green" }
      ]);

      for (const member of teamData.members) {
        await api.tellraw(member, notificationMessage);
      }

      log(`Player ${sender} created zone ${name} for team ${teamId}`);

    } catch (error) {
      log(`Error creating zone: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'delete'])
  @Description('Delete a zone')
  @Permission('player')
  @Argument([
    { name: 'zoneId', type: 'string', description: 'Zone ID to delete' }
  ])
  async deleteZone({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { zoneId } = args;

    try {
      // Get zone data
      const zoneResult = await kv.get(['zones', zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error('Zone not found');
      }

      // Check if player is team leader
      const teamResult = await kv.get(['teams', zone.teamId]);
      const team = teamResult.value;

      if (!team || team.leader !== sender) {
        throw new Error('Only the team leader can delete zones');
      }

      // Teleport player to zone center
      await api.teleport(
        sender,
        zone.center.x.toString(),
        zone.center.y.toString(),
        zone.center.z.toString()
      );

      // Remove protection
      const coords = this.createSquareCoordinates(zone.center);
      await this.removeZoneProtection(api, coords);

      // Delete zone data
      await kv.delete(['zones', zoneId]);

      await api.tellraw(sender, JSON.stringify({
        text: `Zone ${zone.name} has been deleted`,
        color: "green"
      }));

      log(`Player ${sender} deleted zone ${zone.name}`);

    } catch (error) {
      log(`Error deleting zone: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'info'])
  @Description('Get information about the current zone')
  @Permission('player')
  async zoneInfo({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      // Get player position
      const position = await api.getPlayerPosition(sender);

      // Find zone at player's position
      const zonesResult = await kv.get(['zones']);
      const zones = zonesResult.value || [];

      const currentZone = zones.find(zone =>
        this.isCoordinateInZone(position, zone)
      );

      if (!currentZone) {
        throw new Error('You are not in any zone');
      }

      const teamResult = await kv.get(['teams', currentZone.teamId]);
      const team = teamResult.value;

      await api.tellraw(sender, JSON.stringify([
        { text: "=== Zone Information ===\n", color: "gold", bold: true },
        { text: "Name: ", color: "gray" },
        { text: `${currentZone.name}\n`, color: team.color },
        { text: "Description: ", color: "gray" },
        { text: `${currentZone.description}\n`, color: "white" },
        { text: "Team: ", color: "gray" },
        { text: `${team.name}\n`, color: team.color },
        { text: "Created by: ", color: "gray" },
        { text: `${currentZone.createdBy}\n`, color: "green" },
        { text: "Created at: ", color: "gray" },
        { text: new Date(currentZone.createdAt).toLocaleDateString(), color: "yellow" },
        currentZone.forSale ? [
          { text: "\nPrice: ", color: "gray" },
          { text: `${currentZone.price} XPL`, color: "gold" }
        ] : []
      ]));

    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'list'])
  @Description('List all zones owned by your team')
  @Permission('player')
  async listZones({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      // Get player's team
      const teamResult = await kv.get(['players', sender, 'team']);
      const teamId = teamResult.value;

      if (!teamId) {
        throw new Error('You are not in a team');
      }

      // Get all zones
      const zonesResult = await kv.get(['zones']);
      const allZones = zonesResult.value || [];

      // Filter zones owned by team
      const teamZones = allZones.filter(zone => zone.teamId === teamId);

      if (teamZones.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "Your team doesn't own any zones",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: "=== Team Zones ===",
        color: "gold",
        bold: true
      }));

      for (const zone of teamZones) {
        await api.tellraw(sender, JSON.stringify([
          { text: `\n${zone.name}`, color: "green", bold: true },
          { text: `\nDescription: ${zone.description}`, color: "white" },
          {
            text: "\n[Teleport]",
            color: "aqua",
            clickEvent: {
              action: "run_command",
              value: `/zone tp ${zone.id}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to teleport to zone"
            }
          }
        ]));
      }
    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'tp'])
  @Description('Teleport to a zone center')
  @Permission('player')
  @Argument([
    { name: 'zoneId', type: 'string', description: 'Zone ID to teleport to' }
  ])
  async teleportToZone({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { zoneId } = args;

    try {
      const zoneResult = await kv.get(['zones', zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error('Zone not found');
      }

      // Check if player is in the team
      const teamResult = await kv.get(['players', sender, 'team']);
      if (teamResult.value !== zone.teamId) {
        throw new Error('You can only teleport to zones owned by your team');
      }

      const { x, y, z } = zone.center;
      await api.teleport(sender, x.toString(), y.toString(), z.toString());

      await api.tellraw(sender, JSON.stringify({
        text: `Teleported to zone ${zone.name}`,
        color: "green"
      }));

      log(`Player ${sender} teleported to zone ${zone.name}`);
    } catch (error) {
      log(`Error in zone teleport: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'modify'])
  @Description('Modify zone settings (team leader only)')
  @Permission('player')
  @Argument([
    { name: 'zoneId', type: 'string', description: 'Zone ID to modify' },
    { name: 'setting', type: 'string', description: 'Setting to modify (description/price)' },
    { name: 'value', type: 'string', description: 'New value' }
  ])
  async modifyZone({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { zoneId, setting, value } = args;

    try {
      const zoneResult = await kv.get(['zones', zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error('Zone not found');
      }

      // Check if player is team leader
      const teamResult = await kv.get(['teams', zone.teamId]);
      const team = teamResult.value;

      if (!team || team.leader !== sender) {
        throw new Error('Only the team leader can modify zones');
      }

      switch (setting.toLowerCase()) {
        case 'description':
          zone.description = value;
          break;
        case 'price':
          const price = parseInt(value);
          if (isNaN(price) || price < 0) {
            throw new Error('Price must be a positive number');
          }
          zone.price = price;
          zone.forSale = price > 0;
          break;
        default:
          throw new Error('Invalid setting. Use description or price');
      }

      await kv.set(['zones', zoneId], zone);

      // Update zone display if description changed
      if (setting === 'description') {
        const coords = this.createSquareCoordinates(zone.center);
        await this.createZoneDisplay(api, coords, zone.name, zone.description);
      }

      await api.tellraw(sender, JSON.stringify({
        text: `Zone ${zone.name} has been updated`,
        color: "green"
      }));

      log(`Player ${sender} modified zone ${zone.name} ${setting}: ${value}`);
    } catch (error) {
      log(`Error modifying zone: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Socket('get_zones')
  async getZones({ kv }: ScriptContext): Promise<any> {
    try {
      const zonesResult = await kv.get(['zones']);
      return {
        success: true,
        data: zonesResult.value || []
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
