// utils.ts

import type {
  DeathLocation,
  Location,
  PlayerStatistics,
  ServerStatistics,
} from "./statistics.types";

export class StatisticsUtils {
  static readonly DEATH_CAUSES = {
    FALL: ["fell", "hit the ground", "fell from a high place"],
    DROWNING: ["drowned"],
    FIRE: ["burned", "flames", "fire"],
    EXPLOSION: ["blown up", "explosion"],
    VOID: ["fell out of the world", "in the void"],
    PVP: ["slain by", "shot by"],
    MOB: ["skeleton", "zombie", "creeper", "spider"],
    MAGIC: ["magic", "potion", "withered away"],
    STARVE: ["starved"],
    SUFFOCATION: ["suffocated"],
    OTHER: [],
  };

  static parseDeathCause(deathMessage: string): string {
    deathMessage = deathMessage.toLowerCase();

    for (const [cause, patterns] of Object.entries(this.DEATH_CAUSES)) {
      if (patterns.some((pattern) => deathMessage.includes(pattern))) {
        return cause;
      }
    }

    return "OTHER";
  }

  static createDefaultPlayerStats(
    playerId: string,
    playerName: string,
  ): PlayerStatistics {
    return {
      playerId,
      playerName,
      firstJoin: Date.now(),
      lastSeen: Date.now(),
      timeTracking: {
        total: 0,
        sessions: [],
      },
      deaths: {
        total: 0,
        causes: {},
        locations: [],
      },
      kills: {
        players: {},
        mobs: {},
        total: 0,
      },
      blocks: {
        broken: {},
        placed: {},
        interacted: {},
      },
      items: {
        used: {},
        crafted: {},
        dropped: {},
        collected: {},
      },
      chat: {
        messages: 0,
        commands: 0,
      },
      achievements: {},
    };
  }

  static createDefaultServerStats(): ServerStatistics {
    return {
      startTime: Date.now(),
      players: {
        total: 0,
        unique: [],
        peak: 0,
        peakTime: Date.now(),
        current: 0,
      },
      blocks: {
        broken: {},
        placed: {},
        interacted: {},
      },
      items: {
        used: {},
        crafted: {},
        dropped: {},
        collected: {},
      },
      deaths: {
        total: 0,
        causes: {},
      },
      kills: {
        players: 0,
        mobs: {},
      },
      chat: {
        messages: 0,
        commands: 0,
      },
    };
  }

  static formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  static formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }

  static isSameLocation(
    loc1: Location,
    loc2: Location,
    tolerance: number = 3,
  ): boolean {
    return (
      loc1.dimension === loc2.dimension &&
      Math.abs(loc1.x - loc2.x) <= tolerance &&
      Math.abs(loc1.y - loc2.y) <= tolerance &&
      Math.abs(loc1.z - loc2.z) <= tolerance
    );
  }

  static updateDeathLocation(
    locations: DeathLocation[],
    newDeath: Location,
  ): void {
    const existingLocation = locations.find((loc) =>
      this.isSameLocation(loc, newDeath)
    );

    if (existingLocation) {
      existingLocation.count++;
      existingLocation.lastDeath = Date.now();
    } else {
      locations.push({
        ...newDeath,
        count: 1,
        lastDeath: Date.now(),
      });
    }

    // Keep only top 10 death locations
    locations.sort((a, b) => b.count - a.count);
    if (locations.length > 10) {
      locations.length = 10;
    }
  }

  static getTopStats<T extends Record<string, number>>(
    stats: T,
    limit: number = 5,
  ): Array<[string, number]> {
    return Object.entries(stats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit);
  }

  static calculateKDRatio(kills: number, deaths: number): string {
    if (deaths === 0) return kills.toFixed(2);
    return (kills / deaths).toFixed(2);
  }

  static mergeStats(
    target: Record<string, number>,
    source: Record<string, number>,
  ): void {
    for (const [key, value] of Object.entries(source)) {
      target[key] = (target[key] || 0) + value;
    }
  }
}
