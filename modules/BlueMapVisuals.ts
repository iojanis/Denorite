import { Module, Command, Description, Permission, Event } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';
import type { Vector3, Color } from './bluemapAPI.ts';

interface PlayerMarker {
  lastUpdate: number;
  position: Vector3;
}

@Module({
  name: 'BlueMapVisualizer',
  version: '1.0.0',
  description: 'Visualizes game events on BlueMap'
})
export class BlueMapVisualizer {
  private readonly PLAYER_MARKER_SET = 'players';
  private readonly DEATH_MARKER_SET = 'deaths';
  private readonly COMBAT_MARKER_SET = 'combat';
  private readonly POI_MARKER_SET = 'points_of_interest';

  private playerMarkers: Map<string, PlayerMarker> = new Map();

  // Colors for various markers
  private readonly colors = {
    player: { r: 0, g: 255, b: 0, a: 255 },
    death: { r: 255, g: 0, b: 0, a: 255 },
    combat: { r: 255, g: 165, b: 0, a: 255 },
    poi: { r: 0, g: 191, b: 255, a: 255 }
  };

  @Event('denorite_connected')
  async initializeMarkerSets({ bluemap, log }: ScriptContext): Promise<void> {
    try {
      // Create marker sets for different types of markers
      await bluemap.createMarkerSet(this.PLAYER_MARKER_SET, {
        label: 'Player Locations',
        toggleable: true,
        defaultHidden: false,
        sorting: 1
      });

      await bluemap.createMarkerSet(this.DEATH_MARKER_SET, {
        label: 'Death Locations',
        toggleable: true,
        defaultHidden: false,
        sorting: 2
      });

      await bluemap.createMarkerSet(this.COMBAT_MARKER_SET, {
        label: 'Combat Events',
        toggleable: true,
        defaultHidden: true,
        sorting: 3
      });

      await bluemap.createMarkerSet(this.POI_MARKER_SET, {
        label: 'Points of Interest',
        toggleable: true,
        defaultHidden: false,
        sorting: 4
      });

      log('BlueMap marker sets initialized successfully');
    } catch (error) {
      log(`Error initializing marker sets: ${error.message}`);
    }
  }

  @Event('player_joined')
  async handlePlayerJoin({ params, bluemap, log }: ScriptContext): Promise<void> {
    const { playerName, x, y, z } = params;

    try {
      // Add POI marker for player spawn
      await bluemap.addMarker(this.PLAYER_MARKER_SET, `player_${playerName}`, "poi", {
        label: playerName,
        position: { x, y, z },
        icon: 'player',
        maxDistance: 1000
      });

      this.playerMarkers.set(playerName, {
        lastUpdate: Date.now(),
        position: { x, y, z }
      });

      log(`Added player marker for ${playerName}`);
    } catch (error) {
      log(`Error adding player marker: ${error.message}`);
    }
  }

  @Event('player_death')
  async handlePlayerDeath({ params, bluemap, log }: ScriptContext): Promise<void> {
    const { playerName, x, y, z, attackerType, deathMessage } = params;

    try {
      // Add death marker
      const markerId = `death_${playerName}_${Date.now()}`;
      await bluemap.addMarker(this.DEATH_MARKER_SET, markerId, "poi", {
        label: `${playerName}'s Death - ${deathMessage}`,
        position: { x, y, z },
        icon: 'skull',
        maxDistance: 2000
      });

      // If killed by another entity, create a combat zone marker
      if (attackerType) {
        const radius = 10;
        const points = this.generateCirclePoints({ x, y, z }, radius, 16);

        await bluemap.addMarker(this.COMBAT_MARKER_SET, `combat_${markerId}`, "shape", {
          label: `Combat: ${playerName} vs ${attackerType}`,
          shape: points,
          shapeY: y,
          lineWidth: 2,
          lineColor: this.colors.combat,
          fillColor: { ...this.colors.combat, a: 128 }
        });
      }

      log(`Added death marker for ${playerName}`);
    } catch (error) {
      log(`Error adding death marker: ${error.message}`);
    }
  }

  @Event('container_interaction_start')
  async handleContainerOpen({ params, bluemap, log }: ScriptContext): Promise<void> {
    const { playerName, blockType, x, y, z } = params;

    try {
      // Add line marker from player to container
      const playerMarker = this.playerMarkers.get(playerName);
      if (playerMarker) {
        const markerId = `container_${playerName}_${Date.now()}`;
        await bluemap.addMarker(this.POI_MARKER_SET, markerId, "line", {
          label: `${playerName} -> ${blockType}`,
          line: [playerMarker.position, { x, y, z }],
          lineWidth: 2,
          lineColor: this.colors.poi
        });
      }
    } catch (error) {
      log(`Error adding container interaction marker: ${error.message}`);
    }
  }

  @Event('player_break_block_after')
  async handleBlockBreak({ params, bluemap, log }: ScriptContext): Promise<void> {
    const { playerId, x, y, z, block } = params;

    try {
      // Create temporary marker for broken block
      const markerId = `block_break_${playerId}_${Date.now()}`;
      await bluemap.addMarker(this.POI_MARKER_SET, markerId, "extrude", {
        label: `Broken ${block}`,
        shape: this.generateSquarePoints({ x, y, z }, 1),
        shapeMinY: y,
        shapeMaxY: y + 1,
        lineWidth: 1,
        lineColor: { r: 255, g: 0, b: 0, a: 255 },
        fillColor: { r: 255, g: 0, b: 0, a: 128 }
      });

      // Remove marker after 30 seconds
      setTimeout(async () => {
        try {
          await bluemap.removeMarker(this.POI_MARKER_SET, markerId);
        } catch (error) {
          log(`Error removing temporary block break marker: ${error.message}`);
        }
      }, 30000);
    } catch (error) {
      log(`Error adding block break marker: ${error.message}`);
    }
  }

  @Command(['map', 'clear'])
  @Description('Clear all markers from the map')
  @Permission('operator')
  async clearMarkers({ bluemap, api, params, log }: ScriptContext): Promise<void> {
    try {
      const markerSets = [
        this.PLAYER_MARKER_SET,
        this.DEATH_MARKER_SET,
        this.COMBAT_MARKER_SET,
        this.POI_MARKER_SET
      ];

      for (const set of markerSets) {
        await bluemap.removeMarkerSet(set);
        await bluemap.createMarkerSet(set);
      }

      await api.tellraw(params.sender, JSON.stringify({
        text: 'All map markers have been cleared',
        color: 'green'
      }));
    } catch (error) {
      log(`Error clearing markers: ${error.message}`);
      await api.tellraw(params.sender, JSON.stringify({
        text: `Error clearing markers: ${error.message}`,
        color: 'red'
      }));
    }
  }

  // Utility Methods
  private generateCirclePoints(center: Vector3, radius: number, segments: number): Vector3[] {
    const points: Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y,
        z: center.z + Math.sin(angle) * radius
      });
    }
    return points;
  }

  private generateSquarePoints(center: Vector3, size: number): Vector3[] {
    const halfSize = size / 2;
    return [
      { x: center.x - halfSize, y: center.y, z: center.z - halfSize },
      { x: center.x + halfSize, y: center.y, z: center.z - halfSize },
      { x: center.x + halfSize, y: center.y, z: center.z + halfSize },
      { x: center.x - halfSize, y: center.y, z: center.z + halfSize }
    ];
  }
}
