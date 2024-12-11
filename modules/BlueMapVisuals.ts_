import {
  Module,
  Command,
  Description,
  Permission,
  Event,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface MarkerStyle {
  fontSize?: string;
  color?: string;
  background?: string;
  classes?: string[];
  minDistance?: number;
  maxDistance?: number;
  scale?: number;
  textShadow?: string;
}

interface MarkerSymbol {
  icon: string;
  style: MarkerStyle;
}

interface MarkerData {
  id: string;
  type: "html" | "poi" | "line" | "shape" | "extrude";
  set: string;
  timestamp: number;
  expiry?: number;
  style?: MarkerStyle;
}

@Module({
  name: "BlueMapVisualizer",
  version: "2.0.0",
  description: "Enhanced visualization with HTML markers and dynamic effects",
})
export class BlueMapVisualizer {
  private activeMarkers: Map<string, MarkerData>;
  private playerPositions: Map<string, Vector3>;
  private settings: {
    cleanupInterval: number;
    defaultMarkerDuration: number;
    maxMarkersPerPlayer: number;
  };

  constructor() {
    this.activeMarkers = new Map();
    this.playerPositions = new Map();
    this.settings = {
      cleanupInterval: 60000,
      defaultMarkerDuration: 30000,
      maxMarkersPerPlayer: 100,
    };
    this.startCleanupTask();
  }

  private readonly DEFAULT_STYLE: MarkerStyle = {
    fontSize: "24px",
    color: "white",
    minDistance: 10,
    maxDistance: 1000,
    scale: 1,
    textShadow: "2px 2px 2px rgba(0,0,0,0.7)",
  };

  private readonly SYMBOLS: Record<string, MarkerSymbol> = {
    PLAYER: {
      icon: "Ⓟ",
      style: { color: "#55FF55", scale: 1.2 },
    },
    DEATH: {
      icon: "☠",
      style: { color: "#FF5555", scale: 1.5 },
    },
    COMBAT: {
      icon: "⚔",
      style: { color: "#FF9900", background: "rgba(255,0,0,0.2)" },
    },
    CONTAINER: {
      icon: "⌂",
      style: { color: "#FFFF55" },
    },
    PROJECTILE: {
      icon: "➜",
      style: { color: "#FF99FF" },
    },
    ADVANCEMENT: {
      icon: "★",
      style: { color: "#FFFF00", scale: 1.3 },
    },
    BLOCK_BREAK: {
      icon: "⛏",
      style: { color: "#AA7777" },
    },
    BLOCK_PLACE: {
      icon: "⬛",
      style: { color: "#77AA77" },
    },
    TELEPORT: {
      icon: "⊗",
      style: { color: "#AA55FF" },
    },
    WARNING: {
      icon: "⚠",
      style: { color: "#FFFF00" },
    },
    SPAWN: {
      icon: "⌾",
      style: { color: "#55FF55" },
    },
    PORTAL: {
      icon: "◎",
      style: { color: "#AA00FF" },
    },
    NORTH: {
      icon: "↑",
      style: { color: "#FFFFFF" },
    },
    SOUTH: {
      icon: "↓",
      style: { color: "#FFFFFF" },
    },
    EAST: {
      icon: "→",
      style: { color: "#FFFFFF" },
    },
    WEST: {
      icon: "←",
      style: { color: "#FFFFFF" },
    },
    ACTIVE: {
      icon: "●",
      style: { color: "#55FF55" },
    },
    INACTIVE: {
      icon: "○",
      style: { color: "#FF5555" },
    },
    SUCCESS: {
      icon: "✔",
      style: { color: "#55FF55" },
    },
    FAILURE: {
      icon: "❌",
      style: { color: "#FF5555" },
    },
    SLEEP: {
      icon: "☾",
      style: { color: "#5555FF" },
    },
    ELYTRA: {
      icon: "⇲",
      style: { color: "#55FFFF" },
    },
    SWIMMING: {
      icon: "🌊",
      style: { color: "#5555FF" },
    },
    BURNING: {
      icon: "🔥",
      style: { color: "#FF5500" },
    },
  };

  private readonly ADVANCEMENTS = {
    STORY: { icon: "①", style: { color: "#55FF55" } },
    NETHER: { icon: "②", style: { color: "#FF5555" } },
    END: { icon: "③", style: { color: "#AA00FF" } },
    ADVENTURE: { icon: "④", style: { color: "#FFAA00" } },
    HUSBANDRY: { icon: "⑤", style: { color: "#55FFAA" } },
    CUSTOM: { icon: "⑥", style: { color: "#FFFFFF" } },
  };

  private readonly EFFECTS = {
    POSITIVE: { icon: "♥", style: { color: "#55FF55" } },
    NEGATIVE: { icon: "☠", style: { color: "#FF5555" } },
    NEUTRAL: { icon: "⚕", style: { color: "#FFFFFF" } },
  };

  private readonly WEATHER = {
    CLEAR: { icon: "☀", style: { color: "#FFFF55" } },
    RAIN: { icon: "☔", style: { color: "#5555FF" } },
    THUNDER: { icon: "⚡", style: { color: "#FFFF00" } },
    SNOW: { icon: "❄", style: { color: "#FFFFFF" } },
  };
  private readonly SETS = {
    PLAYERS: {
      id: "players",
      label: "Players Online",
      defaultStyle: { color: "#55FF55", scale: 1.2 },
      sorting: 1,
    },
    DEATHS: {
      id: "deaths",
      label: "Death Locations",
      defaultStyle: { color: "#FF5555", scale: 1.3 },
      sorting: 2,
    },
    COMBAT: {
      id: "combat",
      label: "Combat Events",
      defaultStyle: { color: "#FF9900" },
      sorting: 3,
    },
    BLOCKS: {
      id: "blocks",
      label: "Block Changes",
      defaultStyle: { color: "#AAAAAA" },
      sorting: 4,
    },
    CONTAINERS: {
      id: "containers",
      label: "Container Access",
      defaultStyle: { color: "#FFFF55" },
      sorting: 5,
    },
    EVENTS: {
      id: "events",
      label: "World Events",
      defaultStyle: { color: "#FFFFFF" },
      sorting: 6,
    },
  };

  private readonly PATTERNS = {
    RITUAL: {
      symbols: ["╔", "╗", "╝", "╚"],
      style: { color: "#AA00FF", scale: 1.5 },
    },
    EXPLOSION: {
      symbols: ["░", "▒", "▓", "█"],
      style: { color: "#FF5500", scale: 1.3 },
    },
    PROTECTION: {
      symbols: ["┌", "┐", "└", "┘"],
      style: { color: "#55FF55", scale: 1.4 },
    },
    MAGIC: {
      symbols: ["⚝", "⚯", "⚮", "⚰"],
      style: { color: "#AA55FF", scale: 1.6 },
    },
  };

  private playerStates: Map<
    string,
    {
      isFlying: boolean;
      isSneaking: boolean;
      isSwimming: boolean;
      combatTime?: number;
    }
  > = new Map();

  private getMarkerHtml(icon: string, style?: MarkerStyle): string {
    const finalStyle = { ...this.DEFAULT_STYLE, ...style };

    return `
      <div style="
        font-size: ${finalStyle.fontSize};
        color: ${finalStyle.color};
        background: ${finalStyle.background || "transparent"};
        transform: translate(-50%, -50%) scale(${finalStyle.scale});
        text-shadow: ${finalStyle.textShadow};
        padding: 4px;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        ${finalStyle.classes ? `class="${finalStyle.classes.join(" ")}"` : ""}
      ">
        ${icon}
      </div>
    `;
  }

  private async addMarker(
    data: MarkerData & {
      position?: Vector3;
      label: string;
      icon?: string;
      persistent?: boolean;
      line?: [Vector3, Vector3];
      shape?: Vector3[];
    },
    bluemap: any,
  ) {
    try {
      const markerId = data.id;
      const markerSet = data.set;
      const finalStyle = {
        ...this.DEFAULT_STYLE,
        ...this.SETS[markerSet]?.defaultStyle,
        ...data.style,
      };

      if (this.activeMarkers.has(markerId)) {
        await this.removeMarker(markerId, bluemap);
      }

      switch (data.type) {
        case "html":
        case "poi":
          if (data.icon) {
            const isImage = data.icon.startsWith("/");
            if (isImage) {
              await bluemap.addMarker(markerSet, markerId, "poi", {
                label: data.label,
                position: data.position,
                icon: data.icon,
                maxDistance: finalStyle.maxDistance,
              });
            } else {
              await bluemap.addMarker(markerSet, markerId, "html", {
                label: data.label,
                position: data.position,
                html: this.getMarkerHtml(data.icon, finalStyle),
                minDistance: finalStyle.minDistance,
                maxDistance: finalStyle.maxDistance,
              });
            }
          }
          break;

        case "line":
          if (data.line) {
            await bluemap.addMarker(markerSet, markerId, "line", {
              label: data.label,
              line: data.line,
              lineWidth: 2,
              color: finalStyle.color,
            });
          }
          break;

        case "shape":
          if (data.shape) {
            await bluemap.addMarker(markerSet, markerId, "shape", {
              label: data.label,
              shape: data.shape,
              lineWidth: 2,
              fillColor: { r: 255, g: 0, b: 0, a: 64 },
              color: finalStyle.color,
            });
          }
          break;
      }

      if (!data.persistent) {
        this.activeMarkers.set(markerId, {
          ...data,
          timestamp: Date.now(),
        });
      }

      if (data.expiry) {
        setTimeout(() => {
          this.removeMarker(markerId, bluemap).catch(() => {});
        }, data.expiry);
      }
    } catch (error) {
      console.error(`Error adding marker ${data.id}:`, error);
    }
  }

  @Event("player_break_block_after")
  async onBlockBreak({ params, bluemap }: ScriptContext) {
    const { playerId, x, y, z, block } = params;
    const markerId = `block_break_${playerId}_${Date.now()}`;
    const icon = block.startsWith("minecraft:")
      ? `/items/${block}.png`
      : this.SYMBOLS.BLOCK_BREAK.icon;

    await this.addMarker(
      {
        id: markerId,
        set: this.SETS.BLOCKS.id,
        type: "html",
        position: { x, y, z },
        icon,
        label: `${this.SYMBOLS.BLOCK_BREAK.icon} Broken ${block}`,
        expiry: 30000,
      },
      bluemap,
    );
  }

  @Event("player_death")
  async onPlayerDeath({ params, bluemap }: ScriptContext) {
    const { playerName, x, y, z, attackerType, deathMessage } = params;

    await this.addMarker(
      {
        id: `death_${playerName}_${Date.now()}`,
        set: this.SETS.DEATHS.id,
        type: "html",
        position: { x, y, z },
        icon: this.SYMBOLS.DEATH.icon,
        label: `${playerName}'s Death\n${deathMessage}`,
        expiry: 300000,
        style: { scale: 1.5 },
      },
      bluemap,
    );

    if (attackerType) {
      await this.addMarker(
        {
          id: `combat_${playerName}_${Date.now()}`,
          set: this.SETS.COMBAT.id,
          type: "shape",
          position: { x, y, z },
          shape: this.generateCircle({ x, y, z }, 10),
          label: `${this.SYMBOLS.COMBAT.icon} ${playerName} vs ${attackerType}`,
          expiry: 60000,
        },
        bluemap,
      );
    }
  }

  @Event("player_joined")
  async onPlayerJoin({ params, bluemap }: ScriptContext) {
    const { playerName, x, y, z } = params;
    await this.addMarker(
      {
        id: `player_${playerName}`,
        set: this.SETS.PLAYERS.id,
        type: "html",
        position: { x, y, z },
        label: `${playerName}`,
        icon: this.SYMBOLS.PLAYER.icon,
        style: this.SYMBOLS.PLAYER.style,
        persistent: true,
      },
      bluemap,
    );
  }

  @Event("advancement_complete")
  async onAdvancement({ params, bluemap }: ScriptContext) {
    const { playerName, advancement, x, y, z } = params;
    const advType = this.getAdvancementType(advancement);
    const symbol = this.ADVANCEMENTS[advType];

    await this.addMarker(
      {
        id: `advancement_${playerName}_${Date.now()}`,
        set: this.SETS.EVENTS.id,
        type: "html",
        position: { x, y, z },
        label: `${playerName}\n${advancement}`,
        icon: symbol.icon,
        style: { ...symbol.style, scale: 1.5 },
        expiry: 20000,
      },
      bluemap,
    );
  }

  @Event("entity_elytra_check")
  async onElytraFlight({ params, bluemap }: ScriptContext) {
    const { playerName, x, y, z, isFlying } = params;
    if (isFlying) {
      const playerState = this.playerStates.get(playerName) || {};
      playerState.isFlying = true;
      this.playerStates.set(playerName, playerState);

      await this.addMarker(
        {
          id: `flight_${playerName}_${Date.now()}`,
          set: this.SETS.EVENTS.id,
          type: "line",
          line: [
            { x, y, z },
            { x, y: y - 1, z },
          ],
          label: `${playerName} flying`,
          icon: this.SYMBOLS.ELYTRA.icon,
          style: this.SYMBOLS.ELYTRA.style,
          expiry: 3000,
        },
        bluemap,
      );
    }
  }

  private generateCircle(
    center: Vector3,
    radius: number,
    segments = 32,
  ): Vector3[] {
    const points: Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y,
        z: center.z + Math.sin(angle) * radius,
      });
    }
    points.push(points[0]); // Close the circle
    return points;
  }

  private generateSpiral(
    center: Vector3,
    radius: number,
    height: number,
  ): Vector3[] {
    const points: Vector3[] = [];
    const turns = 2;
    const pointsPerTurn = 16;

    for (let i = 0; i <= turns * pointsPerTurn; i++) {
      const angle = (i / pointsPerTurn) * Math.PI * 2;
      const progress = i / (turns * pointsPerTurn);
      points.push({
        x: center.x + Math.cos(angle) * radius * (1 - progress),
        y: center.y + height * progress,
        z: center.z + Math.sin(angle) * radius * (1 - progress),
      });
    }
    return points;
  }

  private async createVisualEffect(
    type: keyof typeof this.PATTERNS,
    position: Vector3,
    bluemap: any,
    duration = 5000,
  ) {
    const pattern = this.PATTERNS[type];
    const radius = 3;

    for (let i = 0; i < pattern.symbols.length; i++) {
      const angle = (i / pattern.symbols.length) * Math.PI * 2;
      const x = position.x + Math.cos(angle) * radius;
      const z = position.z + Math.sin(angle) * radius;

      await this.addMarker(
        {
          id: `effect_${type}_${i}_${Date.now()}`,
          set: this.SETS.EVENTS.id,
          type: "html",
          position: { x, y: position.y, z },
          icon: pattern.symbols[i],
          style: pattern.style,
          expiry: duration,
        },
        bluemap,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private getAdvancementType(
    advancement: string,
  ): keyof typeof this.ADVANCEMENTS {
    if (advancement.includes("story")) return "STORY";
    if (advancement.includes("nether")) return "NETHER";
    if (advancement.includes("end")) return "END";
    if (advancement.includes("adventure")) return "ADVENTURE";
    if (advancement.includes("husbandry")) return "HUSBANDRY";
    return "CUSTOM";
  }

  private startCleanupTask() {
    setInterval(() => {
      const now = Date.now();
      for (const [markerId, data] of this.activeMarkers.entries()) {
        if (data.expiry && now - data.timestamp > data.expiry) {
          this.removeMarker(markerId, this._bluemap).catch(() => {});
        }
      }
    }, this.settings.cleanupInterval);
  }

  private async removeMarker(id: string, bluemap: any) {
    try {
      const markerData = this.activeMarkers.get(id);
      if (markerData) {
        await bluemap.removeMarker(markerData.set, id);
        this.activeMarkers.delete(id);
      }
    } catch (error) {
      console.error(`Error removing marker ${id}:`, error);
    }
  }

  @Command(["map", "stats"])
  @Permission("operator")
  async showStats({ params, api }: ScriptContext) {
    const { sender } = params;
    const stats = {
      activeMarkers: this.activeMarkers.size,
      trackedPlayers: this.playerPositions.size,
      markerSets: Object.keys(this.SETS).length,
    };

    await api.tellraw(sender, {
      text:
        `BlueMap Stats:\n` +
        `Active Markers: ${stats.activeMarkers}\n` +
        `Tracked Players: ${stats.trackedPlayers}\n` +
        `Marker Sets: ${stats.markerSets}`,
      color: "gold",
    });
  }
}
