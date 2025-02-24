// deno-lint-ignore-file
// types.d.ts

import { ConfigManager } from "./core/ConfigManager.ts";
import { AuthService } from "./core/AuthService.ts";
import { PlayerManager } from "./core/PlayerManager.ts";

interface RateLimitRule {
  tokensPerInterval: number;
  interval: number; // in milliseconds
  burstLimit: number;
}

// Define the structure of the data passed to scripts
interface EventData {
  playerId: string;
  playerName: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  [key: string]: any; // Allow for additional properties
}

// Define the structure of the params object
interface ScriptParams {
  event: string;
  data: EventData;
}

// Define the structure of the object sent to Minecraft
interface MinecraftCommand {
  type: "command" | "chat";
  data: string;
}

// Define the sendToMinecraft function type
type SendToMinecraft = (data: MinecraftCommand) => Promise<any>;

// Define the log function type
type LogFunction = (message: string) => void;

interface AuthContext {
  createToken: (payload: { [key: string]: any }) => Promise<string>;
  verifyToken: (token: string) => Promise<any>;
  checkPermission: (
    requiredLevel: "guest" | "player" | "operator",
    operatorLevel?: number,
  ) => Promise<boolean>;
  getPlayerIdFromName: (playerName: string) => Promise<string | null>;
  getPlayerNameFromId: (playerId: string) => Promise<string | null>;
}

interface Api {
  executeCommand(command: string): Promise<string>;
  xp(
    mode: "get" | "set" | "add" | "remove",
    target: string,
    amount?: number,
    type?: "points" | "levels",
  ): Promise<string>;

  teleport(target: string, x: string, y: string, z: string): Promise<string>;
  give(target: string, item: string, amount?: number): Promise<string>;
  clear(target: string, item?: string, maxCount?: number): Promise<string>;
  setBlock(x: number, y: number, z: number, block: string): Promise<string>;
  executeAs(target: string, command: string): Promise<string>;
  kill(target: string): Promise<string>;
  weather(
    type: "clear" | "rain" | "thunder",
    duration?: number,
  ): Promise<string>;
  time(action: "set" | "add", value: number | "day" | "night"): Promise<string>;
  gamemode(
    mode: "survival" | "creative" | "adventure" | "spectator",
    target?: string,
  ): Promise<string>;
  effect(
    action: "give" | "clear",
    target: string,
    effect?: string,
    duration?: number,
    amplifier?: number,
  ): Promise<string>;
  enchant(target: string, enchantment: string, level?: number): Promise<string>;
  summon(
    entity: string,
    x: number,
    y: number,
    z: number,
    nbt?: string,
  ): Promise<string>;
  setWorldSpawn(x: number, y: number, z: number): Promise<string>;
  spawnPoint(target: string, x: number, y: number, z: number): Promise<string>;
  difficulty(level: "peaceful" | "easy" | "normal" | "hard"): Promise<string>;
  getBlockData(x: number, y: number, z: number): Promise<Record<string, any>>;
  getEntityData(target: string, path?: string): Promise<Record<string, any>>;
  fill(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    block: string,
    mode?: "replace" | "destroy" | "hollow" | "keep" | "outline",
  ): Promise<string>;
  clone(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    x: number,
    y: number,
    z: number,
    maskMode?: "replace" | "masked",
    cloneMode?: "force" | "move" | "normal",
  ): Promise<string>;
  getScoreboardPlayers(objective: string): Promise<Record<string, number>>;
  setScoreboardPlayer(
    player: string,
    objective: string,
    score: number,
  ): Promise<string>;
  addScoreboardPlayer(
    player: string,
    objective: string,
    score: number,
  ): Promise<string>;
  removeScoreboardPlayer(
    player: string,
    objective: string,
    score: number,
  ): Promise<string>;
  scoreboardObjectives(): Promise<string[]>;
  scoreboardObjectiveAdd(
    objective: string,
    criteria: string,
    displayName?: string,
  ): Promise<string>;
  scoreboardObjectiveRemove(objective: string): Promise<string>;
  scoreboardObjectiveSetDisplay(
    slot: string,
    objective?: string,
  ): Promise<string>;
  scoreboardPlayersOperation(
    target: string,
    targetObjective: string,
    operation: string,
    source: string,
    sourceObjective: string,
  ): Promise<string>;
  getBossbar(id: string): Promise<Record<string, any>>;
  setBossbar(
    id: string,
    property:
      | "name"
      | "color"
      | "style"
      | "value"
      | "max"
      | "visible"
      | "players",
    value: string | number | boolean,
  ): Promise<string>;
  getWorldBorder(): Promise<{ center: [number, number]; diameter: number }>;
  setWorldBorder(diameter: number, time?: number): Promise<string>;
  getTime(): Promise<{ day: number; daytime: number }>;
  advancement(
    action: "grant" | "revoke",
    target: string,
    advancement: string,
  ): Promise<string>;
  attribute(
    target: string,
    attribute: string,
    action: "get" | "base" | "modifier",
    ...args: any[]
  ): Promise<string>;
  ban(target: string, reason?: string): Promise<string>;
  banIp(target: string, reason?: string): Promise<string>;
  banlist(type?: "players" | "ips"): Promise<string>;
  damage(target: string, amount: number, type?: string): Promise<string>;
  datapack(
    action: "list" | "enable" | "disable",
    name?: string,
  ): Promise<string>;
  debug(action: "start" | "stop" | "function"): Promise<string>;
  defaultGamemode(
    mode: "survival" | "creative" | "adventure" | "spectator",
  ): Promise<string>;
  deOp(target: string): Promise<string>;
  fillBiome(
    from: [number, number, number],
    to: [number, number, number],
    biome: string,
  ): Promise<string>;
  forceload(
    action: "add" | "remove" | "query",
    from: [number, number],
    to?: [number, number],
  ): Promise<string>;
  function(name: string): Promise<string>;
  help(command?: string): Promise<string>;
  item(
    action: "replace" | "modify",
    target: string,
    slot: string,
    item?: string,
    count?: number,
  ): Promise<string>;
  kick(target: string, reason?: string): Promise<string>;
  listPlayers(): Promise<string>;
  locate(structure: string): Promise<string>;
  seed(): Promise<string>;
  loot(
    target: "spawn" | "give" | "insert" | "replace",
    destination: string,
    source: string,
    ...args: any[]
  ): Promise<string>;
  me(action: string): Promise<string>;
  msg(target: string, message: string): Promise<string>;
  op(target: string): Promise<string>;
  pardon(target: string): Promise<string>;
  pardonIp(target: string): Promise<string>;
  particle(
    name: string,
    pos: [number, number, number],
    ...args: any[]
  ): Promise<string>;
  playSound(
    sound: string,
    source: string,
    target: string,
    ...args: any[]
  ): Promise<string>;
  recipe(
    action: "give" | "take",
    target: string,
    recipe: string,
  ): Promise<string>;
  reload(): Promise<string>;
  say(message: string): Promise<string>;
  schedule(
    action: "function" | "clear",
    time: string,
    name: string,
  ): Promise<string>;
  setIdleTimeout(minutes: number): Promise<string>;
  spectate(target?: string, player?: string): Promise<string>;
  spreadPlayers(
    center: [number, number],
    distance: number,
    maxRange: number,
    respectTeams: boolean,
    targets: string,
  ): Promise<string>;
  stopSound(target: string, source?: string, sound?: string): Promise<string>;
  tag(
    target: string,
    action: "add" | "remove" | "list",
    value?: string,
  ): Promise<string>;
  team(
    action: "add" | "remove" | "empty" | "join" | "leave" | "modify",
    team: string,
    ...args: any[]
  ): Promise<string>;
  teamMsg(message: string): Promise<string>;
  tellraw(target: string, message: string): Promise<string>;
  title(
    target: string,
    action: "title" | "subtitle" | "actionbar" | "clear" | "reset",
    ...args: any[]
  ): Promise<string>;
  trigger(
    objective: string,
    action?: "add" | "set",
    value?: number,
  ): Promise<string>;
  whitelist(
    action: "on" | "off" | "list" | "add" | "remove" | "reload",
    target?: string,
  ): Promise<string>;
  worldBorderCenter(x: number, z: number): Promise<string>;
  worldBorderDamage(damagePerBlock: number): Promise<string>;
  worldBorderWarningDistance(distance: number): Promise<string>;
  worldBorderWarningTime(time: number): Promise<string>;
  gameruleList(): Promise<Record<string, string>>;
  gameruleSet(rule: string, value: string | number | boolean): Promise<string>;
  gameruleGet(rule: string): Promise<string>;
  xpAdd(target: string, amount: number): Promise<string>;
  xpSet(target: string, amount: number): Promise<string>;
  xpQuery(target: string, type: "points" | "levels"): Promise<number>;
  timeSet(
    value: number | "day" | "night" | "noon" | "midnight",
  ): Promise<string>;
  timeAdd(amount: number): Promise<string>;
  timeQuery(type: "daytime" | "gametime" | "day"): Promise<number>;
  weatherClear(duration?: number): Promise<string>;
  weatherRain(duration?: number): Promise<string>;
  weatherThunder(duration?: number): Promise<string>;
  difficultySet(
    level: "peaceful" | "easy" | "normal" | "hard",
  ): Promise<string>;
  difficultyGet(): Promise<string>;
  advancementGrant(
    target: string,
    advancement: string | "everything",
  ): Promise<string>;
  advancementRevoke(
    target: string,
    advancement: string | "everything",
  ): Promise<string>;
  bossbarAdd(id: string, name: string): Promise<string>;
  bossbarRemove(id: string): Promise<string>;
  bossbarList(): Promise<string[]>;
  datapackList(): Promise<{ available: string[]; enabled: string[] }>;
  datapackEnable(name: string): Promise<string>;
  datapackDisable(name: string): Promise<string>;
  effectGive(
    target: string,
    effect: string,
    duration?: number,
    amplifier?: number,
    hideParticles?: boolean,
  ): Promise<string>;
  effectClear(target: string, effect?: string): Promise<string>;
  getPlayerData(player: string): Promise<Record<string, any>>;
  getPlayerPosition(
    player: string,
  ): Promise<{ x: number; y: number; z: number }>;
  getPlayerRotation(player: string): Promise<{ yaw: number; pitch: number }>;
  getPlayerHealth(player: string): Promise<number>;
  getPlayerFood(player: string): Promise<{ level: number; saturation: number }>;
  getPlayerXP(
    player: string,
  ): Promise<{ level: number; points: number; total: number }>;
  getPlayerGameMode(player: string): Promise<number>;
  getPlayerInventory(
    player: string,
  ): Promise<Array<{ slot: number; id: string; count: number }>>;
  getPlayerSelectedItem(
    player: string,
  ): Promise<{ id: string; count: number } | null>;
  getPlayerAttributes(
    player: string,
  ): Promise<Array<{ name: string; base: number }>>;
  getPlayerRecipes(player: string): Promise<string[]>;
  getPlayerLastDeathLocation(
    player: string,
  ): Promise<{ x: number; y: number; z: number; dimension: string } | null>;
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface MarkerBase {
  label: string;
  position?: Vector3;
  maxDistance?: number;
  minDistance?: number;
}

interface MarkerSetOptions {
  label?: string;
  toggleable?: boolean;
  defaultHidden?: boolean;
  sorting?: number;
}

interface POIMarkerOptions extends MarkerBase {
  icon?: string;
}

interface HTMLMarkerOptions extends MarkerBase {
  html: string;
}

interface LineMarkerOptions extends MarkerBase {
  line: Vector3[];
  lineWidth?: number;
  lineColor?: Color;
}

interface ShapeMarkerOptions extends MarkerBase {
  shape: Vector3[];
  shapeY: number;
  lineWidth?: number;
  lineColor?: Color;
  fillColor?: Color;
}

interface ExtrudeMarkerOptions extends MarkerBase {
  shape: Vector3[];
  shapeMinY: number;
  shapeMaxY: number;
  lineWidth?: number;
  lineColor?: Color;
  fillColor?: Color;
}

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
  bluemap: {
    // Marker Set Management
    createMarkerSet(id: string, options?: MarkerSetOptions): Promise<unknown>;
    removeMarkerSet(id: string): Promise<unknown>;
    listMarkerSets(): Promise<unknown>;

    // Marker Management
    addMarker(
      markerSet: string,
      id: string,
      type: string,
      data: unknown,
    ): Promise<unknown>;
    removeMarker(markerSet: string, id: string): Promise<unknown>;

    // Helper Methods
    addPOI(
      set: string,
      id: string,
      options: POIMarkerOptions,
    ): Promise<unknown>;
    addHTML(
      set: string,
      id: string,
      options: HTMLMarkerOptions,
    ): Promise<unknown>;
    addLine(
      set: string,
      id: string,
      options: LineMarkerOptions,
    ): Promise<unknown>;
    addShape(
      set: string,
      id: string,
      options: ShapeMarkerOptions,
    ): Promise<unknown>;
    addExtrude(
      set: string,
      id: string,
      options: ExtrudeMarkerOptions,
    ): Promise<unknown>;
  };
  display: {
    executeCommand: (command: string) => Promise<unknown>;
    [key: string]: any;
  };
  auth: any;
  executeModuleScript: (
    moduleName: string,
    methodName: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  playerManager: PlayerManager;
  players: PlayerData[];
  isOnline: (playerName: string) => boolean;
  isOperator: (playerName: string) => boolean;
}

export interface PlayerData {
  name: string;
  id: string;
  role: "guest" | "player" | "operator";
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

export type {
  Api,
  AuthContext,
  EventData,
  LogFunction,
  MinecraftCommand,
  ScriptParams,
  SendToMinecraft,
};
