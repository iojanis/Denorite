// core/scriptManager.ts

import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.177.0/path/mod.ts";
import type { ScriptContext, WatcherScriptContext } from "./types.ts";
import { ConfigManager } from "./configManager.ts";
import { KvManager } from "./kvManager.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./authService.ts";
import { createMinecraftAPI } from "../api/minecraftAPI.ts";

interface ModuleConfig {
  name: string;
  version: string;
  commands: CommandConfig[];
  events: EventConfig[];
  sockets: SocketConfig[];
  watchers: WatcherConfig[];
  lib: string[];
}

interface CommandConfig {
  name: string;
  script: string;
  permissions: string[];
  args: CommandArgConfig[];
}

interface CommandArgConfig {
  name: string;
  type: string;
  description: string;
}

interface EventConfig {
  name: string;
  script: string;
}

interface SocketConfig {
  name: string;
  script: string;
  permissions: string[];
}

interface WatcherConfig {
  name: string;
  script: string;
  keys: Deno.KvKey[];
}

export class ScriptManager {
  private modules: Map<string, ModuleConfig> = new Map();
  private scriptCache: Map<string, any> = new Map();
  private config: ConfigManager;
  private kv: KvManager;
  private logger: Logger;
  private auth: AuthService;
  private minecraftSockets: Set<WebSocket> = new Set();
  private playerSockets: Map<string, WebSocket> = new Map();
  private pendingResponses: Map<string, (value: any) => void> = new Map();
  private registeredCommands: Map<string, any> = new Map();

  constructor(
    config: ConfigManager,
    kv: KvManager,
    logger: Logger,
    auth: AuthService
  ) {
    this.config = config;
    this.kv = kv;
    this.logger = logger;
    this.auth = auth;
  }

  async loadModules() {
    const modulesDir = './modules';
    for await (const entry of walk(modulesDir, { maxDepth: 1, includeDirs: false })) {
      if (entry.name === "module.json") {
        const moduleDir = entry.path.replace("/module.json", "");
        const moduleName = moduleDir.split("/").pop() as string;
        await this.loadModule(moduleName, moduleDir);
      }
    }
  }

  private async loadModule(moduleName: string, moduleDir: string) {
    const configPath = join(moduleDir, "module.json");
    const configContent = await Deno.readTextFile(configPath);
    const moduleConfig: ModuleConfig = JSON.parse(configContent);

    this.modules.set(moduleName, moduleConfig);
    this.logger.info(`Loaded module: ${moduleName}`);

    // Load and cache lib scripts
    for (const libScript of moduleConfig.lib) {
      const scriptPath = join(moduleDir, libScript);
      await this.loadScript(moduleName, scriptPath);
    }

    // Set up KV watchers
    for (const watcher of moduleConfig.watchers) {
      const watcherPath = join(moduleDir, watcher.script);
      await this.setupKvWatcher(moduleName, watcherPath, watcher.keys);
    }

    // Register commands
    for (const command of moduleConfig.commands) {
      await this.registerCommand(command);
    }
  }

  private async loadScript(moduleName: string, scriptPath: string) {
    const module = await import(`file://${scriptPath}`);
    this.scriptCache.set(`${moduleName}:${scriptPath}`, module.default);
  }

  private async setupKvWatcher(moduleName: string, scriptPath: string, keys: Deno.KvKey[]) {
    const watcherFunc = await this.loadScript(moduleName, scriptPath);
    for (const key of keys) {
      this.kv.watch(key, async (changedKey: Deno.KvKey, newValue: unknown) => {
        const context: WatcherScriptContext = {
          changedKey,
          newValue,
          kv: this.kv,
          log: this.logger.info.bind(this.logger),
          api: createMinecraftAPI(this.sendToMinecraft.bind(this), this.logger.info.bind(this.logger)),
          auth: this.auth,
          config: this.config,
          executeModuleScript: this.executeModuleScript.bind(this),
        };
        await watcherFunc(context);
      });
    }
  }

  async executeModuleScript(moduleName: string, scriptPath: string, params: any): Promise<any> {
    const cacheKey = `${moduleName}:${scriptPath}`;
    let scriptFunc = this.scriptCache.get(cacheKey);

    if (!scriptFunc) {
      const module = await import(`file://${scriptPath}`);
      scriptFunc = module.default;
      this.scriptCache.set(cacheKey, scriptFunc);
    }

    const context: ScriptContext = {
      params,
      kv: this.kv,
      sendToMinecraft: this.sendToMinecraft.bind(this),
      sendToPlayer: this.sendToPlayer.bind(this),
      log: this.logger.info.bind(this.logger),
      api: createMinecraftAPI(this.sendToMinecraft.bind(this), this.logger.info.bind(this.logger)),
      auth: this.auth,
      config: this.config,
      executeModuleScript: this.executeModuleScript.bind(this),
    };

    return await scriptFunc(context);
  }

  async handleCommand(command: string, subcommand: string, args: any, sender: string, senderType: string) {
    for (const [moduleName, moduleConfig] of this.modules.entries()) {
      const commandConfig = moduleConfig.commands.find(c => c.name === command);
      if (commandConfig) {
        const scriptPath = join(await this.config.get("MODULES_DIR") as string, moduleName, commandConfig.script);
        await this.executeModuleScript(moduleName, scriptPath, { command, subcommand, args, sender, senderType });
        return;
      }
    }
    this.logger.warn(`Command not found: ${command}`);
  }

  async handleEvent(eventType: string, data: any) {
    for (const [moduleName, moduleConfig] of this.modules.entries()) {
      const eventConfig = moduleConfig.events.find(e => e.name === eventType);
      if (eventConfig) {
        const scriptPath = join(await this.config.get("MODULES_DIR") as string, moduleName, eventConfig.script);
        await this.executeModuleScript(moduleName, scriptPath, { event: eventType, data });
      }
    }
  }

  async handleSocket(socketType: string, playerId: string, eventData: any) {
    for (const [moduleName, moduleConfig] of this.modules.entries()) {
      const socketConfig = moduleConfig.sockets.find(s => s.name === socketType);
      if (socketConfig) {
        const scriptPath = join(await this.config.get("MODULES_DIR") as string, moduleName, socketConfig.script);
        await this.executeModuleScript(moduleName, scriptPath, { socketType, playerId, eventData });
        return;
      }
    }
    this.logger.warn(`Socket handler not found: ${socketType}`);
  }

  addMinecraftSocket(socket: WebSocket) {
    this.minecraftSockets.add(socket);
  }

  removeMinecraftSocket(socket: WebSocket) {
    this.minecraftSockets.delete(socket);
  }

  addPlayerSocket(playerId: string, socket: WebSocket) {
    this.playerSockets.set(playerId, socket);
  }

  removePlayerSocket(playerId: string) {
    this.playerSockets.delete(playerId);
  }

  private async sendToMinecraft(data: any): Promise<any> {
    const COMMAND_TIMEOUT = await this.config.get('COMMAND_TIMEOUT') as number;

    return new Promise((resolve, reject) => {
      if (this.minecraftSockets.size === 0) {
        reject(new Error('No Minecraft WebSocket connections available'));
        return;
      }

      const messageId = Date.now().toString();
      const message = {
        id: messageId,
        ...data
      };

      this.pendingResponses.set(messageId, resolve);

      for (const socket of this.minecraftSockets) {
        socket.send(JSON.stringify(message));
      }

      setTimeout(() => {
        if (this.pendingResponses.has(messageId)) {
          this.pendingResponses.delete(messageId);
          reject(new Error(`Command timed out: ${JSON.stringify(message)}`));
        }
      }, COMMAND_TIMEOUT);
    });
  }

  private sendToPlayer(playerId: string, data: any) {
    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.send(JSON.stringify(data));
    } else {
      this.logger.error(`No socket found for player ${playerId}`);
    }
  }

  async registerCommand(commandData: any) {
    this.registeredCommands.set(commandData.name, commandData);
    await this.sendToMinecraft({
      type: "register_command",
      data: commandData
    });
  }

  async loadCommands() {
    for (const moduleConfig of this.modules.values()) {
      for (const command of moduleConfig.commands) {
        await this.registerCommand(command);
      }
    }
  }

  hasPendingResponse(id: string): boolean {
    return this.pendingResponses.has(id);
  }

  resolvePendingResponse(id: string, data: any) {
    const resolver = this.pendingResponses.get(id);
    if (resolver) {
      resolver(data);
      this.pendingResponses.delete(id);
    }
  }

  async handleMessage(data: any, type: 'minecraft' | 'fresh') {
    switch (data.type) {
      case 'custom_command_executed':
        await this.handleCommand(data.command, data.subcommand, data.arguments, data.sender, data.senderType);
        break;
      case 'listScripts':
        return await this.listAllScripts();
      case 'getScriptContent':
        return { content: await this.getScriptContent(data.scriptType, data.scriptName) };
      case 'updateScript':
        await this.updateScript(data.scriptType, data.scriptName, data.scriptContent);
        return { success: true };
      case 'reloadAll':
        await this.reloadAll();
        return { success: true, message: "All scripts, events, and commands reloaded" };
      case 'command':
        return { result: await this.executeCommand(data.data) };
      case 'chat':
        return { result: await this.broadcastMessage(data.data) };
      case 'register_command':
        return { result: await this.registerCommand(data.data) };
      case 'unregister_command':
        return { result: await this.unregisterCommand(data.data) };
      case 'clear_commands':
        return { result: await this.clearCommands() };
      default:
        this.logger.warn(`Unknown message type: ${data.type}`);
        return { error: `Unknown message type: ${data.type}` };
    }
  }

  private async listAllScripts(): Promise<{ scripts: string[], events: string[], commands: string[] }> {
    const scripts: string[] = [];
    const events: string[] = [];
    const commands: string[] = [];

    for (const moduleConfig of this.modules.values()) {
      scripts.push(...moduleConfig.lib);
      events.push(...moduleConfig.events.map(e => e.script));
      commands.push(...moduleConfig.commands.map(c => c.script));
    }

    return { scripts, events, commands };
  }

  private async getScriptContent(type: 'script' | 'event' | 'command', name: string): Promise<string> {
    const modulesDir = await this.config.get("MODULES_DIR") as string;
    for (const [moduleName, moduleConfig] of this.modules.entries()) {
      let script;
      switch (type) {
        case 'script':
          script = moduleConfig.lib.find(s => s === name);
          break;
        case 'event':
          script = moduleConfig.events.find(e => e.script === name)?.script;
          break;
        case 'command':
          script = moduleConfig.commands.find(c => c.script === name)?.script;
          break;
      }
      if (script) {
        const scriptPath = join(modulesDir, moduleName, script);
        return await Deno.readTextFile(scriptPath);
      }
    }
    throw new Error(`Script not found: ${type} ${name}`);
  }

  private async updateScript(type: 'script' | 'event' | 'command', name: string, content: string): Promise<void> {
    const modulesDir = await this.config.get("MODULES_DIR") as string;
    for (const [moduleName, moduleConfig] of this.modules.entries()) {
      let script;
      switch (type) {
        case 'script':
          script = moduleConfig.lib.find(s => s === name);
          break;
        case 'event':
          script = moduleConfig.events.find(e => e.script === name)?.script;
          break;
        case 'command':
          script = moduleConfig.commands.find(c => c.script === name)?.script;
          break;
      }
      if (script) {
        const scriptPath = join(modulesDir, moduleName, script);
        await Deno.writeTextFile(scriptPath, content);
        // Invalidate cache
        this.scriptCache.delete(`${moduleName}:${scriptPath}`);
        return;
      }
    }
    throw new Error(`Script not found: ${type} ${name}`);
  }

  private async reloadAll(): Promise<void> {
    this.modules.clear();
    this.scriptCache.clear();
    this.registeredCommands.clear();
    await this.loadModules();
    await this.loadCommands();
  }

  private async executeCommand(command: string): Promise<string> {
    try {
      await this.sendToMinecraft({
        type: "execute_command",
        command: command
      });
      return `Command "${command}" executed successfully`;
    } catch (error) {
      this.logger.error(`Error executing command: ${error.message}`);
      return `Error executing command: ${error.message}`;
    }
  }

  private async broadcastMessage(message: string): Promise<string> {
    try {
      await this.sendToMinecraft({
        type: "broadcast_message",
        message: message
      });
      return `Message "${message}" broadcasted successfully`;
    } catch (error) {
      this.logger.error(`Error broadcasting message: ${error.message}`);
      return `Error broadcasting message: ${error.message}`;
    }
  }

  private async unregisterCommand(commandName: string): Promise<string> {
    if (this.registeredCommands.has(commandName)) {
      this.registeredCommands.delete(commandName);
      try {
        await this.sendToMinecraft({
          type: "unregister_command",
          data: { name: commandName }
        });
        return `Command "${commandName}" unregistered successfully`;
      } catch (error) {
        this.logger.error(`Error unregistering command: ${error.message}`);
        return `Error unregistering command: ${error.message}`;
      }
    } else {
      return `Command "${commandName}" not found`;
    }
  }

  private async clearCommands(): Promise<string> {
    this.registeredCommands.clear();
    try {
      await this.sendToMinecraft({
        type: "clear_commands"
      });
      return "All custom commands cleared";
    } catch (error) {
      this.logger.error(`Error clearing commands: ${error.message}`);
      return `Error clearing commands: ${error.message}`;
    }
  }

  async handleCommandExecution(command: string, subcommand: string, args: any, sender: string, senderType: string) {
    const commandScript = `${command}_${subcommand}.ts`;
    try {
      for (const [moduleName, moduleConfig] of this.modules.entries()) {
        const commandConfig = moduleConfig.commands.find(c => c.name === command);
        if (commandConfig) {
          const scriptPath = join(await this.config.get("MODULES_DIR") as string, moduleName, commandConfig.script);
          await this.executeModuleScript(moduleName, scriptPath, { command, subcommand, args, sender, senderType });
          return;
        }
      }
      this.logger.warn(`Command script not found: ${commandScript}`);
    } catch (error: any) {
      this.logger.error(`Error executing command script ${commandScript}: ${error.message}`);
    }
  }

  async listScripts(dir: string): Promise<string[]> {
    const scripts = [];
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        scripts.push(entry.name);
      }
    }
    return scripts;
  }

  async getScriptsForEvent(eventType: string, isPlayerEvent: boolean): Promise<string[]> {
    const scripts = [];
    for (const moduleConfig of this.modules.values()) {
      const eventScripts = moduleConfig.events
        .filter(e => e.name.startsWith(`${eventType}_`))
        .map(e => e.script);
      scripts.push(...eventScripts);
    }
    return scripts;
  }

  async getScript(name: string, isPlayerEvent: boolean): Promise<string> {
    for (const [moduleName, moduleConfig] of this.modules.entries()) {
      const script = moduleConfig.events.find(e => e.script === name) || moduleConfig.lib.find(s => s === name);
      if (script) {
        const scriptPath = join(await this.config.get("MODULES_DIR") as string, moduleName, script);
        return await Deno.readTextFile(scriptPath);
      }
    }
    throw new Error(`Script not found: ${name}`);
  }

  async handleMinecraftEvent(eventType: string, data: any) {
    this.logger.info(`Handling Minecraft event: ${eventType}`);
    const scripts = await this.getScriptsForEvent(eventType, false);
    for (const script of scripts) {
      try {
        await this.executeModuleScript(script.split('/')[0], script, { event: eventType, data });
      } catch (error: any) {
        this.logger.error(`Error executing Minecraft event script ${script}: ${error.message}`);
      }
    }

    switch (eventType) {
      case 'player_joined':
      case 'player_left':
        // Additional handling for player join/leave events if needed
        break;
      case 'custom_command_executed':
        await this.handleCommandExecution(data.command, data.subcommand, data.arguments, data.sender, data.senderType);
        break;
      // Add more specific event handling if needed
    }
  }
}
