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
  size: number;
  allowedPlayers: string[];  // Individual players allowed in zone
  teleportEnabled: boolean;
  forSale: boolean;
  price: number;
  createdAt: string;
  createdBy: string;
}

interface ZonePrice {
  baseSize: number;
  baseCost: number;
  costPerExtraBlock: number;
}

@Module({
  name: 'Zones',
  version: '1.0.1',
  description: 'Zone management with Leukocyte protection and team integration'
})
export class Zones {
  private readonly DEFAULT_ZONE_SIZE = 128;
  private readonly MIN_ZONE_SIZE = 16;
  private readonly MAX_ZONE_SIZE = 512;

  private readonly ZONE_PRICING: ZonePrice = {
    baseSize: 128,
    baseCost: 111,
    costPerExtraBlock: 1
  };

  private createSlug(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '');
  }

  private calculateZoneCost(size: number): number {
    if (size <= this.ZONE_PRICING.baseSize) {
      return this.ZONE_PRICING.baseCost;
    }
    const extraBlocks = size - this.ZONE_PRICING.baseSize;
    return this.ZONE_PRICING.baseCost + (extraBlocks * this.ZONE_PRICING.costPerExtraBlock);
  }

  private validateZoneSize(size: number): void {
    if (size < this.MIN_ZONE_SIZE) {
      throw new Error(`Zone size cannot be smaller than ${this.MIN_ZONE_SIZE} blocks`);
    }
    if (size > this.MAX_ZONE_SIZE) {
      throw new Error(`Zone size cannot be larger than ${this.MAX_ZONE_SIZE} blocks`);
    }
  }

  private createPositions(x: number, y: number, z: number, size: number): [Position, Position, Position, Position] {
    return [
      { x: x - size, y, z: z - size },
      { x: x + size, y, z: z - size },
      { x: x + size, y, z: z + size },
      { x: x - size, y, z: z + size }
    ];
  }

  private isOverlapping(newZone: Zone, existingZone: Zone): boolean {
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

  private async setupZoneProtection(api: any, zone: Zone): Promise<void> {
    try {
      const [p1, p2, p3, p4] = zone.positions;
      const authorityId = `zone_${zone.id}`;

      // Create the protection authority
      await api.executeCommand(`protect add ${authorityId}`);

      // Create the shape for the zone
      await api.executeCommand(`protect shape start`);
      await api.executeCommand(
        `protect shape add ${Math.floor(p1.x)} ${Math.floor(p1.y)} ${Math.floor(p1.z)} ` +
        `${Math.ceil(p3.x)} ${Math.ceil(p3.y)} ${Math.ceil(p3.z)}`
      );
      await api.executeCommand(`protect shape finish ${zone.id}_shape to ${authorityId}`);

      // Set protection rules
      const rules = [
        'place deny',
        'break deny',
        'interact_blocks deny',
        'interact_entities deny',
        'attack deny',
        'throw_items deny',
        'crafting deny'
      ];

      for (const rule of rules) {
        await api.executeCommand(`protect set rule ${authorityId} ${rule}`);
      }

      // Add team membership exclusion
      await api.executeCommand(`protect exclusion add ${authorityId} team ${zone.teamId}`);

      // Add individual player exclusions
      for (const player of zone.allowedPlayers) {
        await api.executeCommand(`protect exclusion add ${authorityId} player ${player}`);
      }

      // Set priority level
      await api.executeCommand(`protect set level ${authorityId} 10`);

    } catch (error) {
      throw new Error(`Failed to setup zone protection: ${error.message}`);
    }
  }

  private async removeZoneProtection(api: any, zoneId: string): Promise<void> {
    try {
      const authorityId = `zone_${zoneId}`;
      await api.executeCommand(`protect remove ${authorityId}`);
    } catch (error) {
      throw new Error(`Failed to remove zone protection: ${error.message}`);
    }
  }

  private async updateZoneAccess(api: any, zone: Zone, player: string, grant: boolean): Promise<void> {
    try {
      const authorityId = `zone_${zone.id}`;
      if (grant) {
        await api.executeCommand(`protect exclusion add ${authorityId} player ${player}`);
      } else {
        await api.executeCommand(`protect exclusion remove ${authorityId} player ${player}`);
      }
    } catch (error) {
      throw new Error(`Failed to update zone access: ${error.message}`);
    }
  }

  private async isTeamLeaderOrOfficer(kv: any, playerId: string, teamId: string): Promise<boolean> {
    const teamResult = await kv.get(['teams', teamId]);
    const team = teamResult.value;
    return team && (team.leader === playerId || team.officers.includes(playerId));
  }

  @Command(['zone', 'create'])
  @Description('Create a new zone (costs vary by size)')
  @Argument([
    { name: 'name', type: 'string', description: 'Zone name' },
    { name: 'description', type: 'string', description: 'Zone description' },
    { name: 'size', type: 'integer', description: 'Zone size in blocks (optional)', optional: true }
  ])
  async createZone({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { name, description } = args;
    const size = args.size || this.DEFAULT_ZONE_SIZE;

    try {
      // Validate zone size
      this.validateZoneSize(size);
      const zoneCost = this.calculateZoneCost(size);

      // Check if player is a team leader
      const teamResult = await kv.get(['players', sender, 'team']);
      const teamId = teamResult.value;
      if (!teamId) {
        throw new Error('You must be in a team to create a zone');
      }

      if (!await this.isTeamLeaderOrOfficer(kv, sender, teamId)) {
        throw new Error('Only team leaders and officers can create zones');
      }

      // Check player balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < zoneCost) {
        throw new Error(`You need ${zoneCost} XPL to create a zone of size ${size}`);
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
        positions: this.createPositions(position.x, position.y, position.z, size),
        center: position,
        size,
        allowedPlayers: [],
        teleportEnabled: false,
        forSale: false,
        price: 0,
        createdAt: new Date().toISOString(),
        createdBy: sender
      };

      // Get existing zones and check for overlap
      const zonesResult = await kv.get(['zones']);
      const existingZones = zonesResult.value || [];

      // Check for duplicate zone ID
      if (existingZones.some(zone => zone.id === zoneId)) {
        throw new Error('A zone with this name already exists');
      }

      // Check for overlapping zones
      const overlapping = existingZones.some(zone => this.isOverlapping(newZone, zone));
      if (overlapping) {
        throw new Error('This zone overlaps with an existing zone or is too close to another zone');
      }

      // Add new zone to the list
      const updatedZones = [...existingZones, newZone];

      // Create zone and deduct XPL atomically
      const result = await kv.atomic()
        .check(zonesResult)
        .mutate({
          type: 'sum',
          key: ['plugins', 'economy', 'balances', sender],
          value: new Deno.KvU64(BigInt(balance - zoneCost))
        })
        .set(['zones'], updatedZones)  // Update the full zones list
        .set(['zones', zoneId], newZone)  // Update the full zones list
        .commit();

      if (!result.ok) {
        throw new Error('Failed to create zone');
      }

      // Set up Leukocyte protection
      await this.setupZoneProtection(api, newZone);

      // Get team data for notification
      const teamDataResult = await kv.get(['teams', teamId]);
      const teamData = teamDataResult.value;

      // Notify team members with size and cost information
      const notificationMessage = JSON.stringify([
        { text: "New Team Zone Created!\n", color: "gold", bold: true },
        { text: `Name: `, color: "gray" },
        { text: name, color: teamData.color },
        { text: "\nSize: ", color: "gray" },
        { text: `${size}x${size}`, color: "aqua" },
        { text: "\nCost: ", color: "gray" },
        { text: `${zoneCost} XPL`, color: "yellow" },
        { text: "\nCreated by: ", color: "gray" },
        { text: sender, color: "green" }
      ]);

      for (const member of teamData.members) {
        await api.tellraw(member, notificationMessage);
      }

      log(`Player ${sender} created zone ${name} (size: ${size}) for team ${teamId}`);

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
  // @Permission('player')
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
      if (!await this.isTeamLeaderOrOfficer(kv, sender, zone.teamId)) {
        throw new Error('Only team leaders and officers can delete zones');
      }

      // Remove Leukocyte protection
      await this.removeZoneProtection(api, zoneId);

      // Delete zone data
      await kv.delete(['zones', zoneId]);

      // Get team data for notification
      const teamResult = await kv.get(['teams', zone.teamId]);
      const team = teamResult.value;

      // Notify team members
      const notificationMessage = JSON.stringify([
        { text: "Zone Deleted\n", color: "gold", bold: true },
        { text: `Zone "${zone.name}" has been deleted by `, color: "yellow" },
        { text: sender, color: team.color }
      ]);

      for (const member of team.members) {
        await api.tellraw(member, notificationMessage);
      }

      log(`Player ${sender} deleted zone ${zone.name}`);

    } catch (error) {
      log(`Error deleting zone: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'allow'])
  @Description('Allow a player to build in your zone')
  // @Permission('player')
  @Argument([
    { name: 'zoneId', type: 'string', description: 'Zone ID' },
    { name: 'player', type: 'player', description: 'Player to allow' }
  ])
  async allowPlayer({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { zoneId, player } = args;

    try {
      // Get zone data
      const zoneResult = await kv.get(['zones', zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error('Zone not found');
      }

      // Check if player has permission
      if (!await this.isTeamLeaderOrOfficer(kv, sender, zone.teamId)) {
        throw new Error('Only team leaders and officers can manage zone access');
      }

      if (zone.allowedPlayers.includes(player)) {
        throw new Error('Player already has access to this zone');
      }

      // Update zone data and Leukocyte protection
      zone.allowedPlayers.push(player);
      await kv.set(['zones', zoneId], zone);
      await this.updateZoneAccess(api, zone, player, true);

      // Get team data for notifications
      const teamResult = await kv.get(['teams', zone.teamId]);
      const team = teamResult.value;

      // Notify relevant players
      await api.tellraw(sender, JSON.stringify({
        text: `${player} has been granted access to zone ${zone.name}`,
        color: team.color
      }));

      await api.tellraw(player, JSON.stringify([
        { text: "Zone Access Granted\n", color: "gold", bold: true },
        { text: "You now have access to zone ", color: "green" },
        { text: zone.name, color: team.color },
        { text: " owned by team ", color: "green" },
        { text: team.name, color: team.color }
      ]));

      log(`${sender} granted ${player} access to zone ${zone.name}`);

    } catch (error) {
      log(`Error in zone allow: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'deny'])
  @Description('Remove a player\'s permission to build in your zone')
  // @Permission('player')
  @Argument([
    { name: 'zoneId', type: 'string', description: 'Zone ID' },
    { name: 'player', type: 'player', description: 'Player to deny' }
  ])
  async denyPlayer({ params, kv, api, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { zoneId, player } = args;

    try {
      // Get zone data
      const zoneResult = await kv.get(['zones', zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error('Zone not found');
      }

      // Check if player has permission
      if (!await this.isTeamLeaderOrOfficer(kv, sender, zone.teamId)) {
        throw new Error('Only team leaders and officers can manage zone access');
      }

      // Get team data to check membership
      const teamResult = await kv.get(['teams', zone.teamId]);
      const team = teamResult.value;

      if (team.members.includes(player)) {
        throw new Error('Cannot deny access to team members');
      }

      if (!zone.allowedPlayers.includes(player)) {
        throw new Error('Player does not have individual access to this zone');
      }

      // Update zone data and Leukocyte protection
      zone.allowedPlayers = zone.allowedPlayers.filter(p => p !== player);
      await kv.set(['zones', zoneId], zone);
      await this.updateZoneAccess(api, zone, player, false);

      // Notify relevant players
      await api.tellraw(sender, JSON.stringify({
        text: `${player}'s access to zone ${zone.name} has been revoked`,
        color: team.color
      }));

      await api.tellraw(player, JSON.stringify([
        { text: "Zone Access Revoked\n", color: "gold", bold: true },
        { text: "Your access to zone ", color: "yellow" },
        { text: zone.name, color: team.color },
        { text: " has been revoked", color: "yellow" }
      ]));

      log(`${sender} revoked ${player}'s access to zone ${zone.name}`);

    } catch (error) {
      log(`Error in zone deny: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Command(['zone', 'info'])
  @Description('Get information about the current zone')
  // @Permission('player')
  async zoneInfo({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      // Get player position
      const position = await api.getPlayerPosition(sender);
      console.log(position)
      // Find zone at player's position
      const zonesResult = await kv.get(['zones']);

      console.log(zonesResult.value)
      const zones = zonesResult.value || [];

      const currentZone = zones.find(zone => {
          console.log(zone)
          this.isCoordinateInZone(position, zone)
        }
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
        { text: "Size: ", color: "gray" },
        { text: `${currentZone.size}x${currentZone.size}\n`, color: "aqua" },
        { text: "Team: ", color: "gray" },
        { text: `${team.name}\n`, color: team.color },
        { text: "Created by: ", color: "gray" },
        { text: `${currentZone.createdBy}\n`, color: "green" },
        { text: "Created at: ", color: "gray" },
        { text: new Date(currentZone.createdAt).toLocaleDateString(), color: "yellow" },
        currentZone.forSale ? [
          { text: "\nPrice: ", color: "gray" },
          { text: `${currentZone.price} XPL`, color: "gold" }
        ] : [],
        { text: "\nAllowed Players: ", color: "gray" },
        { text: currentZone.allowedPlayers.length > 0
            ? currentZone.allowedPlayers.join(', ')
            : "None", color: "white" }
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
  // @Permission('player')
  async listZones({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      // Get player's team
      const teamResult = await kv.get(['players', sender, 'team']);
      const teamId = teamResult.value;

      if (!teamId) {
        throw new Error('You are not in a team');
      }

      // Get team data
      const teamDataResult = await kv.get(['teams', teamId]);
      const teamData = teamDataResult.value;

      // Get all zones
      const zonesResult = await kv.get(['zones']);
      const allZones = zonesResult.value || [];
      console.log(zonesResult)
      console.log(allZones)

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
          { text: ` (${zone.size}x${zone.size})`, color: "aqua" },
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
          },
          { text: " " },
          {
            text: "[Info]",
            color: "yellow",
            clickEvent: {
              action: "run_command",
              value: `/zone info ${zone.id}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click for zone details"
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
  // @Permission('player')
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

      // Check if player can teleport to this zone
      const teamResult = await kv.get(['players', sender, 'team']);
      if (teamResult.value !== zone.teamId && !zone.allowedPlayers.includes(sender)) {
        throw new Error('You can only teleport to zones owned by your team or zones you have access to');
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

  @Command(['zone', 'costs'])
  @Description('View zone costs for different sizes')
  // @Permission('player')
  async viewZoneCosts({ params, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    const sizes = [32, 64, 128, 256, 512];
    const costMessages = sizes.map(size => JSON.stringify([
      { text: `${size}x${size}: `, color: "aqua" },
      { text: `${this.calculateZoneCost(size)} XPL\n`, color: "yellow" }
    ]));

    await api.tellraw(sender, JSON.stringify({
      text: "=== Zone Costs ===\n",
      color: "gold",
      bold: true
    }));

    for (const msg of costMessages) {
      await api.tellraw(sender, msg);
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

  @Socket('get_team_zones')
  async getTeamZones({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { teamId } = params;
      const zonesResult = await kv.get(['zones']);
      const zones = zonesResult.value || [];

      return {
        success: true,
        data: zones.filter(zone => zone.teamId === teamId)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Socket('get_zone_info')
  async getZoneInfo({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { zoneId } = params;
      const zoneResult = await kv.get(['zones', zoneId]);

      if (!zoneResult.value) {
        return {
          success: false,
          error: 'Zone not found'
        };
      }

      // Get team data for the zone
      const teamResult = await kv.get(['teams', zoneResult.value.teamId]);

      return {
        success: true,
        data: {
          ...zoneResult.value,
          team: teamResult.value
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Command(['zone', 'modify'])
  @Description('Modify zone settings')
  // @Permission('player')
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

      // Check if player has permission
      if (!await this.isTeamLeaderOrOfficer(kv, sender, zone.teamId)) {
        throw new Error('Only team leaders and officers can modify zones');
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

      // Get team data for notification
      const teamResult = await kv.get(['teams', zone.teamId]);
      const team = teamResult.value;

      // Notify team members
      const notificationMessage = JSON.stringify([
        { text: "Zone Modified\n", color: "gold", bold: true },
        { text: `${zone.name}: `, color: team.color },
        { text: `${setting} updated by `, color: "yellow" },
        { text: sender, color: "green" }
      ]);

      for (const member of team.members) {
        await api.tellraw(member, notificationMessage);
      }

      log(`Player ${sender} modified zone ${zone.name} ${setting}: ${value}`);
    } catch (error) {
      log(`Error modifying zone: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Socket('check_zone_access')
  async checkZoneAccess({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { playerId, zoneId } = params;

      const zoneResult = await kv.get(['zones', zoneId]);
      if (!zoneResult.value) {
        return {
          success: false,
          error: 'Zone not found'
        };
      }

      const zone = zoneResult.value as Zone;
      const playerTeamResult = await kv.get(['players', playerId, 'team']);

      const hasAccess =
        zone.teamId === playerTeamResult.value ||
        zone.allowedPlayers.includes(playerId);

      return {
        success: true,
        data: {
          hasAccess,
          isTeamZone: zone.teamId === playerTeamResult.value,
          hasIndividualAccess: zone.allowedPlayers.includes(playerId)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Command(['zone', 'scan'])
  @Description('Scan nearby zones')
  // @Permission('player')
  async scanZones({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      // Get player position
      const position = await api.getPlayerPosition(sender);
      const SCAN_RADIUS = 256; // Blocks to scan

      // Get all zones
      const zonesResult = await kv.get(['zones']);
      const allZones = zonesResult.value || [];

      // Filter zones within radius
      const nearbyZones = allZones.filter(zone => {
        const dx = zone.center.x - position.x;
        const dz = zone.center.z - position.z;
        return Math.sqrt(dx * dx + dz * dz) <= SCAN_RADIUS;
      });

      if (nearbyZones.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "No zones found within 256 blocks",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: "=== Nearby Zones ===",
        color: "gold",
        bold: true
      }));

      for (const zone of nearbyZones) {
        const teamResult = await kv.get(['teams', zone.teamId]);
        const team = teamResult.value;
        const distance = Math.round(Math.sqrt(
          Math.pow(zone.center.x - position.x, 2) +
          Math.pow(zone.center.z - position.z, 2)
        ));

        await api.tellraw(sender, JSON.stringify([
          { text: `\n${zone.name}`, color: team.color, bold: true },
          { text: ` (${distance} blocks away)`, color: "gray" },
          { text: `\nTeam: `, color: "gray" },
          { text: team.name, color: team.color },
          { text: `\nSize: `, color: "gray" },
          { text: `${zone.size}x${zone.size}`, color: "aqua" },
          {
            text: "\n[Teleport]",
            color: "aqua",
            clickEvent: {
              action: "run_command",
              value: `/zone tp ${zone.id}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to teleport"
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
}
