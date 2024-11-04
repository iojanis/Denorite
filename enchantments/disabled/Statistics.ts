import { Module, Command, Description, Permission, Socket, Event } from '../decorators.ts';
import type { ScriptContext } from '../types';

interface DeathLocation {
  x: number;
  y: number;
  z: number;
  dimension: string;
  count: number;
  lastDeath: number;
}

interface PlayerStats {
  playerId: string;
  playerName: string;
  firstJoin: number;
  lastSeen: number;
  timeTracking: {
    total: number;
    lastStart?: number;
    sessions: Array<{
      start: number;
      end: number;
      duration: number;
    }>;
  };
  deaths: {
    total: number;
    causes: Record<string, number>;
    locations: DeathLocation[];
    lastDeath?: number;
  };
  kills: {
    players: Record<string, {
      count: number;
      lastKill: number;
      weapon?: string;
    }>;
    mobs: Record<string, {
      count: number;
      lastKill: number;
      weapon?: string;
    }>;
    total: number;
  };
  blocks: {
    broken: Record<string, {
      count: number;
      lastInteraction: number;
      locations: Array<{ x: number; y: number; z: number; dimension: string }>;
    }>;
    placed: Record<string, {
      count: number;
      lastInteraction: number;
      locations: Array<{ x: number; y: number; z: number; dimension: string }>;
    }>;
    interacted: Record<string, {
      count: number;
      lastInteraction: number;
    }>;
  };
  items: {
    used: Record<string, {
      count: number;
      lastUsed: number;
    }>;
    crafted: Record<string, {
      count: number;
      lastCrafted: number;
    }>;
    dropped: Record<string, {
      count: number;
      lastDropped: number;
    }>;
  };
  chat: {
    messages: number;
    commands: number;
    lastMessage?: number;
    lastCommand?: number;
  };
}

interface ServerStats {
  startTime: number;
  players: {
    total: number;
    unique: string[];
    peak: number;
    peakTime: number;
    current: number;
  };
  blocks: {
    broken: Record<string, number>;
    placed: Record<string, number>;
    interacted: Record<string, number>;
  };
  items: {
    used: Record<string, number>;
    crafted: Record<string, number>;
    dropped: Record<string, number>;
  };
  deaths: {
    total: number;
    causes: Record<string, number>;
  };
  kills: {
    players: number;
    mobs: Record<string, number>;
  };
  chat: {
    messages: number;
    commands: number;
  };
}

@Module({
  name: 'Statistics',
  version: '1.0.0'
})
export class StatisticsModule {
  private store: {
    players: Map<string, PlayerStats>;
    server: ServerStats;
    lastSave: number;
  };

  private kv: Deno.Kv;
  private logger: (message: string) => void;


  constructor(context: ScriptContext) {
    // Initialize basic dependencies
    this.kv = context.kv;
    this.logger = context.log;

    // Initialize store with default values
    this.store = {
      players: new Map(),
      server: {
        startTime: Date.now(),
        players: {
          total: 0,
          unique: [],
          peak: 0,
          peakTime: Date.now(),
          current: 0
        },
        blocks: {
          broken: {},
          placed: {},
          interacted: {}
        },
        items: {
          used: {},
          crafted: {},
          dropped: {}
        },
        deaths: {
          total: 0,
          causes: {}
        },
        kills: {
          players: 0,
          mobs: {}
        },
        chat: {
          messages: 0,
          commands: 0
        }
      },
      lastSave: Date.now()
    };

    // Initialize data asynchronously but don't await
    // await this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    try {
      // Load server stats
      const serverStats = await this.kv.get<ServerStats>(['statistics', 'server']);
      if (serverStats.value) {
        this.store.server = serverStats.value;
      }

      // Load player stats
      const playerStats = this.kv.list<PlayerStats>({ prefix: ['statistics', 'players'] });
      for await (const entry of playerStats) {
        this.store.players.set(entry.value.playerName, entry.value);
      }

      this.logger('Statistics module initialized successfully');
    } catch (error) {
      this.logger(`Error initializing statistics store: ${error}`);
    }
  }

  private createDefaultServerStats(): ServerStats {
    return {
      startTime: Date.now(),
      players: {
        total: 0,
        unique: [],
        peak: 0,
        peakTime: Date.now(),
        current: 0
      },
      blocks: {
        broken: {},
        placed: {},
        interacted: {}
      },
      items: {
        used: {},
        crafted: {},
        dropped: {}
      },
      deaths: {
        total: 0,
        causes: {}
      },
      kills: {
        players: 0,
        mobs: {}
      },
      chat: {
        messages: 0,
        commands: 0
      }
    };
  }

  private createDefaultPlayerStats(playerId: string, playerName: string): PlayerStats {
    return {
      playerId,
      playerName,
      firstJoin: Date.now(),
      lastSeen: Date.now(),
      timeTracking: {
        total: 0,
        sessions: []
      },
      deaths: {
        total: 0,
        causes: {},
        locations: []
      },
      kills: {
        players: {},
        mobs: {},
        total: 0
      },
      blocks: {
        broken: {},
        placed: {},
        interacted: {}
      },
      items: {
        used: {},
        crafted: {},
        dropped: {}
      },
      chat: {
        messages: 0,
        commands: 0
      }
    };
  }

  private async initialize(): Promise<void> {
    try {
      // Load server stats
      const serverStats = await this.kv.get<ServerStats>(['statistics', 'server']);
      if (serverStats.value) {
        this.store.server = serverStats.value;
      }

      // Load player stats
      const playerStats = this.kv.list<PlayerStats>({ prefix: ['statistics', 'players'] });
      for await (const entry of playerStats) {
        this.store.players.set(entry.value.playerName, entry.value);
      }
    } catch (error) {
      this.logger(`Error initializing statistics store: ${error}`);
    }
  }

  private async saveStore(): Promise<void> {
    const now = Date.now();
    if (now - this.store.lastSave < 60000) return; // Only save every minute

    try {
      // Save server stats
      await this.kv.set(['statistics', 'server'], this.store.server);

      // Save player stats
      const atomic = this.kv.atomic();
      for (const [playerName, stats] of this.store.players.entries()) {
        atomic.set(['statistics', 'players', playerName], stats);
      }
      await atomic.commit();

      this.store.lastSave = now;
    } catch (error) {
      this.logger(`Error saving statistics: ${error}`);
    }
  }

  private parseDeathCause(deathMessage: string): string {
    deathMessage = deathMessage.toLowerCase();
    const causes = {
      FALL: ['fell', 'hit the ground', 'fell from a high place'],
      DROWNING: ['drowned'],
      FIRE: ['burned', 'flames', 'fire'],
      EXPLOSION: ['blown up', 'explosion'],
      VOID: ['fell out of the world', 'in the void'],
      PVP: ['slain by', 'shot by'],
      MOB: ['zombie', 'skeleton', 'creeper', 'spider'],
      MAGIC: ['magic', 'potion', 'withered away'],
      STARVE: ['starved'],
      SUFFOCATION: ['suffocated']
    };

    for (const [cause, patterns] of Object.entries(causes)) {
      if (patterns.some(pattern => deathMessage.includes(pattern))) {
        return cause;
      }
    }

    return 'OTHER';
  }

  private formatTime(ms: number): string {
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

  private getTopStats<T extends Record<string, number>>(
    stats: T,
    limit: number = 5
  ): Array<[string, number]> {
    return Object.entries(stats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit);
  }

  private ensurePlayerStats(playerId: string, playerName: string): PlayerStats {
    let stats = this.store.players.get(playerName);
    if (!stats) {
      stats = this.createDefaultPlayerStats(playerId, playerName);
      this.store.players.set(playerName, stats);
    }
    return stats;
  }

  @Event('player_joined')
  async handlePlayerJoin(context: ScriptContext): Promise<void> {
    const { playerId, playerName } = context.params;

    const stats = this.ensurePlayerStats(playerId, playerName);
    stats.lastSeen = Date.now();
    stats.timeTracking.lastStart = Date.now();

    this.store.server.players.current++;
    if (this.store.server.players.current > this.store.server.players.peak) {
      this.store.server.players.peak = this.store.server.players.current;
      this.store.server.players.peakTime = Date.now();
    }
    if (!this.store.server.players.unique.includes(playerName)) {
      this.store.server.players.unique.push(playerName);
      this.store.server.players.total++;
    }

    await this.saveStore();
  }

  @Event('player_left')
  async handlePlayerLeave(context: ScriptContext): Promise<void> {
    const { playerName } = context.params;
    const stats = this.store.players.get(playerName);

    if (stats && stats.timeTracking.lastStart) {
      const session = {
        start: stats.timeTracking.lastStart,
        end: Date.now(),
        duration: Date.now() - stats.timeTracking.lastStart
      };
      stats.timeTracking.sessions.push(session);
      stats.timeTracking.total += session.duration;
      stats.timeTracking.lastStart = undefined;
      stats.lastSeen = Date.now();
    }

    this.store.server.players.current = Math.max(0, this.store.server.players.current - 1);
    await this.saveStore();
  }

  @Event('player_death')
  async handlePlayerDeath(context: ScriptContext): Promise<void> {
    const { playerName, deathMessage, x, y, z, dimension } = context.params;
    const cause = this.parseDeathCause(deathMessage);
    const stats = this.store.players.get(playerName);

    if (stats) {
      // Update player death statistics
      stats.deaths.total++;
      stats.deaths.causes[cause] = (stats.deaths.causes[cause] || 0) + 1;
      stats.deaths.lastDeath = Date.now();

      // Update death location
      const deathLocation: DeathLocation = {
        x, y, z, dimension,
        count: 1,
        lastDeath: Date.now()
      };

      const existingLocation = stats.deaths.locations.find(loc =>
        loc.dimension === dimension &&
        Math.abs(loc.x - x) < 5 &&
        Math.abs(loc.y - y) < 5 &&
        Math.abs(loc.z - z) < 5
      );

      if (existingLocation) {
        existingLocation.count++;
        existingLocation.lastDeath = Date.now();
      } else {
        stats.deaths.locations.push(deathLocation);
      }

      // Keep only top 10 death locations
      stats.deaths.locations.sort((a, b) => b.count - a.count);
      if (stats.deaths.locations.length > 10) {
        stats.deaths.locations.length = 10;
      }
    }

    // Update server death statistics
    this.store.server.deaths.total++;
    this.store.server.deaths.causes[cause] = (this.store.server.deaths.causes[cause] || 0) + 1;

    await this.saveStore();
  }

  @Event('player_chat')
  async handlePlayerChat(context: ScriptContext): Promise<void> {
    const { playerName } = context.params;
    const stats = this.store.players.get(playerName);

    if (stats) {
      stats.chat.messages++;
      stats.chat.lastMessage = Date.now();
    }

    this.store.server.chat.messages++;
    await this.saveStore();
  }

  @Event('player_command')
  async handlePlayerCommand(context: ScriptContext): Promise<void> {
    const { playerName } = context.params;
    const stats = this.store.players.get(playerName);

    if (stats) {
      stats.chat.commands++;
      stats.chat.lastCommand = Date.now();
    }

    this.store.server.chat.commands++;
    await this.saveStore();
  }

  @Event('player_break_block_after')
  async handleBlockBreak(context: ScriptContext): Promise<void> {
    const { playerName, block, x, y, z, dimension } = context.params;
    const stats = this.store.players.get(playerName);

    if (stats) {
      if (!stats.blocks.broken[block]) {
        stats.blocks.broken[block] = {
          count: 0,
          lastInteraction: 0,
          locations: []
        };
      }

      stats.blocks.broken[block].count++;
      stats.blocks.broken[block].lastInteraction = Date.now();
      stats.blocks.broken[block].locations.push({ x, y, z, dimension });

      // Keep only last 10 locations per block type
      if (stats.blocks.broken[block].locations.length > 10) {
        stats.blocks.broken[block].locations.shift();
      }
    }

    this.store.server.blocks.broken[block] = (this.store.server.blocks.broken[block] || 0) + 1;
    await this.saveStore();
  }

  @Event('player_use_item')
  async handleItemUse(context: ScriptContext): Promise<void> {
    const { playerName, item } = context.params;
    const stats = this.store.players.get(playerName);

    if (stats) {
      if (!stats.items.used[item]) {
        stats.items.used[item] = {
          count: 0,
          lastUsed: 0
        };
      }

      stats.items.used[item].count++;
      stats.items.used[item].lastUsed = Date.now();
    }

    this.store.server.items.used[item] = (this.store.server.items.used[item] || 0) + 1;
    await this.saveStore();
  }

  @Command(['stats'])
  @Description('View your statistics')
  @Permission('player')
  async viewStats({ params, api }: ScriptContext): Promise<void> {
    const { sender } = params;
    const stats = this.store.players.get(sender);

    if (!stats) {
      await api.tellraw(sender, JSON.stringify({
        text: "No statistics available.",
        color: "red"
      }));
      return;
    }

    const messages = [
      `§6=== Your Statistics`
      `§6=== Your Statistics ===`,
      `§7First Join: §f${new Date(stats.firstJoin).toLocaleDateString()}`,
      `§7Total Playtime: §f${this.formatTime(stats.timeTracking.total)}`,
      `§7Last Seen: §f${new Date(stats.lastSeen).toLocaleString()}`,
      '',
      '§6=== Combat ===',
      `§7Deaths: §f${stats.deaths.total}`,
      `§7Player Kills: §f${Object.values(stats.kills.players).reduce((sum, kill) => sum + kill.count, 0)}`,
      `§7Mob Kills: §f${Object.values(stats.kills.mobs).reduce((sum, kill) => sum + kill.count, 0)}`,
      '',
      '§6=== Top Death Causes ===',
      ...this.getTopStats(stats.deaths.causes)
        .map(([cause, count]) => `§7${cause}: §f${count}`),
      '',
      '§6=== Blocks ===',
      `§7Total Broken: §f${Object.values(stats.blocks.broken)
      .reduce((sum, block) => sum + block.count, 0)}`,
      `§7Total Placed: §f${Object.values(stats.blocks.placed)
      .reduce((sum, block) => sum + block.count, 0)}`,
      '',
      '§6=== Most Broken Blocks ===',
      ...this.getTopStats(
        Object.fromEntries(
          Object.entries(stats.blocks.broken)
            .map(([block, data]) => [block, data.count])
        )
      ).map(([block, count]) => `§7${block}: §f${count}`),
      '',
      '§6=== Items ===',
      `§7Total Used: §f${Object.values(stats.items.used)
      .reduce((sum, item) => sum + item.count, 0)}`,
      `§7Total Crafted: §f${Object.values(stats.items.crafted)
      .reduce((sum, item) => sum + item.count, 0)}`,
      '',
      '§6=== Most Used Items ===',
      ...this.getTopStats(
        Object.fromEntries(
          Object.entries(stats.items.used)
            .map(([item, data]) => [item, data.count])
        )
      ).map(([item, count]) => `§7${item}: §f${count}`),
      '',
      '§6=== Communication ===',
      `§7Messages Sent: §f${stats.chat.messages}`,
      `§7Commands Used: §f${stats.chat.commands}`
    ];

    for (const message of messages) {
      await api.tellraw(sender, message);
    }
  }

  @Command(['stats', 'server'])
  @Description('View server statistics')
  @Permission('player')
  async viewServerStats({ params, api }: ScriptContext): Promise<void> {
    const stats = this.store.server;
    const messages = [
      `§6=== Server Statistics ===`,
      `§7Uptime: §f${this.formatTime(Date.now() - stats.startTime)}`,
      `§7Total Players: §f${stats.players.total}`,
      `§7Unique Players: §f${stats.players.unique.length}`,
      `§7Peak Players: §f${stats.players.peak} (${new Date(stats.players.peakTime).toLocaleString()})`,
      `§7Current Players: §f${stats.players.current}`,
      '',
      '§6=== Player Activity ===',
      `§7Total Deaths: §f${stats.deaths.total}`,
      `§7Player Kills: §f${stats.kills.players}`,
      `§7Messages Sent: §f${stats.chat.messages}`,
      `§7Commands Used: §f${stats.chat.commands}`,
      '',
      '§6=== Most Common Death Causes ===',
      ...this.getTopStats(stats.deaths.causes)
        .map(([cause, count]) => `§7${cause}: §f${count}`),
      '',
      '§6=== Most Killed Mobs ===',
      ...this.getTopStats(stats.kills.mobs)
        .map(([mob, count]) => `§7${mob}: §f${count}`),
      '',
      '§6=== Most Broken Blocks ===',
      ...this.getTopStats(stats.blocks.broken)
        .map(([block, count]) => `§7${block}: §f${count}`),
      '',
      '§6=== Most Used Items ===',
      ...this.getTopStats(stats.items.used)
        .map(([item, count]) => `§7${item}: §f${count}`)
    ];

    for (const message of messages) {
      await api.tellraw(params.sender, message);
    }
  }

  @Command(['stats', 'player'])
  @Description('View another player\'s statistics')
  @Permission('player')
  async viewPlayerStats({ params, api }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const targetPlayer = args.player as string;
    const stats = this.store.players.get(targetPlayer);

    if (!stats) {
      await api.tellraw(sender, JSON.stringify({
        text: `No statistics available for player ${targetPlayer}.`,
        color: "red"
      }));
      return;
    }

    const messages = [
      `§6=== ${targetPlayer}'s Statistics ===`,
      `§7First Join: §f${new Date(stats.firstJoin).toLocaleDateString()}`,
      `§7Total Playtime: §f${this.formatTime(stats.timeTracking.total)}`,
      `§7Last Seen: §f${new Date(stats.lastSeen).toLocaleString()}`,
      '',
      '§6=== Combat ===',
      `§7Deaths: §f${stats.deaths.total}`,
      `§7Player Kills: §f${Object.values(stats.kills.players).reduce((sum, kill) => sum + kill.count, 0)}`,
      `§7Mob Kills: §f${Object.values(stats.kills.mobs).reduce((sum, kill) => sum + kill.count, 0)}`,
      '',
      '§6=== Activity ===',
      `§7Blocks Broken: §f${Object.values(stats.blocks.broken).reduce((sum, block) => sum + block.count, 0)}`,
      `§7Items Used: §f${Object.values(stats.items.used).reduce((sum, item) => sum + item.count, 0)}`,
      `§7Messages Sent: §f${stats.chat.messages}`
  ];

    for (const message of messages) {
      await api.tellraw(sender, message);
    }
  }

  @Socket('get_statistics')
  async getStatistics(): Promise<ServerStats> {
    return this.store.server;
  }

  @Socket('get_player_statistics')
  async getPlayerStatistics(context: ScriptContext): Promise<PlayerStats | null> {
    const { playerName } = context.params;
    return this.store.players.get(playerName) || null;
  }

  @Socket('get_leaderboard')
  async getLeaderboard(context: ScriptContext): Promise<{
    type: string;
    data: Array<{ name: string; value: number; extra?: string }>;
  }> {
    const { type = 'kills' } = context.params;
    const leaderboard: Array<{ name: string; value: number; extra?: string }> = [];

    switch (type) {
      case 'kills':
        for (const [name, stats] of this.store.players.entries()) {
          const totalKills = stats.kills.total;
          const kd = (totalKills / (stats.deaths.total || 1)).toFixed(2);
          leaderboard.push({
            name,
            value: totalKills,
            extra: `K/D: ${kd}`
          });
        }
        break;

      case 'playtime':
        for (const [name, stats] of this.store.players.entries()) {
          leaderboard.push({
            name,
            value: stats.timeTracking.total,
            extra: this.formatTime(stats.timeTracking.total)
          });
        }
        break;

      case 'blocks':
        for (const [name, stats] of this.store.players.entries()) {
          const totalBlocks = Object.values(stats.blocks.broken)
            .reduce((sum, block) => sum + block.count, 0);
          leaderboard.push({
            name,
            value: totalBlocks
          });
        }
        break;

      case 'deaths':
        for (const [name, stats] of this.store.players.entries()) {
          leaderboard.push({
            name,
            value: stats.deaths.total
          });
        }
        break;
    }

    return {
      type,
      data: leaderboard
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    };
  }
}
