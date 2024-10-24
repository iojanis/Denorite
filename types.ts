import type { Api } from "./types.d.ts";
import {AuthService} from "./core/authService.ts";

export interface ScriptContext {
  params: Record<string, any>;
  kv: Deno.Kv;
  sendToMinecraft: (data: unknown) => Promise<unknown>;
  sendToPlayer: (playerId: string, data: unknown) => void;
  log: (message: string) => void;
  api: Api; // Replace with a more specific type if available
  auth: AuthService; // Replace with a more specific type if available
  config: unknown; // Replace with a more specific type if available
  executeModuleScript: (moduleName: string, methodName: string, params: Record<string, unknown>) => Promise<unknown>;
}

export interface SessionData {
  startTime: string;
}

export interface PlayerStats {
  totalPlayTime: number;
  loginCount: number;
  blocksPlaced: number;
  blocksBroken: number;
}

export interface PlayerData {
  stats: PlayerStats;
  achievements: string[];
}
