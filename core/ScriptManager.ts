// deno-lint-ignore-file
import { ScriptInterpreter } from "./ScriptInterpreter.ts";
import type { ScriptContext } from "../types.ts";
import { ConfigManager } from "./ConfigManager.ts";
import { KvManager } from "./kvManager.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./AuthService.ts";
import { createMinecraftAPI } from "../api/minecraftAPI.ts";
import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import { dirname, fromFileUrl, resolve } from "https://deno.land/std@0.177.0/path/mod.ts";
import { RateLimiter } from "./RateLimiter.ts";
import {createDisplayAPI} from "../api/displayAPI.ts";
import { ModuleWatcher } from "./ModuleWatcher.ts";

interface CommandMetadata {
  name: string;
  description: string;
  usage: string;
  permissions: string[];
  subcommands?: any[];
}

export class ScriptManager {
  private interpreter: ScriptInterpreter;
  private config: ConfigManager;
  public kv: KvManager;
  private logger: Logger;
  private auth: AuthService;
  private minecraftSockets: Set<WebSocket> = new Set();
  private playerSockets: Map<string, WebSocket> = new Map();
  private runnerSockets: Map<string, WebSocket> = new Map();
  private pendingResponses: Map<string, (value: unknown) => void> = new Map();
  private commandsToRegister: Map<string, CommandMetadata> = new Map();
  private basePath: string;
  moduleWatcher: ModuleWatcher;

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

    this.moduleWatcher = new ModuleWatcher(
      this,
      this.logger,
      resolve(this.basePath, '../enchantments')
    );

    // Initialize the interpreter with our context factory
    this.interpreter = new ScriptInterpreter(
      this.logger,
      this.createContext.bind(this)
    );
  }

  async init(): Promise<void> {
    this.logger.debug('ScriptManager initialized');
    // await this.kv.set(['server', 'apps'], [])
    this.moduleWatcher.watch();
  }

  private async importModule(modulePath: string): Promise<any> {
    this.logger.debug(`Importing module from: ${modulePath}`);
    try {
      // Get absolute path and ensure proper URL format
      const absolutePath = resolve(this.basePath, modulePath);
      const moduleUrl = new URL(`file://${absolutePath}`).href;
      return await import(moduleUrl);
    } catch (error: any) {
      this.logger.error(`Error importing module ${modulePath}: ${error.message}`);
      throw error;
    }
  }

  async loadModules(): Promise<void> {
    const enchantmentsDir = resolve(this.basePath, '../enchantments');
    this.logger.info('Loading modules from ' + enchantmentsDir);

    for await (const entry of walk(enchantmentsDir, {
      maxDepth: 1,
      includeDirs: false,
      match: [/\.ts$/]
    })) {
      await this.loadModule(entry.path);
    }
  }

  public async loadModule(modulePath: string): Promise<void> {
    try {
      // If the path starts with /app, remove it to make it relative
      const cleanPath = modulePath.replace(/^\/app\//, '');

      // Get absolute path from the base directory
      const absolutePath = resolve(this.basePath, '..', cleanPath);

      // Create proper file URL with cache busting
      const moduleUrl = new URL(`file://${absolutePath}`);
      moduleUrl.searchParams.set('t', Date.now().toString());

      this.logger.debug(`Attempting to load module from: ${moduleUrl.href}`);

      const moduleImport = await import(moduleUrl.href);
      await this.interpreter.loadModule(cleanPath, moduleImport);

      this.logger.debug(`Successfully loaded module from: ${moduleUrl.href}`);
    } catch (error) {
      this.logger.error(`Error loading module ${modulePath}: ${error.message}`);
      throw error;
    }
  }

  async handleCommand(command: string, subcommand: string | undefined, args: unknown, sender: string, senderType: string): Promise<void> {
    try {
      await this.interpreter.executeCommand(command, subcommand, args, sender, senderType);
    } catch (error) {
      this.logger.error(`Error executing command: ${error.message}`);
    }
  }

  async handleEvent(eventType: string, data: unknown): Promise<void> {
    try {
      await this.interpreter.executeEvent(eventType, data);
    } catch (error) {
      this.logger.error(`Error handling event: ${error.message}`);
    }
  }

  async handleSocket(socketType: string, sender: string | null, socket: WebSocket, data: unknown, messageId: string | null = null): Promise<void> {
    try {
      const response = await this.interpreter.executeSocket(socketType, {
        ...data as object,
        socket,
        sender,
        socketId: socket.url // or another unique identifier
      });

      const responsePayload = {
        type: socketType,
        success: true,
        data: response,
        messageId,
        error: null
      };

      await socket.send(JSON.stringify(responsePayload));
    } catch (error) {
      const errorResponse = {
        type: socketType,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        messageId,
        data: null
      };

      await socket.send(JSON.stringify(errorResponse));
      this.logger.error(`Error handling socket message: ${error}`);
    }
  }

  private async messagePlayer(playerId: string, message: string, options: {
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
    sound?: string;
  } = {}): Promise<void> {
    // Default styling
    const {
      color = 'white',
      bold = false,
      italic = false,
      underlined = false,
      sound = 'entity.experience_orb.pickup'
    } = options;

    // Send socket message
    this.sendToPlayer(playerId, {
      type: 'chat_message',
      message,
      timestamp: Date.now(),
      metadata: {
        color,
        bold,
        italic,
        underlined
      }
    });

    // Send Minecraft tellraw
    const tellrawCommand = `tellraw ${playerId} {"text":"${message}","color":"${color}"${
      bold ? ',"bold":true' : ''
    }${italic ? ',"italic":true' : ''
    }${underlined ? ',"underlined":true' : ''
    }}`;

    // Play sound if specified
    if (sound) {
      await this.executeCommand(`execute at ${playerId} run playsound ${sound} master ${playerId} ~ ~ ~ 1 1`);
    }

    // Execute the tellraw command
    await this.executeCommand(tellrawCommand);
  }

  private createContext(params: Record<string, unknown>): ScriptContext {
    const minecraftAPI = createMinecraftAPI(
      this.sendToMinecraft.bind(this),
      this.logger.info.bind(this.logger)
    );

    const displayApi = createDisplayAPI(
      this.sendToMinecraft.bind(this),
      this.logger.info.bind(this.logger),
      this.kv.kv
    );

    return {
      params,
      kv: this.kv.kv as Deno.Kv,
      sendToMinecraft: this.sendToMinecraft.bind(this),
      sendToPlayer: this.sendToPlayer.bind(this),
      broadcastPlayers: this.broadcastPlayers.bind(this),
      messagePlayer: this.messagePlayer.bind(this),
      log: this.logger.debug.bind(this.logger),
      api: {
        ...minecraftAPI,
        executeCommand: async (command: string) => {
          return await this.executeCommand(command);
        },
      },
      display: {
        ...displayApi,
        executeCommand: async (command: string) => {
          return await this.executeCommand(command);
        },
      },
      auth: this.auth,
      executeModuleScript: this.executeModuleScript.bind(this),
    };
  }

  async executeModuleScript(moduleName: string, methodName: string, params: Record<string, unknown>): Promise<unknown> {
    return await this.interpreter.executeModuleScript(moduleName, methodName, params);
  }

  // WebSocket management methods
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

  addRunnerSocket(runnerId: string, socket: WebSocket): void {
    this.runnerSockets.set(runnerId, socket);
  }

  removeRunnerSocket(runnerId: string): void {
    this.runnerSockets.delete(runnerId);
  }

  private async sendToMinecraft(data: unknown): Promise<unknown> {
    const COMMAND_TIMEOUT = 5000;
    // const COMMAND_TIMEOUT = await this.config.get('COMMAND_TIMEOUT') as number;

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

  broadcastPlayers(data: unknown): void {
    this.playerSockets.forEach((socket, playerId) => {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        } else {
          this.playerSockets.delete(playerId);
          this.logger.warn(`Removed dead socket for player ${playerId}`);
        }
      } catch (error) {
        this.logger.error(`Failed to send message to player ${playerId}: ${error}`);
        this.playerSockets.delete(playerId);
      }
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

  // Response handling methods
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
        return { result: await this.registerCommand(data.data as CommandMetadata) };
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
      throw error;
    }
  }

  public async registerAllCommands(): Promise<void> {
    const commands = this.interpreter.getRegisteredCommands();

    // Group commands by their root command
    const rootCommands = new Map<string, CommandMetadata>();

    for (const command of commands) {
      const rootCommandName = command.path[0];

      if (command.path.length === 1) {
        // This is a root command
        rootCommands.set(rootCommandName, {
          name: rootCommandName,
          description: command.description,
          usage: command.usage,
          permissions: command.permissions,
          arguments: command.arguments,
          subcommands: []
        });
      } else {
        // This is a subcommand
        let rootCommand = rootCommands.get(rootCommandName);
        if (!rootCommand) {
          // Create root command if it doesn't exist
          rootCommand = {
            name: rootCommandName,
            description: "Root command",
            usage: "",
            permissions: ["player"],
            subcommands: []
          };
          rootCommands.set(rootCommandName, rootCommand);
        }

        // Add this as a subcommand
        const subcommand = {
          name: command.path[command.path.length - 1],
          description: command.description,
          usage: command.usage,
          permissions: command.permissions,
          arguments: command.arguments
        };

        rootCommand.subcommands = rootCommand.subcommands || [];
        rootCommand.subcommands.push(subcommand);
      }
    }

    this.logger.info(`Registering ${rootCommands.size} root commands...`);

    // Register each root command with its subcommands
    for (const rootCommand of rootCommands.values()) {
      await this.registerCommand(rootCommand);
    }

    this.logger.info('All commands registered successfully.');
  }

  private async registerCommand(commandData: CommandMetadata): Promise<void> {
    try {
      const openSocket = Array.from(this.minecraftSockets)
        .find(socket => socket.readyState === WebSocket.OPEN);

      if (!openSocket) {
        throw new Error('No open WebSocket connections available');
      }

      // Create the command registration payload
      const registrationData = {
        name: commandData.name,
        description: commandData.description,
        usage: commandData.usage,
        permissions: commandData.permissions,
        arguments: commandData.arguments,
        subcommands: commandData.subcommands || []
      };

      await this.sendToMinecraft({
        type: "register_command",
        data: registrationData
      });

      this.logger.info(`Command "${commandData.name}" registered successfully`);
    } catch (error) {
      this.logger.error(`Error registering command "${commandData.name}": ${(error as Error).message}`);
    }
  }

  getCommandsByPermission(permission: string): CommandMetadata[] {
    return this.interpreter.getCommandsByPermission(permission);
  }
}
