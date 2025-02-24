// store.ts

import type { PlayerStatistics, ServerStatistics } from "./statistics.types.ts";
import { StatisticsUtils } from "./statistics.utils.ts";

export class StatisticsStore {
  private kv: Deno.Kv;
  private cache: {
    players: Map<string, PlayerStatistics>;
    server: ServerStatistics;
    lastSave: number;
  };

  constructor(kv: Deno.Kv) {
    this.kv = kv;
    this.cache = {
      players: new Map(),
      server: StatisticsUtils.createDefaultServerStats(),
      lastSave: Date.now(),
    };
  }

  async initialize(): Promise<void> {
    try {
      // Load server stats
      const serverStats = await this.kv.get<ServerStatistics>([
        "statistics",
        "server",
      ]);
      if (serverStats.value) {
        this.cache.server = serverStats.value;
      }

      // Load player stats
      const playerStats = this.kv.list<PlayerStatistics>({
        prefix: ["statistics", "players"],
      });
      for await (const entry of playerStats) {
        this.cache.players.set(entry.value.playerName, entry.value);
      }
    } catch (error) {
      console.error("Error initializing statistics store:", error);
    }
  }

  async saveAll(): Promise<void> {
    const now = Date.now();
    if (now - this.cache.lastSave < 60000) return; // Only save every minute

    try {
      // Save server stats
      await this.kv.set(["statistics", "server"], this.cache.server);

      // Save player stats
      const atomic = this.kv.atomic();
      for (const [playerName, stats] of this.cache.players.entries()) {
        atomic.set(["statistics", "players", playerName], stats);
      }
      await atomic.commit();

      this.cache.lastSave = now;
    } catch (error) {
      console.error("Error saving statistics:", error);
    }
  }

  getPlayerStats(playerName: string): PlayerStatistics | null {
    return this.cache.players.get(playerName) || null;
  }

  getServerStats(): ServerStatistics {
    return this.cache.server;
  }

  ensurePlayerStats(playerId: string, playerName: string): PlayerStatistics {
    let stats = this.cache.players.get(playerName);
    if (!stats) {
      stats = StatisticsUtils.createDefaultPlayerStats(playerId, playerName);
      this.cache.players.set(playerName, stats);
    }
    return stats;
  }

  async updatePlayerStats(
    playerName: string,
    updater: (stats: PlayerStatistics) => void,
  ): Promise<void> {
    const stats = this.cache.players.get(playerName);
    if (stats) {
      updater(stats);
      if (Date.now() - this.cache.lastSave >= 60000) {
        await this.kv.set(["statistics", "players", playerName], stats);
        this.cache.lastSave = Date.now();
      }
    }
  }

  async updateServerStats(
    updater: (stats: ServerStatistics) => void,
  ): Promise<void> {
    updater(this.cache.server);
    if (Date.now() - this.cache.lastSave >= 60000) {
      await this.kv.set(["statistics", "server"], this.cache.server);
      this.cache.lastSave = Date.now();
    }
  }

  getAllPlayerStats(): Map<string, PlayerStatistics> {
    return this.cache.players;
  }
}
