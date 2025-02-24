import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";
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

interface MapSymbol {
  char: string;
  color: string;
  name?: string;
  type?: string;
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
    return name
      .toLowerCase()
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
      p1.x > q2.x + buffer ||
      p2.x < q1.x - buffer ||
      p1.z > q3.z + buffer ||
      p3.z < q1.z - buffer
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

  private minecraftColorToRGB(color: string): {
    r: number;
    g: number;
    b: number;
  } {
    const colorMap: Record<string, { r: number; g: number; b: number }> = {
      black: { r: 0, g: 0, b: 0 },
      dark_blue: { r: 0, g: 0, b: 170 },
      dark_green: { r: 0, g: 170, b: 0 },
      dark_aqua: { r: 0, g: 170, b: 170 },
      dark_red: { r: 170, g: 0, b: 0 },
      dark_purple: { r: 170, g: 0, b: 170 },
      gold: { r: 255, g: 170, b: 0 },
      gray: { r: 170, g: 170, b: 170 },
      dark_gray: { r: 85, g: 85, b: 85 },
      blue: { r: 85, g: 85, b: 255 },
      green: { r: 85, g: 255, b: 85 },
      aqua: { r: 85, g: 255, b: 255 },
      red: { r: 255, g: 85, b: 85 },
      light_purple: { r: 255, g: 85, b: 255 },
      yellow: { r: 255, g: 255, b: 85 },
      white: { r: 255, g: 255, b: 255 },
    };

    return colorMap[color] || { r: 0, g: 255, b: 0 }; // Default to green if color not found
  }

  private async updateZoneMarkers(
    zone: Zone,
    teamColor: string,
    bluemap: any,
  ): Promise<void> {
    const markerId = `zone_${zone.id}`;
    const points = zone.positions.map((p) => ({
      x: p.x,
      y: zone.center.y,
      z: p.z,
    }));

    const rgbColor = this.minecraftColorToRGB(teamColor);

    // Add zone boundary marker with team color
    await bluemap.addMarker("zones", markerId, "shape", {
      label: zone.name,
      shape: points,
      shapeY: zone.center.y,
      lineWidth: 3,
      lineColor: { ...rgbColor, a: 255 },
      fillColor: { ...rgbColor, a: 64 },
      maxDistance: 10000000,
    });

    // Add teleport point marker
    // await bluemap.addMarker("zones", `${markerId}_tp`, "poi", {
    //   label: `${zone.name} Teleport`,
    //   position: zone.center,
    //   icon: "items/ender_pearl.png",
    //   maxDistance: 1000,
    // });
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
      // await rcon.executeCommand(
      //   `summon armor_stand ${coords.centerX} ${coords.centerY} ${coords.centerZ} {Glowing:1b,CustomNameVisible:1b,CustomName:'{"text":"Zone Center","color":"gold"}',Invisible:1b}`,
      // );
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
  async zone({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const helpMenu = container([
        text("=== Zone Commands ===\n", {
          style: { color: "gold", styles: ["bold"] },
        }),

        button("/zones map [zoom]", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/zones map ",
          },
        }),
        text(" - Show ASCII map of zones around you\n", {
          style: { color: "gray" },
        }),

        button("/zones create <name> <description>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/zones create ",
          },
        }),
        text(" - Create a new zone (costs 1 XPL)\n", {
          style: { color: "gray" },
        }),

        button("/zones list", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/zones list",
          },
        }),
        text(" - List all zones owned by your team\n", {
          style: { color: "gray" },
        }),

        button("/zones market", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/zones market",
          },
        }),
        text(" - Browse zones available for purchase\n", {
          style: { color: "gray" },
        }),

        button("/zones hubs", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/zones hubs",
          },
        }),
        text(" - List all available teleport hubs\n", {
          style: { color: "gray" },
        }),

        button("/zones info", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/zones info",
          },
        }),
        text(" - Get information about the current zone\n", {
          style: { color: "gray" },
        }),

        button("/zones modify <zoneId> <setting> <value>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/zones modify ",
          },
        }),
        text(" - Modify zone settings (team leader only)\n", {
          style: { color: "gray" },
        }),

        button("/zones tp <zoneId>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/zones tp ",
          },
        }),
        text(" - Teleport to a zone's center\n", { style: { color: "gray" } }),

        button("/zones delete <zoneId>", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/zones delete ",
          },
        }),
        text(" - Delete a zone (team leader only)", {
          style: { color: "gray" },
        }),
      ]);

      const messages = await tellraw(
        sender,
        helpMenu.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
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
  async createZone({
    params,
    kv,
    tellraw,
    api,
    rcon,
    bluemap,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { name, description } = args;
    let messages: any[] = [];

    try {
      // Check if player is a team leader
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

      // Check player balance
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
        createdBy: sender,
      };

      // Check for overlapping zones
      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        zones.push(entry.value);
      }

      const overlapping = zones.some((zone) =>
        this.isOverlapping(newZone, zone)
      );
      if (overlapping) {
        throw new Error(
          "This zone overlaps with an existing zone or is too close to another zone",
        );
      }

      // Create zone and deduct XPL atomically
      const result = await kv
        .atomic()
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

      // Set up command blocks for zone protection
      const coords = this.createSquareCoordinates(position);
      await this.setupZoneProtection(rcon, coords, teamId);

      // Add zone markers to BlueMap
      await this.updateZoneMarkers(newZone, teamData.color, bluemap);

      // Create info display
      await this.createZoneDisplay(rcon, coords, name, description);

      // Update notification message using tellraw-ui
      const notificationContent = container([
        text("New Team Zone Created!\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("Name: ", { style: { color: "gray" } }),
        text(name + "\n", { style: { color: teamData.color } }),
        text("Created by: ", { style: { color: "gray" } }),
        text(sender + "\n", { style: { color: "green" } }),
        button("Teleport to Zone", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: `/zones tp ${zoneId}`,
          },
        }),
      ]);

      for (const member of teamData.members) {
        const memberMessages = await tellraw(
          member,
          notificationContent.render({ platform: "minecraft", player: member }),
        );
        messages = messages.concat(memberMessages);
      }

      log(`Player ${sender} created zone ${name} for team ${teamId}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error creating zone: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Zone Creation Failed",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "list"])
  @Description("List all zones owned by your team")
  @Permission("player")
  async listZones({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages: any[] = [];

    try {
      const teamResult = await kv.get(["players", sender, "team"]);
      const teamId = teamResult.value;

      if (!teamId) {
        throw new Error("You are not in a team");
      }

      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        zones.push(entry.value);
      }

      const teamZones = zones.filter((zone) => zone.teamId === teamId);

      if (teamZones.length === 0) {
        const noZonesMsg = container([
          text("Your team doesn't own any zones", {
            style: { color: "yellow" },
          }),
        ]);
        messages = await tellraw(
          sender,
          noZonesMsg.render({ platform: "minecraft", player: sender }),
        );
        return { messages };
      }

      const zoneList = container([
        text("=== Team Zones ===\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        ...teamZones.flatMap((zone) => [
          // Zone name as clickable button
          button(zone.name, {
            variant: "ghost",
            style: { color: "green", styles: ["bold"] },
            onClick: {
              action: "run_command",
              value: `/zones info ${zone.id}`,
            },
          }),
          text("\n"),

          // Zone status indicators
          text("Status: ", { style: { color: "gray" } }),
          ...(zone.teleportEnabled
            ? [text("🌟 Teleport Hub ", { style: { color: "aqua" } })]
            : []),
          ...(zone.forSale
            ? [
              text("💰 For Sale ", { style: { color: "yellow" } }),
              text(`(${zone.price} XPL)`, { style: { color: "gold" } }),
            ]
            : []),
          ...(!zone.teleportEnabled && !zone.forSale
            ? [text("🔒 Private", { style: { color: "gray" } })]
            : []),
          text("\n"),

          // Zone description
          text("Description: ", { style: { color: "gray" } }),
          text(`${zone.description}\n`, { style: { color: "white" } }),

          // Location info
          text("Location: ", { style: { color: "gray" } }),
          text(
            `${Math.floor(zone.center.x)}, ${Math.floor(zone.center.y)}, ${
              Math.floor(zone.center.z)
            }`,
            {
              style: { color: "aqua" },
              onClick: {
                action: "copy_to_clipboard",
                value: `${Math.floor(zone.center.x)} ${
                  Math.floor(zone.center.y)
                } ${Math.floor(zone.center.z)}`,
              },
            },
          ),
          text("\n"),

          // Quick actions
          button("Teleport", {
            variant: "success",
            onClick: {
              action: "run_command",
              value: `/zones tp ${zone.id}`,
            },
          }),
          text(" "),
          button("Info", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: `/zones info ${zone.id}`,
            },
          }),
          text("\n"),
          divider(),
        ]),
      ]);

      messages = await tellraw(
        sender,
        zoneList.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
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
  async zoneInfo({
    params,
    kv,
    tellraw,
    rcon,
    bluemap,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    let messages: any[] = [];

    try {
      let currentZone: Zone | null = null;

      if (args.zoneId) {
        const zoneResult = await kv.get(["zones", args.zoneId]);
        currentZone = zoneResult.value as Zone;
        if (!currentZone) {
          throw new Error("Zone not found");
        }
      } else {
        const position = await api.getPlayerPosition(sender);
        const entriesIterator = kv.list({ prefix: ["zones"] });
        for await (const entry of entriesIterator) {
          const zone = entry.value as Zone;
          if (this.isCoordinateInZone(position, zone)) {
            currentZone = zone;
            break;
          }
        }

        if (!currentZone) {
          throw new Error("You are not in any zone");
        }
      }

      const teamResult = await kv.get(["teams", currentZone.teamId]);
      const team = teamResult.value;
      const isTeamLeader = team.leader === sender;

      // Calculate zone dimensions
      const size = {
        width: Math.abs(
          currentZone.positions[0].x - currentZone.positions[1].x,
        ),
        length: Math.abs(
          currentZone.positions[0].z - currentZone.positions[2].z,
        ),
        height: this.WORLD_MAX_Y - this.WORLD_MIN_Y,
      };

      // Format creation date
      const creationDate = new Date(currentZone.createdAt).toLocaleDateString(
        "en-US",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
      );

      const infoDisplay = container([
        // Title
        text("⚡ Zone Information ⚡\n", {
          style: { color: "gold", styles: ["bold"] },
        }),

        // Basic Info
        text("Name: ", { style: { color: "gray" } }),
        text(`${currentZone.name}\n`, {
          style: { color: team.color, styles: ["bold"] },
        }),

        text("Description: ", { style: { color: "gray" } }),
        text(`${currentZone.description}\n`, { style: { color: "white" } }),

        text("Team: ", { style: { color: "gray" } }),
        text(`${team.name}`, { style: { color: team.color } }),
        text(` (${team.members.length} members)\n`, {
          style: { color: "gray" },
        }),

        // Status Section
        text("\n📊 Status\n", { style: { color: "gold" } }),
        text("Teleport Hub: ", { style: { color: "gray" } }),
        text(
          `${currentZone.teleportEnabled ? "✅ Enabled" : "❌ Disabled"}\n`,
          {
            style: { color: currentZone.teleportEnabled ? "green" : "red" },
          },
        ),
        text("For Sale: ", { style: { color: "gray" } }),
        text(
          `${
            currentZone.forSale
              ? `✅ Listed for ${currentZone.price} XPL`
              : "❌ Not for sale"
          }\n`,
          {
            style: { color: currentZone.forSale ? "green" : "red" },
          },
        ),

        // Dimensions
        text("\n📐 Dimensions\n", { style: { color: "gold" } }),
        text(`Width: ${size.width} blocks\n`, { style: { color: "aqua" } }),
        text(`Length: ${size.length} blocks\n`, { style: { color: "aqua" } }),
        text(`Height: ${size.height} blocks\n`, { style: { color: "aqua" } }),

        // Location
        text("\n📍 Location\n", { style: { color: "gold" } }),
        text("Center: ", { style: { color: "gray" } }),
        text(
          `${Math.floor(currentZone.center.x)}, ${
            Math.floor(currentZone.center.y)
          }, ${Math.floor(currentZone.center.z)}`,
          {
            style: { color: "aqua" },
            onClick: {
              action: "copy_to_clipboard",
              value: `${Math.floor(currentZone.center.x)} ${
                Math.floor(currentZone.center.y)
              } ${Math.floor(currentZone.center.z)}`,
            },
          },
        ),
        text(" (Click to copy)\n"),

        // Creation Info
        text("\n📅 Created\n", { style: { color: "gold" } }),
        text(`${creationDate} by `, { style: { color: "yellow" } }),
        text(`${currentZone.createdBy}\n`, { style: { color: "green" } }),

        // Teleport Hub Info
        ...(currentZone.teleportEnabled
          ? [
            text("\n🌟 Teleport Hub Info\n", { style: { color: "gold" } }),
            text(
              "This zone serves as a public teleport hub for team members. ",
              { style: { color: "aqua" } },
            ),
            text("Members can use ", { style: { color: "gray" } }),
            text("/zones tp ", { style: { color: "yellow" } }),
            text("to quickly travel here.\n", { style: { color: "gray" } }),
          ]
          : []),

        // Actions Section
        text("\n⚙️ Actions:\n", { style: { color: "gold" } }),

        // Basic actions for all team members
        button("Teleport", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: `/zones tp ${currentZone.id}`,
          },
        }),
        text(" "),

        // Leader-only actions
        ...(isTeamLeader
          ? [
            button(
              currentZone.teleportEnabled
                ? "Disable Teleport Hub"
                : "Enable Teleport Hub",
              {
                variant: currentZone.teleportEnabled
                  ? "destructive"
                  : "success",
                onClick: {
                  action: "run_command",
                  value:
                    `/zones modify ${currentZone.id} teleport ${!currentZone
                      .teleportEnabled}`,
                },
              },
            ),
            text(" "),
            button("Set Price", {
              variant: "outline",
              onClick: {
                action: "suggest_command",
                value: `/zones modify ${currentZone.id} price `,
              },
            }),
            text(" "),
            button("Edit Description", {
              variant: "outline",
              onClick: {
                action: "suggest_command",
                value: `/zones modify ${currentZone.id} description `,
              },
            }),
            text(" "),
            button("Delete", {
              variant: "destructive",
              onClick: {
                action: "run_command",
                value: `/zones delete ${currentZone.id}`,
              },
            }),
          ]
          : []),
      ]);

      messages = await tellraw(
        sender,
        infoDisplay.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "delete"])
  @Description("Delete a zone")
  @Permission("player")
  @Argument([
    { name: "zoneId", type: "string", description: "Zone ID to delete" },
  ])
  async deleteZone({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { zoneId } = args;

    try {
      const zoneResult = await kv.get(["zones", zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["teams", zone.teamId]);
      const team = teamResult.value;

      if (!team || team.leader !== sender) {
        throw new Error("Only the team leader can delete zones");
      }

      const confirmationMsg = container([
        text("⚠️ Confirm Zone Deletion ⚠️\n", {
          style: { color: "red", styles: ["bold"] },
        }),
        text("Zone: ", { style: { color: "gray" } }),
        text(zone.name + "\n", { style: { color: team.color } }),
        text("This action cannot be undone!\n\n", { style: { color: "red" } }),
        button("Click to Confirm Deletion", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: `/zones confirm-delete ${zoneId}`,
          },
        }),
      ]);

      // Store pending deletion
      await kv.set(["pending_deletions", sender, zoneId], {
        timestamp: Date.now(),
        zoneId: zone.id,
      });

      // Expire pending deletion after 60 seconds
      setTimeout(async () => {
        await kv.delete(["pending_deletions", sender, zoneId]);
      }, 60000);

      const messages = await tellraw(
        sender,
        confirmationMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      log(`Error in zone deletion: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Deletion Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
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
  async confirmDeleteZone({
    params,
    kv,
    tellraw,
    rcon,
    bluemap,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { zoneId } = args;
    let messages: any[] = [];

    try {
      const pendingResult = await kv.get(["pending_deletions", sender, zoneId]);
      if (!pendingResult.value) {
        throw new Error(
          "No pending deletion found or confirmation expired. Please start deletion process again.",
        );
      }

      const zoneResult = await kv.get(["zones", zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["teams", zone.teamId]);
      const team = teamResult.value;

      // Remove protection and displays
      const coords = this.createSquareCoordinates(zone.center);
      await this.removeZoneProtection(rcon, coords);

      // Remove zone markers from BlueMap
      await bluemap.removeMarker("zones", `zone_${zone.id}`);
      await bluemap.removeMarker("zones", `zone_${zone.id}_tp`);

      // Delete zone data atomically
      const result = await kv
        .atomic()
        .check(zoneResult)
        .delete(["zones", zoneId])
        .delete(["pending_deletions", sender, zoneId])
        .commit();

      if (!result.ok) {
        throw new Error("Failed to delete zone data");
      }

      // Notify team members
      const notificationMsg = container([
        text("Zone Deleted\n", { style: { color: "red", styles: ["bold"] } }),
        text(zone.name, { style: { color: "yellow" } }),
        text(" has been deleted by ", { style: { color: "gray" } }),
        text(sender, { style: { color: "green" } }),
      ]);

      for (const member of team.members) {
        const memberMessages = await tellraw(
          member,
          notificationMsg.render({ platform: "minecraft", player: member }),
        );
        messages = messages.concat(memberMessages);
      }

      log(`Player ${sender} deleted zone ${zone.name}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in zone deletion confirmation: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Deletion Failed",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
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
  async modifyZone({
    params,
    kv,
    tellraw,
    rcon,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { zoneId, setting, value } = args;

    try {
      const zoneResult = await kv.get(["zones", zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["teams", zone.teamId]);
      const team = teamResult.value;

      if (!team || team.leader !== sender) {
        throw new Error("Only the team leader can modify zones");
      }

      switch (setting.toLowerCase()) {
        case "description":
          zone.description = value;
          break;
        case "price":
          const price = parseInt(value);
          if (isNaN(price) || price < 0) {
            throw new Error("Price must be a positive number");
          }
          zone.price = price;
          zone.forSale = price > 0;
          break;
        case "teleport":
          const enabled = value.toLowerCase() === "true";
          zone.teleportEnabled = enabled;
          break;
        default:
          throw new Error("Invalid setting. Use description or price");
      }

      await kv.set(["zones", zoneId], zone);

      if (setting === "description") {
        const coords = this.createSquareCoordinates(zone.center);
        await this.changeZoneDisplay(rcon, coords, zone.name, zone.description);
      }

      const successMsg = container([
        text("Zone Updated\n", { style: { color: "green", styles: ["bold"] } }),
        text("Name: ", { style: { color: "gray" } }),
        text(zone.name + "\n", { style: { color: team.color } }),
        text(`${setting}: `, { style: { color: "gray" } }),
        text(value + "\n", { style: { color: "yellow" } }),
        button("View Zone Info", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/zones info ${zoneId}`,
          },
        }),
      ]);

      log(`Player ${sender} modified zone ${zone.name} ${setting}: ${value}`);
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, success: true };
    } catch (error) {
      log(`Error modifying zone: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Modification Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "tp"])
  @Description(
    "Teleport to a zone center (team members can tp to any team zone, others can use hubs for a fee)",
  )
  @Permission("player")
  @Argument([
    { name: "zoneId", type: "string", description: "Zone ID to teleport to" },
  ])
  async teleportToZone({
    params,
    kv,
    tellraw,
    api,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { zoneId } = args;
    const BASE_TP_COST = 1; // Base cost in XPL
    const DISTANCE_MULTIPLIER = 0.001; // Cost per block traveled

    try {
      const zoneResult = await kv.get(["zones", zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      // Get player's team
      const playerTeamResult = await kv.get(["players", sender, "team"]);
      const playerTeamId = playerTeamResult.value;
      const isSameTeam = playerTeamId === zone.teamId;

      // Non-team members can only teleport to hubs
      if (!isSameTeam && !zone.teleportEnabled) {
        throw new Error(
          "This zone is not a teleport hub. Only team members can teleport here.",
        );
      }

      // Get current player position
      const playerPos = await api.getPlayerPosition(sender);

      // Calculate distance
      const distance = Math.sqrt(
        Math.pow(playerPos.x - zone.center.x, 2) +
          Math.pow(playerPos.y - zone.center.y, 2) +
          Math.pow(playerPos.z - zone.center.z, 2),
      );

      // Calculate teleport cost - free for team members
      const tpCost = isSameTeam
        ? 0
        : Math.ceil(BASE_TP_COST + distance * DISTANCE_MULTIPLIER);

      // If there's a cost, handle the transaction
      if (tpCost > 0) {
        // Get player balance
        const balanceResult = await kv.get([
          "plugins",
          "economy",
          "balances",
          sender,
        ]);
        const playerBalance = balanceResult.value
          ? Number(balanceResult.value)
          : 0;

        if (playerBalance < tpCost) {
          throw new Error(
            `Insufficient funds. Teleport costs ${tpCost} XPL (${
              distance.toFixed(0)
            } blocks)`,
          );
        }

        // Get destination team data for balance update
        const destTeamResult = await kv.get(["teams", zone.teamId]);
        const destTeam = destTeamResult.value;

        // Perform transaction atomically
        const result = await kv
          .atomic()
          .check({
            key: ["plugins", "economy", "balances", sender],
            versionstamp: balanceResult.versionstamp,
          })
          .check({
            key: ["teams", zone.teamId],
            versionstamp: destTeamResult.versionstamp,
          })
          .set(
            ["plugins", "economy", "balances", sender],
            new Deno.KvU64(BigInt(playerBalance - tpCost)),
          )
          .set(["teams", zone.teamId], {
            ...destTeam,
            balance: (destTeam.balance || 0) + tpCost,
          })
          .commit();

        if (!result.ok) {
          throw new Error("Transaction failed. Please try again.");
        }
      }

      // Perform teleport
      const { x, y, z } = zone.center;
      await api.teleport(sender, x.toString(), y.toString(), z.toString());

      // Prepare success message with appropriate context
      const successMsg = container([
        text("Teleported to ", { style: { color: "green" } }),
        text(zone.name, { style: { color: "yellow", styles: ["bold"] } }),
        text("\nLocation: ", { style: { color: "gray" } }),
        text(`${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`, {
          style: { color: "aqua" },
          onClick: {
            action: "copy_to_clipboard",
            value: `${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}`,
          },
        }),
        ...(isSameTeam
          ? [
            text("\nFree teleport", { style: { color: "green" } }),
            text(" (team zone)", { style: { color: "gray" } }),
          ]
          : [
            text("\nTeleport Hub Fee: ", { style: { color: "gray" } }),
            text(`${tpCost} XPL`, { style: { color: "gold" } }),
            text(` (${distance.toFixed(0)} blocks)`, {
              style: { color: "gray" },
            }),
          ]),
      ]);

      // Notify team about earned XPL if applicable
      if (tpCost > 0) {
        const destTeamResult = await kv.get(["teams", zone.teamId]);
        const destTeam = destTeamResult.value;

        const teamNotification = container([
          text("💰 Teleport Hub Fee Received\n", { style: { color: "gold" } }),
          text(`${sender}`, { style: { color: "green" } }),
          text(" paid ", { style: { color: "gray" } }),
          text(`${tpCost} XPL`, { style: { color: "yellow" } }),
          text(" to teleport to ", { style: { color: "gray" } }),
          text(zone.name, { style: { color: "aqua" } }),
        ]);

        // Notify team leader
        await tellraw(
          destTeam.leader,
          teamNotification.render({
            platform: "minecraft",
            player: destTeam.leader,
          }),
        );
      }

      log(
        `Player ${sender} teleported to zone ${zone.name} (Cost: ${tpCost} XPL)`,
      );
      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, success: true };
    } catch (error) {
      log(`Error in zone teleport: ${error.message}`);
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Teleport Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "market"])
  @Description("List all zones that are for sale")
  @Permission("player")
  async listZonesForSale({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages: any[] = [];

    try {
      // Get all zones
      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        zones.push(entry.value);
      }

      // Filter zones that are for sale
      const zonesForSale = zones.filter((zone) => zone.forSale);

      if (zonesForSale.length === 0) {
        const noZonesMsg = container([
          text("📢 Zone Market\n", {
            style: { color: "gold", styles: ["bold"] },
          }),
          text("No zones are currently for sale", {
            style: { color: "yellow" },
          }),
        ]);
        messages = await tellraw(
          sender,
          noZonesMsg.render({ platform: "minecraft", player: sender }),
        );
        return { messages };
      }

      // Get all teams for team colors and names
      const teams = new Map();
      const teamsIterator = kv.list({ prefix: ["teams"] });
      for await (const entry of teamsIterator) {
        const team = entry.value;
        teams.set(team.id, team);
      }

      // Sort zones by price
      zonesForSale.sort((a, b) => a.price - b.price);

      const marketList = container([
        text("📢 Zone Market\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(
          `${zonesForSale.length} zone${
            zonesForSale.length !== 1 ? "s" : ""
          } available for purchase\n`,
          {
            style: { color: "yellow" },
          },
        ),
        divider(),
        ...zonesForSale.flatMap((zone) => {
          const team = teams.get(zone.teamId);
          const teamColor = team?.color || "white";

          return [
            // Zone name as clickable button
            button(zone.name, {
              variant: "ghost",
              style: { color: teamColor, styles: ["bold"] },
              onClick: {
                action: "run_command",
                value: `/zones info ${zone.id}`,
              },
            }),
            text("\n"),

            // Price and team info
            text("Price: ", { style: { color: "gray" } }),
            text(`${zone.price} XPL\n`, { style: { color: "gold" } }),
            text("Selling Team: ", { style: { color: "gray" } }),
            text(`${team?.name || "Unknown"}\n`, {
              style: { color: teamColor },
            }),

            // Zone features
            text("Features: ", { style: { color: "gray" } }),
            ...(zone.teleportEnabled
              ? [text("🌟 Teleport Hub ", { style: { color: "aqua" } })]
              : []),
            text("\n"),

            // Location
            text("Location: ", { style: { color: "gray" } }),
            text(
              `${Math.floor(zone.center.x)}, ${Math.floor(zone.center.y)}, ${
                Math.floor(zone.center.z)
              }`,
              {
                style: { color: "aqua" },
                onClick: {
                  action: "copy_to_clipboard",
                  value: `${Math.floor(zone.center.x)} ${
                    Math.floor(zone.center.y)
                  } ${Math.floor(zone.center.z)}`,
                },
              },
            ),
            text(" (Click to copy)\n"),

            // Description
            text("Description: ", { style: { color: "gray" } }),
            text(`${zone.description}\n`, { style: { color: "white" } }),

            // Quick actions
            button("View Details", {
              variant: "outline",
              onClick: {
                action: "run_command",
                value: `/zones info ${zone.id}`,
              },
            }),
            text(" "),
            ...(zone.teleportEnabled
              ? [
                button("Teleport Preview", {
                  variant: "success",
                  onClick: {
                    action: "run_command",
                    value: `/zones tp ${zone.id}`,
                  },
                }),
                text(" "),
              ]
              : []),
            button("Buy Zone", {
              variant: "ghost",
              style: { color: "gold" },
              onClick: {
                action: "suggest_command",
                value: `/zones buy ${zone.id}`,
              },
            }),
            divider(),
          ];
        }),
        text("\n💡 ", { style: { color: "yellow" } }),
        text("Tip: Click zone names for more information or use ", {
          style: { color: "gray" },
        }),
        text("/zones buy <id>", { style: { color: "yellow" } }),
        text(" to purchase a zone", { style: { color: "gray" } }),
      ]);

      messages = await tellraw(
        sender,
        marketList.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "hubs"])
  @Description("List all available teleport hubs")
  @Permission("player")
  async listTeleportHubs({
    params,
    kv,
    tellraw,
    api,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages: any[] = [];

    try {
      // Get player's position for distance calculation
      const playerPos = await api.getPlayerPosition(sender);

      // Get player's team
      const playerTeamResult = await kv.get(["players", sender, "team"]);
      const playerTeamId = playerTeamResult.value;

      // Get all zones
      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        zones.push(entry.value);
      }

      // Filter for teleport hubs and add distance
      const hubs = zones
        .filter((zone) => zone.teleportEnabled)
        .map((zone) => ({
          ...zone,
          distance: Math.sqrt(
            Math.pow(playerPos.x - zone.center.x, 2) +
              Math.pow(playerPos.y - zone.center.y, 2) +
              Math.pow(playerPos.z - zone.center.z, 2),
          ),
          cost: playerTeamId === zone.teamId ? 0 : Math.ceil(
            5 +
              Math.sqrt(
                  Math.pow(playerPos.x - zone.center.x, 2) +
                    Math.pow(playerPos.y - zone.center.y, 2) +
                    Math.pow(playerPos.z - zone.center.z, 2),
                ) *
                0.01,
          ),
        }))
        .sort((a, b) => a.distance - b.distance); // Sort by distance

      if (hubs.length === 0) {
        const noHubsMsg = container([
          text("🌟 Teleport Hubs\n", {
            style: { color: "gold", styles: ["bold"] },
          }),
          text("No teleport hubs are currently available", {
            style: { color: "yellow" },
          }),
        ]);
        messages = await tellraw(
          sender,
          noHubsMsg.render({ platform: "minecraft", player: sender }),
        );
        return { messages };
      }

      // Get all teams for team colors and names
      const teams = new Map();
      const teamsIterator = kv.list({ prefix: ["teams"] });
      for await (const entry of teamsIterator) {
        const team = entry.value;
        teams.set(team.id, team);
      }

      const hubsList = container([
        text("🌟 Teleport Hubs\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(`${hubs.length} hub${hubs.length !== 1 ? "s" : ""} available\n`, {
          style: { color: "yellow" },
        }),
        text("Sorted by distance from your location\n", {
          style: { color: "gray" },
        }),
        divider(),
        ...hubs.flatMap((hub) => {
          const team = teams.get(hub.teamId);
          const teamColor = team?.color || "white";
          const isOwnTeam = playerTeamId === hub.teamId;

          return [
            // Hub name and distance
            button(hub.name, {
              variant: "ghost",
              style: { color: teamColor, styles: ["bold"] },
              onClick: {
                action: "run_command",
                value: `/zones info ${hub.id}`,
              },
            }),
            text(" "),
            text(`(${Math.floor(hub.distance)} blocks)\n`, {
              style: { color: "gray" },
            }),

            // Team info
            text("Team: ", { style: { color: "gray" } }),
            text(`${team?.name || "Unknown"}\n`, {
              style: { color: teamColor },
            }),

            // Cost info
            text("Teleport Fee: ", { style: { color: "gray" } }),
            ...(isOwnTeam
              ? [text("Free (Team Member)\n", { style: { color: "green" } })]
              : [text(`${hub.cost} XPL\n`, { style: { color: "gold" } })]),

            // Location with copy
            text("Location: ", { style: { color: "gray" } }),
            text(
              `${Math.floor(hub.center.x)}, ${Math.floor(hub.center.y)}, ${
                Math.floor(hub.center.z)
              }`,
              {
                style: { color: "aqua" },
                onClick: {
                  action: "copy_to_clipboard",
                  value: `${Math.floor(hub.center.x)} ${
                    Math.floor(hub.center.y)
                  } ${Math.floor(hub.center.z)}`,
                },
              },
            ),
            text(" (Click to copy)\n", { style: { color: "gray" } }),

            // Description
            text("Description: ", { style: { color: "gray" } }),
            text(`${hub.description}\n`, { style: { color: "white" } }),

            // For Sale status if applicable
            ...(hub.forSale
              ? [
                text("📢 ", { style: { color: "yellow" } }),
                text("This hub is also ", { style: { color: "gray" } }),
                text("FOR SALE", { style: { color: "gold" } }),
                text(` (${hub.price} XPL)\n`, { style: { color: "yellow" } }),
              ]
              : []),

            // Quick actions
            button("Teleport", {
              variant: "success",
              onClick: {
                action: "run_command",
                value: `/zones tp ${hub.id}`,
              },
            }),
            text(" "),
            button("Info", {
              variant: "outline",
              onClick: {
                action: "run_command",
                value: `/zones info ${hub.id}`,
              },
            }),
            divider(),
          ];
        }),
        text("\n💡 ", { style: { color: "yellow" } }),
        text("Tip: Teleport fees are based on distance traveled.\n", {
          style: { color: "gray" },
        }),
        text("Team members can teleport to their own hubs for free!", {
          style: { color: "green" },
        }),
      ]);

      messages = await tellraw(
        sender,
        hubsList.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["zones", "map"])
  @Description("Show an ASCII map of zones around you")
  @Permission("player")
  @Argument([
    {
      name: "zoom",
      type: "number",
      description: "Zoom level (1-3)",
      required: false,
      default: 2,
    },
  ])
  async showZoneMap({
    params,
    kv,
    tellraw,
    api,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    let messages: any[] = [];

    try {
      const playerPos = await api.getPlayerPosition(sender);
      const playerTeamResult = await kv.get(["players", sender, "team"]);
      const playerTeamId = playerTeamResult.value;

      const zoomLevels = {
        1: 16, // Close zoom
        2: 32, // Medium zoom
        3: 64, // Far zoom
      };

      const zoom = Math.min(Math.max(args.zoom || 2, 1), 3);
      const blocksPerChar = zoomLevels[zoom];

      // Increased width while keeping height reasonable
      const mapWidth = 32; // Doubled from 16
      const mapHeight = 12; // Increased slightly
      const halfWidth = Math.floor(mapWidth / 2);
      const halfHeight = Math.floor(mapHeight / 2);

      const bounds = {
        minX: playerPos.x - halfWidth * blocksPerChar,
        maxX: playerPos.x + halfWidth * blocksPerChar,
        minZ: playerPos.z - halfHeight * blocksPerChar,
        maxZ: playerPos.z + halfHeight * blocksPerChar,
      };

      // Define map symbols using trigrams
      const symbols = {
        empty: "☷ ", // Empty space (ground)
        player: "☰ ", // Player position (heaven)
        hub: "☱ ", // Teleport hub (lake)
        zone: "☳ ", // Zone center (thunder)
        territory: "☵ ", // Territory (water)
        overlap: "☲ ", // Overlapping territories (fire)
        border: "☴ ", // Zone border (wind)
        corner: "☶ ", // Zone corner (mountain)
      };

      // Initialize grid
      const grid: MapSymbol[][] = Array(mapHeight)
        .fill(null)
        .map(() =>
          Array(mapWidth)
            .fill(null)
            .map(() => ({ char: symbols.empty, color: "gray" }))
        );

      const worldToGrid = (x: number, z: number): [number, number] | null => {
        const gridX = Math.floor((x - bounds.minX) / blocksPerChar);
        const gridZ = Math.floor((z - bounds.minZ) / blocksPerChar);

        if (gridX >= 0 && gridX < mapWidth && gridZ >= 0 && gridZ < mapHeight) {
          return [gridX, gridZ];
        }
        return null;
      };

      // Get zones and teams
      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        zones.push(entry.value);
      }

      const teams = new Map();
      const teamsIterator = kv.list({ prefix: ["teams"] });
      for await (const entry of entriesIterator) {
        const team = entry.value;
        teams.set(team.id, team);
      }

      // Track territory overlaps
      const territoryMap = new Map<string, string[]>(); // gridKey -> teamIds

      // Place zone areas on grid
      zones.forEach((zone) => {
        const team = teams.get(zone.teamId);
        const teamColor = team?.color || "white";

        // Calculate zone boundaries in grid coordinates
        for (
          let x = zone.positions[0].x;
          x <= zone.positions[2].x;
          x += blocksPerChar
        ) {
          for (
            let z = zone.positions[0].z;
            z <= zone.positions[2].z;
            z += blocksPerChar
          ) {
            const gridPos = worldToGrid(x, z);
            if (gridPos) {
              const [gx, gz] = gridPos;
              const gridKey = `${gx},${gz}`;

              // Track territory occupation
              const occupyingTeams = territoryMap.get(gridKey) || [];
              occupyingTeams.push(zone.teamId);
              territoryMap.set(gridKey, occupyingTeams);

              // Set appropriate symbol
              let char = symbols.territory;
              if (
                x === zone.positions[0].x ||
                x === zone.positions[2].x ||
                z === zone.positions[0].z ||
                z === zone.positions[2].z
              ) {
                char = symbols.border;
              }
              if (
                (x === zone.positions[0].x || x === zone.positions[2].x) &&
                (z === zone.positions[0].z || z === zone.positions[2].z)
              ) {
                char = symbols.corner;
              }

              grid[gz][gx] = {
                char,
                color: teamColor,
                name: zone.name,
                type: "territory",
              };
            }
          }
        }

        // Place zone center marker
        const centerPos = worldToGrid(zone.center.x, zone.center.z);
        if (centerPos) {
          const [cx, cz] = centerPos;
          grid[cz][cx] = {
            char: zone.teleportEnabled ? symbols.hub : symbols.zone,
            color: teamColor,
            name: zone.name,
            type: zone.teleportEnabled ? "hub" : "zone center",
          };
        }
      });

      // Mark overlapping territories
      territoryMap.forEach((teamIds, gridKey) => {
        if (teamIds.length > 1) {
          const [gx, gz] = gridKey.split(",").map(Number);
          grid[gz][gx] = {
            char: symbols.overlap,
            color: "red",
            name: "Contested Territory",
            type: `${teamIds.length} teams`,
          };
        }
      });

      // Place player last
      const playerGridPos = worldToGrid(playerPos.x, playerPos.z);
      if (playerGridPos) {
        const [px, pz] = playerGridPos;
        grid[pz][px] = {
          char: symbols.player,
          color: "yellow",
          name: "You",
          type: "player",
        };
      }

      const mapDisplay = container([
        text(
          `Zone Map (Zoom ${zoom}) - ${blocksPerChar * mapWidth} x ${
            blocksPerChar * mapHeight
          } blocks\n`,
          {
            style: { color: "gold", styles: ["bold"] },
          },
        ),

        text("N\n", { style: { color: "aqua" } }),

        // Map content
        ...grid.map((row) =>
          container([
            ...row.map((cell) =>
              text(cell.char, {
                style: { color: cell.color },
                hover: cell.name
                  ? `${cell.name}${cell.type ? ` (${cell.type})` : ""}`
                  : undefined,
              })
            ),
            text("\n"),
          ])
        ),

        text(`\nScale: 1 symbol = ${blocksPerChar}x${blocksPerChar} blocks\n`, {
          style: { color: "gray" },
        }),

        text("\nLegend: ", { style: { color: "gold" } }),
        text(symbols.player, { style: { color: "yellow" } }),
        text("You  ", { style: { color: "gray" } }),
        text(symbols.hub, { style: { color: "aqua" } }),
        text("Hub  ", { style: { color: "gray" } }),
        text(symbols.zone, { style: { color: "white" } }),
        text("Zone  ", { style: { color: "gray" } }),
        text(symbols.territory, { style: { color: "white" } }),
        text("Area  ", { style: { color: "gray" } }),
        text(symbols.overlap, { style: { color: "red" } }),
        text("Contested\n", { style: { color: "gray" } }),

        text("\nZoom: ", { style: { color: "gold" } }),
        button("[-]", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/zones map ${Math.min(3, zoom + 1)}`,
          },
          disabled: zoom === 3,
        }),
        text(` ${zoom} `, { style: { color: "yellow" } }),
        button("[+]", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/zones map ${Math.max(1, zoom - 1)}`,
          },
          disabled: zoom === 1,
        }),
      ]);

      messages = await tellraw(
        sender,
        mapDisplay.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Event("player_joined")
  async initializeMarkerSets({
    bluemap,
    kv,
    log,
  }: ScriptContext): Promise<void> {
    try {
      // Remove existing marker set if it exists
      try {
        await bluemap.removeMarkerSet("zones");
      } catch (error) {
        // Ignore error if marker set doesn't exist
      }

      // Create fresh marker set
      await bluemap.createMarkerSet("zones", {
        label: "Protected Zones",
        toggleable: true,
        defaultHidden: false,
        sorting: 1,
      });

      // Re-register all zone markers
      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        const zone = entry.value as Zone;
        zones.push(zone);
      }

      // Add markers for each zone with team colors
      for (const zone of zones) {
        try {
          // Get team data for color
          const teamResult = await kv.get(["teams", zone.teamId]);
          const teamData = teamResult.value;
          if (!teamData) {
            log(`Warning: Team not found for zone ${zone.id}`);
            continue;
          }

          // Update markers with team color
          await this.updateZoneMarkers(zone, teamData.color, bluemap);

          // Add small delay to prevent overwhelming the server
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          log(`Error creating markers for zone ${zone.id}: ${error.message}`);
          continue;
        }
      }

      log(`Zone marker set initialized with ${zones.length} zones`);
    } catch (error) {
      log(`Error initializing zone markers: ${error.message}`);
    }
  }

  @Socket("get_zones")
  async getZones({ kv }: ScriptContext): Promise<any> {
    try {
      const zones = [];
      const entriesIterator = kv.list({ prefix: ["zones"] });
      for await (const entry of entriesIterator) {
        zones.push(entry.value);
      }
      return {
        success: true,
        data: zones,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
