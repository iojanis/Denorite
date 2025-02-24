// types.ts
import { AuthService } from "./core/AuthService.ts";
import { PlayerManager, EnhancedPlayerData } from "./core/PlayerManager.ts";
import { RconClient } from "./core/RconClient.ts";

// Interface for Tellraw components
export interface TellrawComponent {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  insertion?: string;
  clickEvent?: {
    action: "open_url" | "run_command" | "suggest_command" | "change_page" | "copy_to_clipboard";
    value: string;
  };
  hoverEvent?: {
    action: "show_text" | "show_item" | "show_entity";
    contents: string | object;
  };
  extra?: TellrawComponent[];
}

// Command metadata interface
export interface CommandMetadata {
  name: string;
  description: string;
  usage: string;
  permissions: string[];
  subcommands?: any[];
}

// Socket handler interface
export interface SocketHandler {
  moduleName: string;
  methodName: string;
}

// Minecraft API interface
export interface MinecraftAPI {
  getPlayers(): Promise<string[]>;
  getPlayerByUuid(uuid: string): Promise<any>;
  getPlayerPosition(player: string): Promise<{ x: number; y: number; z: number; dimension: string }>;
  setBlock(x: number, y: number, z: number, block: string): Promise<void>;
  getBlock(x: number, y: number, z: number): Promise<string>;
  spawnEntity(x: number, y: number, z: number, entity: string): Promise<string>;
  executeCommand(command: string): Promise<string>;
  execute(command: string): Promise<string>;
  playSound(sound: string, player: string, x: number, y: number, z: number, volume?: number, pitch?: number): Promise<void>;
  giveItem(player: string, item: string, count?: number): Promise<void>;
  sendMessage(player: string, message: string): Promise<void>;
  broadcastMessage(message: string): Promise<void>;
}

// Display API interface
export interface DisplayAPI {
  createText(id: string, text: string, options?: any): Promise<void>;
  updateText(id: string, text: string, options?: any): Promise<void>;
  removeDisplay(id: string): Promise<void>;
  createImage(id: string, imageUrl: string, options?: any): Promise<void>;
  createItemDisplay(id: string, item: string, options?: any): Promise<void>;
  executeCommand(command: string): Promise<string>;
}

// Bluemap API interface
export interface BluemapAPI {
  createMarker(id: string, options: any): Promise<void>;
  updateMarker(id: string, options: any): Promise<void>;
  removeMarker(id: string): Promise<void>;
  getMarkers(): Promise<any[]>;
}

// Files API interface
export interface FilesAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(directory: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
}

// Player API interface
export interface PlayerAPI {
  getAll(): EnhancedPlayerData[];
  isOnline(playerName: string): boolean;
  isOperator(playerName: string): boolean;
  sendWebSocket(playerId: string, data: unknown): void;
  broadcastWebSocket(data: unknown): void;
  sendGameMessage(playerId: string, message: string, options?: {
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    sound?: string;
  }): Promise<void>;
}

// Modules API interface
export interface ModulesAPI {
  execute(moduleName: string, methodName: string, params: Record<string, unknown>): Promise<unknown>;
}

// Script context interface
export interface ScriptContext {
  params: Record<string, unknown>;
  kv: Deno.Kv;
  rcon?: RconClient;

  // APIs
  api: MinecraftAPI;
  display: DisplayAPI;
  auth: AuthService;
  bluemap: BluemapAPI;
  files: FilesAPI;

  // Player management
  playerManager: PlayerManager;
  players: PlayerAPI;

  // Module execution
  modules: ModulesAPI;

  // Command management
  getCommands(permission: string): CommandMetadata[];
  handleCommand(data: {
    command: string;
    data: {
      subcommand: string;
      arguments: unknown;
      sender: string;
      senderType: string;
    };
  }): Promise<unknown>;

  // WebSocket messaging
  sendToMinecraft(data: unknown): Promise<unknown>;
  sendToPlayer(playerId: string, data: unknown): void;
  broadcastPlayers(data: unknown): void;
  messagePlayer(playerId: string, message: string, options?: {
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    sound?: string;
  }): Promise<void>;

  // Tellraw messaging
  tellraw(target: string, message: string | TellrawComponent | TellrawComponent[]): Promise<TellrawComponent[]>;

  // Logging
  log(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
