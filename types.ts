import type { Api } from "./types.d.ts";
import {AuthService} from "./core/AuthService.ts";

import { PlayerManager } from "./core/PlayerManager.ts";
import {RconClient} from "./core/RconClient.ts";

export interface ScriptContext {
  params: Record<string, unknown>;
  kv: Deno.Kv;
  sendToMinecraft: (data: unknown) => Promise<unknown>;
  sendToPlayer: (playerId: string, data: unknown) => void;
  broadcastPlayers: (data: unknown) => void;
  messagePlayer: (playerId: string, message: string, options?: {
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    sound?: string;
  }) => Promise<void>;
  log: (message: string) => void;
  api: {
    executeCommand: (command: string) => Promise<unknown>;
    [key: string]: any;
  };
  display: {
    executeCommand: (command: string) => Promise<unknown>;
    [key: string]: any;
  };
  auth: any;
  executeModuleScript: (moduleName: string, methodName: string, params: Record<string, unknown>) => Promise<unknown>;
  playerManager: PlayerManager;
  players: PlayerData[];
  isOnline: (playerName: string) => boolean;
  isOperator: (playerName: string) => boolean;
  rcon: RconClient
}

export interface PlayerData {
  name: string;
  id: string;
  role: 'guest' | 'player' | 'operator';
  joinTime: string;
  location?: {
    x: number;
    y: number;
    z: number;
    dimension: string;
  };
  clientInfo?: {
    ip: string;
    version: string;
  };
}
