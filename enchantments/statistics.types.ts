// types.ts

export interface Location {
  x: number;
  y: number;
  z: number;
  dimension: string;
}

export interface DeathLocation extends Location {
  count: number;
  lastDeath: number;
}

export interface EntityKill {
  entityType: string;
  count: number;
  lastKill: number;
  weapon?: string;
}

export interface BlockInteraction {
  count: number;
  lastInteraction: number;
  locations: Location[];
}

export interface ItemInteraction {
  count: number;
  lastUsed: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  earned: number;
  progress?: number;
  maxProgress?: number;
}

export interface TimeTracking {
  total: number;
  lastStart?: number;
  sessions: Array<{
    start: number;
    end: number;
    duration: number;
  }>;
}

export interface PlayerStatistics {
  playerId: string;
  playerName: string;
  firstJoin: number;
  lastSeen: number;
  timeTracking: TimeTracking;
  deaths: {
    total: number;
    causes: Record<string, number>;
    locations: DeathLocation[];
    lastDeath?: number;
  };
  kills: {
    players: Record<string, EntityKill>;
    mobs: Record<string, EntityKill>;
    total: number;
  };
  blocks: {
    broken: Record<string, BlockInteraction>;
    placed: Record<string, BlockInteraction>;
    interacted: Record<string, BlockInteraction>;
  };
  items: {
    used: Record<string, ItemInteraction>;
    crafted: Record<string, ItemInteraction>;
    dropped: Record<string, ItemInteraction>;
    collected: Record<string, ItemInteraction>;
  };
  chat: {
    messages: number;
    commands: number;
    lastMessage?: number;
    lastCommand?: number;
  };
  achievements: Record<string, Achievement>;
}

export interface ServerStatistics {
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
    collected: Record<string, number>;
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

export interface StatisticsManager {
  getPlayerStats(playerName: string): Promise<PlayerStatistics | null>;
  getServerStats(): Promise<ServerStatistics>;
  updateStats(event: any): Promise<void>;
  saveStats(): Promise<void>;
}
