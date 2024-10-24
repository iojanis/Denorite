// deno-lint-ignore-file
import {walk} from "https://deno.land/std@0.177.0/fs/mod.ts";
import type {ScriptContext} from "../types.ts";
import {ConfigManager} from "./configManager.ts";
import {KvManager} from "./kvManager.ts";
import {Logger} from "./logger.ts";
import {AuthService} from "./authService.ts";
import {createMinecraftAPI} from "../api/minecraftAPI.ts";
import {getMetadata, listMetadata} from "../decorators.ts";
import {dirname, fromFileUrl, resolve} from "https://deno.land/std@0.177.0/path/mod.ts";
import {SocketManager} from "./socketManager.ts";

interface ModuleMetadata {
  name: string;
  version: string;
  servers: string | string[];
}

type ModuleInstance = {
  [key: string]: (...args: unknown[]) => Promise<unknown>;
};

interface DecoratedMethod {
  moduleName: string;
  methodName: string;
}

interface CommandMetadata {
  name: string;
  description: string;
  usage: string;
  permissions: string[];
  subcommands?: any[];
}

interface UnifiedContext extends ScriptContext {
  socket?: WebSocket;
  socketId?: string;
  sender?: string;
  senderType?: string;
  responseId?: string;
}
// Add this import at the top of your file
const isCompiled = Deno.args.includes("--compiled");

export class ScriptManager {
  private socketManager: SocketManager;
  private modules: Map<string, { instance: ModuleInstance; metadata: ModuleMetadata }> = new Map();
  private config: ConfigManager;
  public kv: KvManager;
  private logger: Logger;
  private auth: AuthService;
  private minecraftSockets: Set<WebSocket> = new Set();
  private playerSockets: Map<string, WebSocket> = new Map();
  private pendingResponses: Map<string, (value: unknown) => void> = new Map();

  private events: Map<string, DecoratedMethod[]> = new Map();
  private commands: Map<string, DecoratedMethod> = new Map();
  private sockets: Map<string, DecoratedMethod> = new Map();
  private registeredCommands: Map<string, any> = new Map();
  private commandsToRegister: Map<string, CommandMetadata> = new Map();

  private basePath: string;

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
    this.basePath = dirname(fromFileUrl(import.meta.url));
    this.socketManager = new SocketManager();
  }

  async init(): Promise<void> {
    this.logger.debug('ScriptManager initialized');

    if (isCompiled) this.logger.debug('IS COMPILED')
  }

  private async importModule(modulePath: string): Promise<any> {
    this.logger.debug(`Importing module from: ${modulePath}`);

    try {
      // Resolve the full path relative to the base path
      const fullPath = resolve(this.basePath, modulePath);
      const moduleUrl = `file://${fullPath}`;

      // Use dynamic import with the file URL
      return await import(moduleUrl);
    } catch (error: any) {
      this.logger.error(`Error importing module ${modulePath}: ${error.message}`);
      throw error;
    }
  }

  async loadModules(): Promise<void> {
    const enchantmentsDir = './enchantments';
    this.logger.info('Loading modules from ' + enchantmentsDir);
    for await (const entry of walk(enchantmentsDir, { maxDepth: 1, includeDirs: false })) {
      if (entry.name.endsWith('.ts')) {
        await this.loadModule(entry.path);
      }
    }
  }

  private async loadModule(modulePath: string): Promise<void> {
    this.logger.debug(`Attempting to load module from path: ${modulePath}`);
    try {
      this.logger.debug(`Importing module from: file://${Deno.cwd()}/${modulePath}`);
      const module = !isCompiled ? await import(`file://${Deno.cwd()}/${modulePath}`) : await this.importModule(modulePath);

      this.logger.debug(`Module imported successfully. Examining exported items...`);

      for (const [exportName, exportedItem] of Object.entries(module)) {
        this.logger.debug(`Examining exported item: ${exportName}`);

        if (typeof exportedItem === 'function' && exportedItem.prototype && exportedItem.prototype.constructor.name !== 'Object') {
          this.logger.debug(`${exportName} appears to be a class. Checking for module metadata...`);

          const moduleMetadata = getMetadata(exportedItem, 'module') as ModuleMetadata;
          this.logger.debug(`Module metadata for ${exportName}:`, moduleMetadata);

          if (moduleMetadata && moduleMetadata.name && moduleMetadata.version) {
            this.logger.debug(`Found valid module metadata for ${exportName}. Instantiating...`);
            const instance = new (exportedItem as new () => ModuleInstance)();
            this.modules.set(moduleMetadata.name, { instance, metadata: moduleMetadata });
            this.logger.info(`Loaded module: ${moduleMetadata.name} v${moduleMetadata.version}`);

            const allMetadata = listMetadata(exportedItem);
            this.logger.debug(`All metadata for ${exportName}:`, allMetadata);

            // Command structure to build
            const commandStructure: { [key: string]: any } = {};

            for (const [key, value] of Object.entries(allMetadata)) {
              if (key.startsWith('event:')) {
                const eventName = (value as { name: string }).name;
                this.logger.debug(`Found Event handler: ${eventName}`);
                this.addDecoratedMethod(this.events, eventName, moduleMetadata.name, key.split(':')[1]);
              } else if (key.startsWith('command:')) {
                const methodName = key.split(':')[1];
                const commandConfig = value as { path: string[] };
                const commandPath = commandConfig.path;

                let currentLevel = commandStructure;
                for (let i = 0; i < commandPath.length; i++) {
                  const pathPart = commandPath[i];
                  if (i === commandPath.length - 1) {
                    // This is the final part of the path, so it's our actual command/subcommand
                    const argumentMetadata = allMetadata[`arguments:${methodName}`] || [];
                    const descriptionMetadata = allMetadata[`description:${methodName}`];
                    const permissionMetadata = allMetadata[`permission:${methodName}`];

                    currentLevel[pathPart] = {
                      name: pathPart,
                      description: descriptionMetadata || 'No description provided',
                      arguments: argumentMetadata,
                      permission: permissionMetadata || 'player'
                    };

                    // Store the command with its full path
                    const fullCommandPath = commandPath.join(' ');
                    this.commands.set(fullCommandPath, { moduleName: moduleMetadata.name, methodName });
                    this.logger.debug(`Registered command: ${fullCommandPath} -> ${moduleMetadata.name}.${methodName}`);
                  } else {
                    // This is a parent command, ensure it exists
                    currentLevel[pathPart] = currentLevel[pathPart] || { subcommands: {} };
                    currentLevel = currentLevel[pathPart].subcommands;
                  }
                }
              } else if (key.startsWith('socket:')) {
                const socketEventName = (value as { name: string }).name;
                this.logger.debug(`Found Socket handler: ${socketEventName}`);
                this.sockets.set(socketEventName, { moduleName: moduleMetadata.name, methodName: key.split(':')[1] });
              }
            }

            // After processing all commands, register them
            for (const [commandName, commandData] of Object.entries(commandStructure)) {
              const registrationData = this.buildCommandRegistrationData(commandName, commandData);
              this.logger.debug(`Registering command: ${JSON.stringify(registrationData, null, 2)}`);

              // Store the command in the commandsToRegister Map
              this.commandsToRegister.set(commandName, registrationData);
            }
          } else {
            this.logger.debug(`No valid module metadata found for ${exportName}. Skipping...`);
          }
        } else {
          this.logger.debug(`${exportName} is not a class. Skipping...`);
        }
      }

      this.logger.debug(`Finished processing all exported items from ${modulePath}`);
    } catch (error) {
      this.logger.error(`Error loading module ${modulePath}: ${(error as Error).message}`);
      this.logger.debug(`Stack trace:`, (error as Error).stack);
    }
  }

  private buildCommandRegistrationData(commandName: string, commandData: any): any {
    const result: any = {
      name: commandName,
      description: commandData.description || "No description provided",
      permission: commandData.permission || "player",
    };

    if (commandData.arguments && commandData.arguments.length > 0) {
      result.arguments = commandData.arguments.map((arg: any) => ({
        name: arg.name,
        type: arg.type,
        description: arg.description
      }));
    }

    if (commandData.subcommands && Object.keys(commandData.subcommands).length > 0) {
      result.subcommands = Object.entries(commandData.subcommands).map(([subName, subData]: [string, any]) =>
        this.buildCommandRegistrationData(subName, subData)
      );
    }

    return result;
  }

  private addDecoratedMethod(map: Map<string, DecoratedMethod[]>, key: string, moduleName: string, methodName: string): void {
    const methods = map.get(key) || [];
    methods.push({ moduleName, methodName });
    map.set(key, methods);
  }

  async handleCommand(command: string, subcommand: string | undefined, args: unknown, sender: string, senderType: string): Promise<void> {
    this.logger.debug(`Received command execution: command=${command}, subcommand=${subcommand}, args=${JSON.stringify(args)}`);

    let fullCommandPath = command;
    if (subcommand) {
      fullCommandPath += ` ${subcommand}`;
    }

    this.logger.debug(`Attempting to handle command: ${fullCommandPath}`);
    this.logger.debug("Current registered commands:");
    for (const [commandPath, commandInfo] of this.commands.entries()) {
      this.logger.debug(`  ${commandPath} -> ${commandInfo.moduleName}.${commandInfo.methodName}`);
    }

    const decoratedMethod = this.commands.get(fullCommandPath);
    if (decoratedMethod) {
      const { moduleName, methodName } = decoratedMethod;
      this.logger.debug(`Found command handler: ${moduleName}.${methodName}`);
      const moduleData = this.modules.get(moduleName);
      if (moduleData) {
        const { instance: moduleInstance } = moduleData;
        const commandMethod = moduleInstance[methodName] as (...args: unknown[]) => Promise<unknown>;
        if (commandMethod) {
          const context: ScriptContext = this.createContext({ command, subcommand, args, sender, senderType });
          this.logger.debug(`Executing command method: ${moduleName}.${methodName}`);
          try {
            await commandMethod.call(moduleInstance, context);
          } catch (error) {
            this.logger.error(`Error executing command ${fullCommandPath}: ${error}`);
          }
          return;
        } else {
          this.logger.warn(`Command method not found in module instance: ${moduleName}.${methodName}`);
        }
      } else {
        this.logger.warn(`Module not found: ${moduleName}`);
      }
    } else {
      this.logger.warn(`Command not found: ${fullCommandPath}`);
    }
  }

  async handleEvent(eventType: string, data: unknown): Promise<void> {
    this.logger.debug(`Handling event: ${eventType} with data: ${JSON.stringify(data)}`);
    const decoratedMethods = this.events.get(eventType) || [];
    for (const { moduleName, methodName } of decoratedMethods) {
      const moduleData = this.modules.get(moduleName);
      if (moduleData) {
        const { instance: moduleInstance } = moduleData;
        const eventMethod = moduleInstance[methodName] as (...args: unknown[]) => Promise<unknown>;
        if (eventMethod) {
          this.logger.debug(`Found handler for event: ${eventType} in module: ${moduleName}`);
          const context: ScriptContext = this.createContext({
            event: eventType,
            ...data as Record<string, unknown>  // Spread the data object into the params
          });
          await eventMethod.call(moduleInstance, context);
        } else {
          this.logger.debug(`No handler found for event: ${eventType} in module: ${moduleName}`);
        }
      }
    }
  }

  async handleSocket(socketType: string, sender: string | null, socket: WebSocket, data: unknown): Promise<void> {
    const decoratedMethod = this.sockets.get(socketType);
    if (decoratedMethod) {
      const { moduleName, methodName } = decoratedMethod;
      const moduleData = this.modules.get(moduleName);
      if (moduleData) {
        const { instance: moduleInstance } = moduleData;
        const socketMethod = moduleInstance[methodName] as (...args: unknown[]) => Promise<unknown>;
        if (socketMethod) {
          const context: ScriptContext = this.createContext({ socketType, sender, socket, ...data as Record<string, unknown>  });
          await socketMethod.call(moduleInstance, context);
          return;
        }
      }
    }
    this.logger.warn(`Socket handler not found: ${socketType}`);
  }

  private async createUnifiedContext(params: Record<string, unknown>): Promise<UnifiedContext> {
    const serverInfo = await this.config.get('SERVER_INFO') as {
      name: string;
      description: string;
      url: string;
      version: string;
    };

    const minecraftAPI = createMinecraftAPI(this.sendToMinecraft.bind(this), this.logger.info.bind(this.logger));

    return {
      params,
      kv: this.kv.kv as Deno.Kv,
      sendToMinecraft: this.sendToMinecraft.bind(this),
      sendToPlayer: this.sendToPlayer.bind(this),
      log: this.logger.debug.bind(this.logger),
      api: {
        ...minecraftAPI,
        executeCommand: async (command: string) => {
          return await this.executeCommand(command)
        }
      },
      auth: this.auth,
      config: this.config,
      executeModuleScript: this.executeModuleScript.bind(this),
      socket: params.socket as WebSocket,
      socketId: params.socketId as string,
      sender: params.sender as string,
      senderType: params.senderType as string,
      responseId: params.responseId as string
    };
  }

  private createContext(params: Record<string, unknown>): ScriptContext {
    const minecraftAPI = createMinecraftAPI(this.sendToMinecraft.bind(this), this.logger.info.bind(this.logger));
    return {
      params,
      kv: this.kv.kv as Deno.Kv,
      sendToMinecraft: this.sendToMinecraft.bind(this),
      sendToPlayer: this.sendToPlayer.bind(this),
      log: this.logger.debug.bind(this.logger),
      api: {
        ...minecraftAPI,
        executeCommand: async (command: string) => {
          return await this.executeCommand(command)
        }
      },
      auth: this.auth,
      config: this.config,
      executeModuleScript: this.executeModuleScript.bind(this),
    };
  }

  async executeModuleScript(moduleName: string, methodName: string, params: Record<string, unknown>): Promise<unknown> {
    const moduleData = this.modules.get(moduleName);
    if (!moduleData) {
      throw new Error(`Module ${moduleName} not found`);
    }
    const { instance: moduleInstance } = moduleData;
    const method = moduleInstance[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Method ${methodName} not found in module ${moduleName}`);
    }
    const context = this.createContext(params);
    return await method.call(moduleInstance, context);
  }

  addMinecraftSocket(socket: WebSocket): void {
    this.minecraftSockets.add(socket);

    if (socket.readyState === WebSocket.OPEN) {
      this.registerAllCommands().catch(error => {
        this.logger.error(`Error registering commands after connection: ${error.message}`);
      });
    } else {
      socket.addEventListener('open', () => {
        this.registerAllCommands().catch(error => {
          this.logger.error(`Error registering commands after connection: ${error.message}`);
        });
      });
    }
  }

  removeMinecraftSocket(socket: WebSocket): void {
    this.minecraftSockets.delete(socket);
  }

  addPlayerSocket(playerId: string, socket: WebSocket): void {
    this.playerSockets.set(playerId, socket);
  }

  removePlayerSocket(playerId: string): void {
    this.playerSockets.delete(playerId);
  }

  private async sendToMinecraft(data: unknown): Promise<unknown> {
    const COMMAND_TIMEOUT = await this.config.get('COMMAND_TIMEOUT') as number;

    return new Promise((resolve, reject) => {
      const openSockets = Array.from(this.minecraftSockets).filter(socket => socket.readyState === WebSocket.OPEN);
      if (openSockets.length === 0) {
        reject(new Error('No open Minecraft WebSocket connections available'));
        return;
      }

      const messageId = Date.now().toString();
      const message = {
        id: messageId,
        ...(data as Record<string, unknown>)
      };

      this.pendingResponses.set(messageId, resolve);

      for (const socket of openSockets) {
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

  private sendToPlayer(playerId: string, data: unknown): void {
    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.send(JSON.stringify(data));
    } else {
      this.logger.error(`No socket found for player ${playerId}`);
    }
  }

  hasPendingResponse(id: string): boolean {
    return this.pendingResponses.has(id);
  }

  resolvePendingResponse(id: string, data: unknown): void {
    const resolver = this.pendingResponses.get(id);
    if (resolver) {
      resolver(data);
      this.pendingResponses.delete(id);
    }
  }

  async handleMessage(data: Record<string, unknown>, _type: 'minecraft' | 'fresh'): Promise<Record<string, unknown>> {
    switch (data.type) {
      case 'custom_command_executed':
        await this.handleCommand(
          data.command as string,
          data.subcommand as string,
          data.arguments,
          data.sender as string,
          data.senderType as string
        );
        return {};
      case 'command':
        return { result: await this.executeCommand(data.data as string) };
      case 'register_command':
        return { result: await this.registerCommand(data.data as any) };
      default:
        this.logger.warn(`Unknown message type: ${data.type}`);
        return { error: `Unknown message type: ${data.type}` };
    }
  }

  private async executeCommand(command: string): Promise<string> {
    try {
      const response = await this.sendToMinecraft({
        type: "command",
        data: command
      });
      return (response as { result: string }).result || JSON.stringify(response);
    } catch (error) {
      this.logger.error(`Error executing command: ${(error as Error).message}`);
      throw error; // Re-throw the error to be handled by the caller
    }
  }

  public async registerAllCommands(): Promise<void> {
    this.logger.info(`Registering ${this.commandsToRegister.size} commands...`);
    for (const [commandName, commandMetadata] of this.commandsToRegister) {
      await this.registerCommand(commandMetadata);
    }
    this.logger.info('All commands registered successfully.');
    // Clear the commandsToRegister map after registration
    this.commandsToRegister.clear();

    this.logger.debug("Registered commands:");
    for (const [commandPath, commandInfo] of this.commands.entries()) {
      this.logger.debug(`  ${commandPath} -> ${commandInfo.moduleName}.${commandInfo.methodName}`);
    }
  }

  private async registerCommand(commandMetadata: CommandMetadata): Promise<void> {
    try {
      // Check if there's at least one open WebSocket connection
      const openSocket = Array.from(this.minecraftSockets).find(socket => socket.readyState === WebSocket.OPEN);
      if (!openSocket) {
        throw new Error('No open WebSocket connections available');
      }

      await this.sendToMinecraft({
        type: "register_command",
        data: commandMetadata
      });

      // Store the registered command
      this.registeredCommands.set(commandMetadata.name, commandMetadata);

      this.logger.info(`Command "${commandMetadata.name}" registered successfully`);
    } catch (error) {
      this.logger.error(`Error registering command "${commandMetadata.name}": ${(error as Error).message}`);
    }
  }

  getCommandsByPermission(permission: string): CommandMetadata[] {
    const commands: CommandMetadata[] = [];

    // Helper function to recursively process commands and their subcommands
    const processCommand = (command: CommandMetadata) => {
      // Check if the command has the specified permission
      if (command.permission.includes(permission)) {
        commands.push(command);
      }

      // Process subcommands if they exist
      if (command.subcommands && command.subcommands.length > 0) {
        command.subcommands.forEach(subcommand => processCommand(subcommand));
      }
    };

    // Process all registered commands
    for (const commandMetadata of this.registeredCommands.values()) {
      processCommand(commandMetadata);
    }

    return commands;
  }
}
