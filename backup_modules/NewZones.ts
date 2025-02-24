import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

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
  name: "Zones",
  version: "1.0.1",
  description: "Zone management with teams and economy integration",
})
export class Zones {
  private readonly ZONE_SIZE = 128;
  private readonly ZONE_COST = 1;
  private readonly WORLD_MIN_Y = -64; // 1.20+ world bottom
  private readonly WORLD_MAX_Y = 320; // 1.20+ world top

  private createSlug(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
  }

  private createPositions(
    x: number,
    y: number,
    z: number,
  ): [Position, Position, Position, Position] {
    return [
      { x: x - this.ZONE_SIZE, y, z: z - this.ZONE_SIZE },
      { x: x + this.ZONE_SIZE, y, z: z - this.ZONE_SIZE },
      { x: x + this.ZONE_SIZE, y, z: z + this.ZONE_SIZE },
      { x: x - this.ZONE_SIZE, y, z: z + this.ZONE_SIZE },
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
      point4Y: 0,
    };
  }

  private async updateZoneMarkers(zone: Zone, bluemap: any): Promise<void> {
    const markerId = `zone_${zone.id}`;
    const points = zone.positions.map((p) => ({
      x: p.x,
      y: zone.center.y,
      z: p.z,
    }));

    // Add zone boundary marker
    await bluemap.addMarker("zones", markerId, "shape", {
      label: zone.name,
      shape: points,
      shapeY: zone.center.y,
      lineWidth: 3,
      lineColor: { r: 0, g: 255, b: 0, a: 255 },
      fillColor: { r: 0, g: 255, b: 0, a: 64 },
    });

    // Add teleport point marker
    await bluemap.addMarker("zones", `${markerId}_tp`, "poi", {
      label: `${zone.name} Teleport`,
      position: zone.center,
      icon: "spawn",
      maxDistance: 1000,
    });
  }

  private async createZoneDisplay(
    rcon: any,
    coords: any,
    name: string,
    description: string,
  ): Promise<void> {
    try {
      // Create text displays using RCON
      await rcon.executeCommand(
        `summon text_display ${coords.centerX} ${
          coords.centerY + 3
        } ${coords.centerZ} {text:'${
          JSON.stringify(name)
        }',background:0,transformation:{translation:[0f,0f,0f],scale:[2f,2f,2f]},billboard:"center"}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      await rcon.executeCommand(
        `summon text_display ${coords.centerX} ${
          coords.centerY + 2
        } ${coords.centerZ} {text:'${
          JSON.stringify(description)
        }',background:0,transformation:{translation:[0f,0f,0f],scale:[1f,1f,1f]},billboard:"center"}`,
      );

      // Add glowing armor stand as central marker
      await rcon.executeCommand(
        `summon armor_stand ${coords.centerX} ${coords.centerY} ${coords.centerZ} {Glowing:1b,CustomNameVisible:1b,CustomName:'{"text":"Zone Center","color":"gold"}',Invisible:1b}`,
      );
    } catch (error) {
      throw new Error(`Failed to create zone display: ${error.message}`);
    }
  }

  private async changeZoneDisplay(
    rcon: any,
    coords: any,
    name: string,
    description: string,
  ): Promise<void> {
    try {
      // Remove existing displays
      await rcon.executeCommand(`kill @e[type=text_display,distance=..10]`);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Create new displays
      await this.createZoneDisplay(rcon, coords, name, description);
    } catch (error) {
      throw new Error(`Failed to update zone display: ${error.message}`);
    }
  }

  private async removeZoneProtection(rcon: any, coords: any): Promise<void> {
    try {
      // Remove command blocks and redstone
      const blocks = [
        { x: coords.point2X + 128, y: 2, z: coords.point2Z + 128 }, // Center - Team members
        { x: coords.point2X + 128, y: 1, z: coords.point2Z + 127 }, // North border
        { x: coords.point2X + 129, y: 1, z: coords.point2Z + 128 }, // East border
        { x: coords.point2X + 128, y: 1, z: coords.point2Z + 129 }, // South border
        { x: coords.point2X + 127, y: 1, z: coords.point2Z + 128 }, // West border
        { x: coords.point2X + 128, y: 0, z: coords.point2Z + 128 }, // Center - Non-team members
        { x: coords.point2X + 128, y: 3, z: coords.point2Z + 128 }, // Redstone block
      ];

      // Remove all command blocks
      for (const block of blocks) {
        await rcon.executeCommand(
          `setblock ${block.x} ${block.y} ${block.z} air`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Remove corner markers
      const corners = [
        { x: coords.point1X, z: coords.point1Z },
        { x: coords.point2X, z: coords.point2Z },
        { x: coords.point3X, z: coords.point3Z },
        { x: coords.point4X, z: coords.point4Z },
      ];

      for (const corner of corners) {
        // Remove glowstone, fence, and lantern
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY} ${corner.z} air`,
        );
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY + 1} ${corner.z} air`,
        );
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY + 2} ${corner.z} air`,
        );
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY + 3} ${corner.z} air`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Remove center teleport marker
      await rcon.executeCommand(
        `setblock ${coords.centerX} ${coords.centerY} ${coords.centerZ} air`,
      );
      await rcon.executeCommand(
        `setblock ${coords.centerX} ${
          coords.centerY + 1
        } ${coords.centerZ} air`,
      );

      // Remove text displays and armor stands
      await rcon.executeCommand(`kill @e[type=text_display,distance=..10]`);
      await rcon.executeCommand(`kill @e[type=armor_stand,distance=..10]`);
    } catch (error) {
      throw new Error(`Failed to remove zone protection: ${error.message}`);
    }
  }

  private async setupZoneProtection(
    rcon: any,
    coords: any,
    teamId: string,
  ): Promise<void> {
    // Command block content with full height range protection
    const commandBlocks = [
      {
        // Center - Team members survival mode
        x: coords.point2X + 128,
        y: 0,
        z: coords.point2Z + 128,
        cmd: `gamemode survival @a[x=${
          coords.point2X + 4
        },y=${this.WORLD_MIN_Y},z=${coords.point2Z + 4},dx=247,dy=${
          this.WORLD_MAX_Y - this.WORLD_MIN_Y
        },dz=247,gamemode=adventure,team=${teamId}]`,
      },
      {
        // North border
        x: coords.point2X + 128,
        y: 0,
        z: coords.point2Z + 127,
        cmd:
          `gamemode survival @a[x=${coords.point2X},y=${this.WORLD_MIN_Y},z=${coords.point2Z},dx=250,dy=${
            this.WORLD_MAX_Y - this.WORLD_MIN_Y
          },dz=2,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // East border
        x: coords.point2X + 129,
        y: 0,
        z: coords.point2Z + 128,
        cmd: `gamemode survival @a[x=${
          coords.point1X - 3
        },y=${this.WORLD_MIN_Y},z=${coords.point1Z},dx=2,dy=${
          this.WORLD_MAX_Y - this.WORLD_MIN_Y
        },dz=250,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // South border
        x: coords.point2X + 128,
        y: 0,
        z: coords.point2Z + 129,
        cmd: `gamemode survival @a[x=${
          coords.point3X + 3
        },y=${this.WORLD_MIN_Y},z=${coords.point3Z - 3},dx=250,dy=${
          this.WORLD_MAX_Y - this.WORLD_MIN_Y
        },dz=2,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // West border
        x: coords.point2X + 127,
        y: 0,
        z: coords.point2Z + 128,
        cmd:
          `gamemode survival @a[x=${coords.point2X},y=${this.WORLD_MIN_Y},z=${
            coords.point2Z + 3
          },dx=2,dy=${
            this.WORLD_MAX_Y - this.WORLD_MIN_Y
          },dz=250,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // Center - Non-team members adventure mode
        x: coords.point2X + 128,
        y: 1,
        z: coords.point2Z + 128,
        cmd: `gamemode adventure @a[x=${
          coords.point2X + 4
        },y=${this.WORLD_MIN_Y},z=${coords.point2Z + 4},dx=247,dy=${
          this.WORLD_MAX_Y - this.WORLD_MIN_Y
        },dz=247,gamemode=survival,team=!${teamId}]`,
      },
    ];

    try {
      // Place all command blocks using RCON
      for (const block of commandBlocks) {
        const command =
          `setblock ${block.x} ${block.y} ${block.z} repeating_command_block[facing=up]{auto:1b,Command:"${block.cmd}"}`;
        await rcon.executeCommand(command);
        await new Promise((resolve) => setTimeout(resolve, 200)); // Delay to prevent server overload
      }

      // Place stone base for redstone
      await rcon.executeCommand(
        `setblock ${coords.point2X + 128} 2 ${coords.point2Z + 128} stone`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Place redstone to power the system
      await rcon.executeCommand(
        `setblock ${coords.point2X + 128} 3 ${
          coords.point2Z + 128
        } redstone_block`,
      );

      // Add visual corner markers
      const cornerBlocks = [
        { x: coords.point1X, z: coords.point1Z }, // Northwest
        { x: coords.point2X, z: coords.point2Z }, // Northeast
        { x: coords.point3X, z: coords.point3Z }, // Southeast
        { x: coords.point4X, z: coords.point4Z }, // Southwest
      ];

      for (const corner of cornerBlocks) {
        // Place glowstone markers at corners
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY} ${corner.z} glowstone`,
        );

        // Place fence posts above for visibility
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY + 1} ${corner.z} oak_fence`,
        );
        await rcon.executeCommand(
          `setblock ${corner.x} ${coords.centerY + 2} ${corner.z} oak_fence`,
        );

        // Add lantern on top
        await rcon.executeCommand(
          `setblock ${corner.x} ${
            coords.centerY + 3
          } ${corner.z} lantern[hanging=false]`,
        );

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Create center teleport marker
      await rcon.executeCommand(
        `setblock ${coords.centerX} ${coords.centerY} ${coords.centerZ} lodestone`,
      );
      await rcon.executeCommand(
        `setblock ${coords.centerX} ${
          coords.centerY + 1
        } ${coords.centerZ} end_rod`,
      );
    } catch (error) {
      throw new Error(`Failed to setup zone protection: ${error.message}`);
    }
  }

  @Command(["zones"])
  @Description("Zone management commands")
  @Permission("player")
  async zone(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "=== Zone Commands ===\n", color: "gold", bold: true },
          { text: "/zones create <name> <description>", color: "yellow" },
          {
            text: ` - Create a new zone (costs ${this.ZONE_COST} XPL)\n`,
            color: "gray",
          },
          {
            text: "/zones list",
            color: "yellow",
            clickEvent: { action: "run_command", value: "/zones list" },
            hoverEvent: {
              action: "show_text",
              value: "Click to list your team's zones",
            },
          },
          { text: " - List all zones owned by your team\n", color: "gray" },

          {
            text: "/zones info",
            color: "yellow",
            clickEvent: {
              action: "run_command",
              value: "/zones info",
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to view current zone info",
            },
          },
          {
            text: " - Get information about the current zone\n",
            color: "gray",
          },

          { text: "/zones info <zoneId>", color: "yellow" },
          { text: " - Get information about a specific zone\n", color: "gray" },

          { text: "/zones modify <zoneId> <setting> <value>", color: "yellow" },
          {
            text: " - Modify zone settings (team leader only)\n",
            color: "gray",
          },

          { text: "/zones tp <zoneId>", color: "yellow" },
          { text: " - Teleport to a zone's center\n", color: "gray" },

          { text: "/zones delete <zoneId>", color: "yellow" },
          { text: " - Delete a zone (team leader only)\n", color: "gray" },

          { text: "\n\n", color: "white" },
          {
            text: "[Suggest Command]",
            color: "green",
            clickEvent: {
              action: "suggest_command",
              value: "/zones ",
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to write a zone command",
            },
          },
        ]),
      );

      return { messages };
    } catch (error) {
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "create"])
  @Description("Create a new zone (costs 1 XPL)")
  @Permission("player")
  @Argument([
    { name: "name", type: "string", description: "Zone name" },
    { name: "description", type: "string", description: "Zone description" },
  ])
  async createZone(
    { params, kv, tellraw, log, rcon, api, bluemap }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean; zone?: Zone }> {
    const { sender, args } = params;
    const { name, description } = args;
    let messages = [];

    try {
      // Check team leadership
      const teamResult = await kv.get(["players", sender, "team"]);
      const teamId = teamResult.value;
      if (!teamId) {
        throw new Error("You must be in a team to create a zone");
      }

      const teamDataResult = await kv.get(["teams", teamId]);
      const teamData = teamDataResult.value;
      if (!teamData || teamData.leader !== sender) {
        throw new Error("Only team leaders can create zones");
      }

      // Check balance
      const balanceResult = await kv.get([
        "plugins",
        "economy",
        "balances",
        sender,
      ]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < this.ZONE_COST) {
        throw new Error(`You need ${this.ZONE_COST} XPL to create a zone`);
      }

      // Create zone
      const position = await api.getPlayerPosition(kv, sender);
      const zoneId = this.createSlug(name);
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
        createdBy: sender,
      };

      // Check for overlapping zones
      const existingZones = await this.getAllZones(kv);
      if (existingZones.some((zone) => this.isOverlapping(newZone, zone))) {
        throw new Error("This zone overlaps with an existing zone");
      }

      // Create zone and deduct XPL
      const result = await kv.atomic()
        .check({ key: ["zones", zoneId], versionstamp: null })
        .check({
          key: ["plugins", "economy", "balances", sender],
          versionstamp: balanceResult.versionstamp,
        })
        .set(["zones", zoneId], newZone)
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(balance - this.ZONE_COST)),
        )
        .commit();

      if (!result.ok) {
        throw new Error("Failed to create zone - transaction failed");
      }

      // Set up protection and displays
      const coords = this.createSquareCoordinates(position);
      await this.setupZoneProtection(rcon, coords, teamId);
      await this.updateZoneMarkers(newZone, bluemap);
      await this.createZoneDisplay(rcon, coords, name, description);

      // Notify team
      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Zone Created Successfully!\n", color: "green", bold: true },
          { text: "Name: ", color: "gray" },
          { text: name, color: teamData.color },
          { text: "\nUse ", color: "gray" },
          {
            text: `/zones tp ${zoneId}`,
            color: "yellow",
            clickEvent: { action: "run_command", value: `/zones tp ${zoneId}` },
          },
          { text: " to teleport", color: "gray" },
        ]),
      );

      log(`Zone created: ${name} by ${sender} for team ${teamId}`);
      return { messages, success: true, zone: newZone };
    } catch (error) {
      log(`Error creating zone: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["zones", "info"])
  @Description("Get information about the current zone or a specific zone")
  @Permission("player")
  @Argument([
    {
      name: "zoneId",
      type: "string",
      description: "Zone ID (optional)",
      required: false,
    },
  ])
  async zoneInfo(
    { params, kv, tellraw, log, rcon, bluemap }: ScriptContext,
  ): Promise<{ messages: any[]; zone?: Zone }> {
    const { sender, args } = params;
    let messages = [];

    try {
      let currentZone: Zone | null = null;

      if (args.zoneId) {
        const zoneResult = await kv.get(["zones", args.zoneId]);
        currentZone = zoneResult.value as Zone;
        if (!currentZone) {
          throw new Error("Zone not found");
        }
      } else {
        const position = await this.getPlayerPosition(kv, sender);
        const zones = await this.getAllZones(kv);
        currentZone = zones.find((zone) =>
          this.isCoordinateInZone(position, zone)
        ) || null;

        if (!currentZone) {
          throw new Error("You are not in any zone");
        }
      }

      const teamResult = await kv.get(["teams", currentZone.teamId]);
      const team = teamResult.value;

      // Calculate dimensions
      const size = this.calculateZoneSize(currentZone);
      const area = size.width * size.length;

      // Create visual effects
      await this.displayZoneEffects(rcon, currentZone);
      await this.highlightZoneOnMap(bluemap, currentZone);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "⚡ Zone Information ⚡\n", color: "gold", bold: true },
          { text: "Name: ", color: "gray" },
          { text: `${currentZone.name}\n`, color: team.color, bold: true },
          { text: "Description: ", color: "gray" },
          { text: `${currentZone.description}\n`, color: "white" },
          // ... [Rest of the formatted info]
        ]),
      );

      log(`Zone info displayed for ${sender}: ${currentZone.name}`);
      return { messages, zone: currentZone };
    } catch (error) {
      log(`Error displaying zone info: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "list"])
  @Description("List all zones owned by your team")
  @Permission("player")
  async listZones(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; zones?: Zone[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const teamResult = await kv.get(["players", sender, "team"]);
      const teamId = teamResult.value;
      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const zones = await this.getAllZones(kv);
      const teamZones = zones.filter((zone) => zone.teamId === teamId);

      if (teamZones.length === 0) {
        messages = await tellraw(
          sender,
          JSON.stringify({
            text: "Your team doesn't own any zones",
            color: "yellow",
          }),
        );
        return { messages, zones: [] };
      }

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "=== Team Zones ===\n", color: "gold", bold: true },
          ...teamZones.flatMap((zone) => [
            { text: `\n${zone.name}`, color: "green", bold: true },
            { text: `\nDescription: ${zone.description}`, color: "white" },
            {
              text: "\n[Teleport]",
              color: "aqua",
              clickEvent: {
                action: "run_command",
                value: `/zones tp ${zone.id}`,
              },
            },
          ]),
        ]),
      );

      log(`Listed ${teamZones.length} zones for ${sender}`);
      return { messages, zones: teamZones };
    } catch (error) {
      log(`Error listing zones: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "modify"])
  @Description("Modify zone settings (team leader only)")
  @Permission("player")
  @Argument([
    { name: "zoneId", type: "string", description: "Zone ID to modify" },
    {
      name: "setting",
      type: "string",
      description: "Setting to modify (description/price)",
    },
    { name: "value", type: "string", description: "New value" },
  ])
  async modifyZone(
    { params, kv, tellraw, log, rcon }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean; zone?: Zone }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const zoneResult = await kv.get(["zones", args.zoneId]);
      const zone = zoneResult.value as Zone;
      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["teams", zone.teamId]);
      const team = teamResult.value;
      if (!team || team.leader !== sender) {
        throw new Error("Only the team leader can modify zones");
      }

      const updatedZone = { ...zone };
      switch (args.setting.toLowerCase()) {
        case "description":
          updatedZone.description = args.value;
          break;
        case "price":
          const price = parseInt(args.value);
          if (isNaN(price) || price < 0) {
            throw new Error("Price must be a positive number");
          }
          updatedZone.price = price;
          updatedZone.forSale = price > 0;
          break;
        default:
          throw new Error("Invalid setting. Use description or price");
      }

      await kv.set(["zones", args.zoneId], updatedZone);

      if (args.setting === "description") {
        const coords = this.createSquareCoordinates(zone.center);
        await this.changeZoneDisplay(rcon, coords, zone.name, args.value);
      }

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Zone Updated Successfully!\n", color: "green", bold: true },
          { text: `${args.setting}: `, color: "gray" },
          { text: args.value, color: "yellow" },
        ]),
      );

      log(
        `Zone ${zone.name} modified by ${sender}: ${args.setting} = ${args.value}`,
      );
      return { messages, success: true, zone: updatedZone };
    } catch (error) {
      log(`Error modifying zone: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["zones", "delete"])
  @Description("Delete a zone")
  @Permission("player")
  @Argument([
    { name: "zoneId", type: "string", description: "Zone ID to delete" },
  ])
  async deleteZone(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const zoneResult = await kv.get(["zones", args.zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["teams", zone.teamId]);
      const team = teamResult.value;
      if (!team || team.leader !== sender) {
        throw new Error("Only the team leader can delete zones");
      }

      // Store pending deletion and set expiration
      await kv.set(
        ["pending_deletions", sender, args.zoneId],
        { timestamp: Date.now(), zoneId: zone.id },
      );

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "⚠️ Confirm Zone Deletion ⚠️\n", color: "red", bold: true },
          { text: "Are you sure you want to delete zone ", color: "yellow" },
          { text: zone.name, color: team.color, bold: true },
          { text: "?\n\n", color: "yellow" },
          {
            text: "[Click to Confirm]",
            color: "red",
            bold: true,
            clickEvent: {
              action: "run_command",
              value: `/zones confirm-delete ${args.zoneId}`,
            },
            hoverEvent: {
              action: "show_text",
              value: "WARNING: This action cannot be undone!",
            },
          },
          {
            text: "\n\nThis confirmation will expire in 60 seconds.",
            color: "gray",
            italic: true,
          },
        ]),
      );

      // Set deletion expiration
      setTimeout(async () => {
        await kv.delete(["pending_deletions", sender, args.zoneId]);
      }, 60000);

      log(`Delete confirmation requested for zone ${zone.name} by ${sender}`);
      return { messages };
    } catch (error) {
      log(`Error in delete request: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "confirm-delete"])
  @Description("Confirm zone deletion")
  @Permission("player")
  @Argument([
    {
      name: "zoneId",
      type: "string",
      description: "Zone ID to confirm deletion",
    },
  ])
  async confirmDeleteZone(
    { params, kv, tellraw, log, rcon, bluemap }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      // Check pending deletion
      const pendingResult = await kv.get([
        "pending_deletions",
        sender,
        args.zoneId,
      ]);
      if (!pendingResult.value) {
        throw new Error(
          "No pending deletion found or confirmation expired. Please start the deletion process again.",
        );
      }

      // Get zone and team data
      const zoneResult = await kv.get(["zones", args.zoneId]);
      const zone = zoneResult.value as Zone;
      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["teams", zone.teamId]);
      const team = teamResult.value;

      // Cleanup zone
      const coords = this.createSquareCoordinates(zone.center);
      await this.removeZoneProtection(rcon, coords);
      await bluemap.removeMarker("zones", `zone_${zone.id}`);
      await bluemap.removeMarker("zones", `zone_${zone.id}_tp`);

      // Delete zone data
      const result = await kv.atomic()
        .check(zoneResult)
        .delete(["zones", args.zoneId])
        .delete(["pending_deletions", sender, args.zoneId])
        .commit();

      if (!result.ok) {
        throw new Error("Failed to delete zone data");
      }

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Zone Deleted Successfully!\n", color: "red", bold: true },
          { text: zone.name, color: "yellow" },
          { text: " has been permanently removed.", color: "gray" },
        ]),
      );

      // Notify team members
      for (const member of team.members) {
        if (member !== sender) {
          await tellraw(
            member,
            JSON.stringify([
              { text: "Zone Deleted\n", color: "red", bold: true },
              { text: zone.name, color: "yellow" },
              { text: " was deleted by ", color: "gray" },
              { text: sender, color: "green" },
            ]),
          );
        }
      }

      log(`Zone ${zone.name} deleted by ${sender}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in zone deletion: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["zones", "tp"])
  @Description("Teleport to a zone center")
  @Permission("player")
  @Argument([
    { name: "zoneId", type: "string", description: "Zone ID to teleport to" },
  ])
  async teleportToZone(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const zoneResult = await kv.get(["zones", args.zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      // Check if player is in the team
      const teamResult = await kv.get(["players", sender, "team"]);
      if (teamResult.value !== zone.teamId) {
        throw new Error("You can only teleport to zones owned by your team");
      }

      // Perform teleport
      await this.teleportPlayer(sender, zone.center);

      messages = await tellraw(
        sender,
        JSON.stringify([
          { text: "Teleported to ", color: "green" },
          { text: zone.name, color: "yellow", bold: true },
          { text: "\nLocation: ", color: "gray" },
          {
            text: `${Math.floor(zone.center.x)}, ${
              Math.floor(zone.center.y)
            }, ${Math.floor(zone.center.z)}`,
            color: "aqua",
            clickEvent: {
              action: "copy_to_clipboard",
              value: `${Math.floor(zone.center.x)} ${
                Math.floor(zone.center.y)
              } ${Math.floor(zone.center.z)}`,
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to copy coordinates",
            },
          },
        ]),
      );

      log(`Player ${sender} teleported to zone ${zone.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in teleport: ${error.message}`);
      messages = await tellraw(
        sender,
        JSON.stringify({
          text: `Error: ${error.message}`,
          color: "red",
        }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  private async teleportPlayer(
    player: string,
    position: Position,
  ): Promise<void> {
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);

    // Find safe landing spot
    let safeY = y;
    while (safeY > this.WORLD_MIN_Y) {
      const blockBelow = await this.getBlock(x, safeY - 1, z);
      if (this.isSolidBlock(blockBelow)) {
        break;
      }
      safeY--;
    }

    await this.executeCommand(`tp ${player} ${x} ${safeY} ${z}`);
  }

  @Event("player_moved")
  async handlePlayerMovement(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { playerName, x, y, z } = params;
    let messages = [];

    try {
      const position = { x: Number(x), y: Number(y), z: Number(z) };
      const zones = await this.getAllZones(kv);

      for (const zone of zones) {
        if (this.isCoordinateInZone(position, zone)) {
          const lastZoneResult = await kv.get(["player_last_zone", playerName]);
          const lastZoneId = lastZoneResult.value;

          if (lastZoneId !== zone.id) {
            const teamResult = await kv.get(["teams", zone.teamId]);
            const team = teamResult.value;

            messages = await tellraw(
              playerName,
              JSON.stringify([
                { text: "Entering Zone: ", color: "gold" },
                { text: zone.name, color: team.color, bold: true },
                { text: "\n" + zone.description, color: "gray" },
              ]),
            );

            await kv.set(["player_last_zone", playerName], zone.id);
          }
          break;
        }
      }

      return { messages };
    } catch (error) {
      return { messages: [] };
    }
  }

  @Event("denorite_connected")
  async initializeMarkerSets({ bluemap, log }: ScriptContext): Promise<void> {
    try {
      await bluemap.createMarkerSet("zones", {
        label: "Protected Zones",
        toggleable: true,
        defaultHidden: false,
        sorting: 1,
      });

      log("Zone marker set initialized");
    } catch (error) {
      log(`Error initializing zone markers: ${error.message}`);
    }
  }

  @Socket("get_zones")
  async getZones({ kv }: ScriptContext): Promise<any> {
    try {
      const zonesResult = await kv.get(["zones"]);
      return {
        success: true,
        data: zonesResult.value || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
