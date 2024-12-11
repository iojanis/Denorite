import {
  Module,
  Command,
  Description,
  Permission,
  Socket,
  Argument,
  Event,
} from "../decorators.ts";
import { text, button, container, alert, divider } from "../tellraw-ui.ts";
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
        `summon text_display ${coords.centerX} ${coords.centerY + 3} ${coords.centerZ} {text:'${JSON.stringify(name)}',background:0,transformation:{translation:[0f,0f,0f],scale:[2f,2f,2f]},billboard:"center"}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));

      await rcon.executeCommand(
        `summon text_display ${coords.centerX} ${coords.centerY + 2} ${coords.centerZ} {text:'${JSON.stringify(description)}',background:0,transformation:{translation:[0f,0f,0f],scale:[1f,1f,1f]},billboard:"center"}`,
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
        `setblock ${coords.centerX} ${coords.centerY + 1} ${coords.centerZ} air`,
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
        cmd: `gamemode survival @a[x=${coords.point2X + 4},y=${this.WORLD_MIN_Y},z=${coords.point2Z + 4},dx=247,dy=${this.WORLD_MAX_Y - this.WORLD_MIN_Y},dz=247,gamemode=adventure,team=${teamId}]`,
      },
      {
        // North border
        x: coords.point2X + 128,
        y: 0,
        z: coords.point2Z + 127,
        cmd: `gamemode survival @a[x=${coords.point2X},y=${this.WORLD_MIN_Y},z=${coords.point2Z},dx=250,dy=${this.WORLD_MAX_Y - this.WORLD_MIN_Y},dz=2,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // East border
        x: coords.point2X + 129,
        y: 0,
        z: coords.point2Z + 128,
        cmd: `gamemode survival @a[x=${coords.point1X - 3},y=${this.WORLD_MIN_Y},z=${coords.point1Z},dx=2,dy=${this.WORLD_MAX_Y - this.WORLD_MIN_Y},dz=250,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // South border
        x: coords.point2X + 128,
        y: 0,
        z: coords.point2Z + 129,
        cmd: `gamemode survival @a[x=${coords.point3X + 3},y=${this.WORLD_MIN_Y},z=${coords.point3Z - 3},dx=250,dy=${this.WORLD_MAX_Y - this.WORLD_MIN_Y},dz=2,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // West border
        x: coords.point2X + 127,
        y: 0,
        z: coords.point2Z + 128,
        cmd: `gamemode survival @a[x=${coords.point2X},y=${this.WORLD_MIN_Y},z=${coords.point2Z + 3},dx=2,dy=${this.WORLD_MAX_Y - this.WORLD_MIN_Y},dz=250,gamemode=adventure,team=!${teamId}]`,
      },
      {
        // Center - Non-team members adventure mode
        x: coords.point2X + 128,
        y: 1,
        z: coords.point2Z + 128,
        cmd: `gamemode adventure @a[x=${coords.point2X + 4},y=${this.WORLD_MIN_Y},z=${coords.point2Z + 4},dx=247,dy=${this.WORLD_MAX_Y - this.WORLD_MIN_Y},dz=247,gamemode=survival,team=!${teamId}]`,
      },
    ];

    try {
      // Place all command blocks using RCON
      for (const block of commandBlocks) {
        const command = `setblock ${block.x} ${block.y} ${block.z} repeating_command_block[facing=up]{auto:1b,Command:"${block.cmd}"}`;
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
        `setblock ${coords.point2X + 128} 3 ${coords.point2Z + 128} redstone_block`,
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
          `setblock ${corner.x} ${coords.centerY + 3} ${corner.z} lantern[hanging=false]`,
        );

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Create center teleport marker
      await rcon.executeCommand(
        `setblock ${coords.centerX} ${coords.centerY} ${coords.centerZ} lodestone`,
      );
      await rcon.executeCommand(
        `setblock ${coords.centerX} ${coords.centerY + 1} ${coords.centerZ} end_rod`,
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
      // ... (keep existing zone creation logic) ...

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
          text(`\n${zone.name}\n`, {
            style: { color: "green", styles: ["bold"] },
          }),
          text(`Description: ${zone.description}\n`, {
            style: { color: "white" },
          }),
          button("Teleport", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: `/zones tp ${zone.id}`,
            },
          }),
          text("\n"),
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
      // ... (keep existing zone lookup logic) ...

      const infoDisplay = container([
        text("⚡ Zone Information ⚡\n", {
          style: { color: "gold", styles: ["bold"] },
        }),

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

        text("Owner: ", { style: { color: "gray" } }),
        text(`${ownerName}\n`, { style: { color: "green" } }),

        text("Created: ", { style: { color: "gray" } }),
        text(`${formattedDate}\n`, { style: { color: "yellow" } }),

        divider(),
        text("Actions:\n", { style: { color: "gold" } }),

        button("Teleport", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: `/zones tp ${currentZone.id}`,
          },
        }),
        text(" "),

        ...(team.leader === sender
          ? [
              button("Modify", {
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
  @Description("Teleport to a zone center")
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

    try {
      const zoneResult = await kv.get(["zones", zoneId]);
      const zone = zoneResult.value as Zone;

      if (!zone) {
        throw new Error("Zone not found");
      }

      const teamResult = await kv.get(["players", sender, "team"]);
      if (teamResult.value !== zone.teamId) {
        throw new Error("You can only teleport to zones owned by your team");
      }

      const { x, y, z } = zone.center;
      await api.teleport(sender, x.toString(), y.toString(), z.toString());

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
      ]);

      log(`Player ${sender} teleported to zone ${zone.name}`);
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
