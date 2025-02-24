// deno-lint-ignore-file
import { ScriptInterpreter } from "./ScriptInterpreter.ts";
import type { ScriptContext } from "../types.ts";
import { ConfigManager } from "./ConfigManager.ts";
import { KvManager } from "./kvManager.ts";
import { Logger } from "./logger.ts";
import { AuthService } from "./AuthService.ts";
import { createMinecraftAPI } from "../api/minecraftAPI.ts";
import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import {
  dirname,
  fromFileUrl,
  resolve,
} from "https://deno.land/std@0.177.0/path/mod.ts";
import { RateLimiter } from "./RateLimiter.ts";
import { createDisplayAPI } from "../api/displayAPI.ts";
import { ModuleWatcher } from "./ModuleWatcher.ts";
import { PlayerManager } from "./PlayerManager.ts";
import { RconManager } from "./RconManager.ts";
import { RconClient } from "./RconClient.ts";
import { WebSocketCommandHandler } from "./WebSocketCommandHandler.ts";
import { createBlueMapAPI } from "../api/bluemapAPI.ts";
import { CronManager } from "./CronManager.ts";
import { createFilesAPI } from "../api/filesAPI.ts";

interface CommandMetadata {
  name: string;
  description: string;
  usage: string;
  permissions: string[];
  subcommands?: any[];
}

interface TellrawComponent {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  insertion?: string;
  clickEvent?: {
    action:
      | "open_url"
      | "run_command"
      | "suggest_command"
      | "change_page"
      | "copy_to_clipboard";
    value: string;
  };
  hoverEvent?: {
    action: "show_text" | "show_item" | "show_entity";
    contents: string | object;
  };
  extra?: TellrawComponent[];
}

function extractTextFromComponent(component: TellrawComponent): string {
  let text = component.text || "";

  if (component.extra) {
    text += component.extra.map(extractTextFromComponent).join("");
  }

  return text;
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
  public playerManager: PlayerManager;
  private rconManager: RconManager;
  private basePath: string;
  private cronManager: CronManager;
  moduleWatcher: ModuleWatcher;

  private wsCommandHandler: WebSocketCommandHandler;

  constructor(
    config: ConfigManager,
    kv: KvManager,
    logger: Logger,
    auth: AuthService,
    rateLimiter: RateLimiter,
  ) {
    this.config = config;
    this.kv = kv;
    this.logger = logger;
    this.auth = auth;
    this.basePath = dirname(fromFileUrl(import.meta.url));
    this.playerManager = new PlayerManager(logger, kv);

    this.moduleWatcher = new ModuleWatcher(
      this,
      this.logger,
      resolve(this.basePath, "../modules"),
    );

    this.wsCommandHandler = new WebSocketCommandHandler(
      this.logger,
      5000,
    );

    // Initialize the interpreter with our context factory
    this.interpreter = new ScriptInterpreter(
      this.logger,
      this.createContext.bind(this),
      this.kv.kv,
      rateLimiter,
    );

    this.rconManager = new RconManager(
      this.logger,
      this.auth,
      Deno.env.get("RCON_HOST"),
      25575,
    );
  }

  async init(): Promise<void> {
    this.logger.debug("ScriptManager initialized");
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
      this.logger.error(
        `Error importing module ${modulePath}: ${error.message}`,
      );
      throw error;
    }
  }

  async loadModules(): Promise<void> {
    const modulesDir = resolve(this.basePath, "../modules");
    this.logger.info("Loading modules from " + modulesDir);

    // Remove maxDepth to allow recursive directory traversal
    for await (
      const entry of walk(modulesDir, {
        includeDirs: false,
        match: [/\.ts$/],
        skip: [/node_modules/, /\.git/], // Skip certain directories
      })
    ) {
      await this.loadModule(entry.path);
    }
  }

  // In ScriptManager.ts, modify the loadModule method:

  public async loadModule(modulePath: string): Promise<void> {
    try {
      // If the path starts with /app, remove it to make it relative
      const cleanPath = modulePath.replace(/^\/app\//, "");

      // Get absolute path from the base directory
      const absolutePath = resolve(this.basePath, "..", cleanPath);

      // Check if the file exists before attempting to import
      try {
        await Deno.stat(absolutePath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          // File doesn't exist - extract module name and unload it
          const modulesDir = resolve(this.basePath, "../modules");
          const relativePath = absolutePath.replace(modulesDir + "/", "");
          const moduleName = relativePath.replace(/\.ts$/, "").replace(
            /\//g,
            ":",
          );

          this.logger.info(
            `Module file ${modulePath} no longer exists, unloading module ${moduleName}`,
          );
          await this.interpreter.unloadModule(moduleName);
          return;
        }
        throw error;
      }

      // Get relative path from modules directory for module naming
      const modulesDir = resolve(this.basePath, "../modules");
      const relativePath = absolutePath.replace(modulesDir + "/", "");

      // Create proper file URL with cache busting
      const moduleUrl = new URL(`file://${absolutePath}`);
      moduleUrl.searchParams.set("t", Date.now().toString());

      // this.logger.debug(`Attempting to load module from: ${moduleUrl.href}`);

      const moduleImport = await import(moduleUrl.href);

      // Pass the relative path to help with nested module naming
      await this.interpreter.loadModule(relativePath, moduleImport);

      // this.logger.debug(`Successfully loaded module from: ${moduleUrl.href}`);
    } catch (error) {
      this.logger.error(`Error loading module ${modulePath}: ${error.message}`);
      throw error;
    }
  }

  async handleCommand(
    command: string,
    subcommand: string | undefined,
    args: unknown,
    sender: string,
    senderType: string,
  ): Promise<unknown> {
    try {
      return await this.interpreter.executeCommand(
        command,
        subcommand,
        args,
        sender,
        senderType,
      );
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

  async handleSocket(
    socketType: string,
    sender: string | null,
    socket: WebSocket,
    data: unknown,
    messageId: string | null = null,
  ): Promise<void> {
    try {
      const response = await this.interpreter.executeSocket(socketType, {
        ...data as object,
        socket,
        sender,
        socketId: socket.url, // or another unique identifier
      });

      const responsePayload = {
        type: socketType,
        success: true,
        data: response,
        messageId,
        error: null,
      };

      await socket.send(JSON.stringify(responsePayload));
    } catch (error) {
      const errorResponse = {
        type: socketType,
        success: false,
        error: error instanceof Error
          ? error.message
          : "Unknown error occurred",
        messageId,
        data: null,
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
      color = "white",
      bold = false,
      italic = false,
      underlined = false,
      sound = "entity.experience_orb.pickup",
    } = options;

    // Send socket message
    this.sendToPlayer(playerId, {
      type: "chat_message",
      message,
      timestamp: Date.now(),
      metadata: {
        color,
        bold,
        italic,
        underlined,
      },
    });

    // Send Minecraft tellraw
    const tellrawCommand =
      `tellraw ${playerId} {"text":"${message}","color":"${color}"${
        bold ? ',"bold":true' : ""
      }${italic ? ',"italic":true' : ""}${
        underlined ? ',"underlined":true' : ""
      }}`;

    // Play sound if specified
    if (sound) {
      await this.executeCommand(
        `execute at ${playerId} run playsound ${sound} master ${playerId} ~ ~ ~ 1 1`,
      );
    }

    // Execute the tellraw command
    await this.executeCommand(tellrawCommand);
  }

  setPlayerManager(playerManager: PlayerManager): void {
    this.playerManager = playerManager;
  }

  private createContext(
    params: Record<string, unknown>,
    socket?: WebSocket,
  ): ScriptContext {
    const minecraftAPI = createMinecraftAPI(
      this.sendToMinecraft.bind(this),
      this.logger.info.bind(this.logger),
    );

    const contextComponents: TellrawComponent[] = [];

    const displayApi = createDisplayAPI(
      this.sendToMinecraft.bind(this),
      this.logger.info.bind(this.logger),
      this.kv.kv,
    );

    const filesAPI = createFilesAPI(
      this.sendToMinecraft.bind(this),
      this.logger.info.bind(this.logger),
    );

    const bluemapAPI = createBlueMapAPI(
      this.sendToMinecraft.bind(this),
      this.logger.info.bind(this.logger),
    );

    // Get RCON client if available for this socket
    let rconClient: RconClient | undefined;
    try {
      const socketId = "0";
      const connection = this.rconManager.getConnection(socketId);
      if (connection) {
        rconClient = connection.client;
      }
    } catch (error) {
      this.logger.debug(
        `No RCON client available for socket: ${error.message}`,
      );
    }

    return {
      params,
      kv: this.kv.kv as Deno.Kv,

      rcon: rconClient,
      api: {
        ...minecraftAPI,
        executeCommand: async (command: string) => {
          return await this.executeCommand(command);
        },
        execute: async (command: string) => {
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

      bluemap: bluemapAPI,

      files: filesAPI,

      tellraw: async (
        target: string,
        message: string | TellrawComponent | TellrawComponent[],
      ) => {
        // Helper to try parsing JSON string components
        const tryParseJSON = (str: string) => {
          try {
            return JSON.parse(str);
          } catch (e) {
            return null;
          }
        };

        // If message is a string that looks like JSON
        if (
          typeof message === "string" &&
          (message.startsWith("[{") || message.startsWith('{"'))
        ) {
          const parsed = tryParseJSON(message);
          if (parsed) {
            if (Array.isArray(parsed)) {
              contextComponents.push(...parsed);
            } else {
              contextComponents.push(parsed);
            }
            contextComponents.push({ text: "\n" });

            const jsonMessage = JSON.stringify(
              Array.isArray(parsed) ? parsed : [parsed],
            );
            await this.executeCommand(`tellraw ${target} ${jsonMessage}`);

            return [...contextComponents];
          }
        }

        // If message is an array, spread it into contextComponents
        if (Array.isArray(message)) {
          contextComponents.push(...message);
          contextComponents.push({ text: "\n" });

          const jsonMessage = JSON.stringify(message);
          await this.executeCommand(`tellraw ${target} ${jsonMessage}`);

          return [...contextComponents];
        }

        // If message is a component with encoded JSON text
        if (
          typeof message === "object" && "text" in message &&
          typeof message.text === "string" &&
          (message.text.startsWith("[{") || message.text.startsWith('{"'))
        ) {
          const parsed = tryParseJSON(message.text);
          if (parsed) {
            if (Array.isArray(parsed)) {
              contextComponents.push(...parsed);
            } else {
              contextComponents.push(parsed);
            }
            contextComponents.push({ text: "\n" });

            const jsonMessage = JSON.stringify(
              Array.isArray(parsed) ? parsed : [parsed],
            );
            await this.executeCommand(`tellraw ${target} ${jsonMessage}`);

            return [...contextComponents];
          }
        }

        // Handle single component/string as before
        const component: TellrawComponent = typeof message === "string"
          ? { text: message }
          : message;

        // Convert to JSON for Minecraft
        const jsonMessage = JSON.stringify([component]);

        // Send to Minecraft
        await this.executeCommand(`tellraw ${target} ${jsonMessage}`);

        // Send to WebSocket player
        this.sendToPlayer(target, {
          type: "chat_message",
          message: component.text,
          timestamp: Date.now(),
          metadata: {
            color: component.color || "white",
            bold: component.bold || false,
            italic: component.italic || false,
            underlined: component.underlined || false,
          },
        });

        // Store the complete component
        contextComponents.push(component);
        contextComponents.push({ text: "\n" });

        return [...contextComponents];
      },

      playerManager: this.playerManager,

      // Player management and messaging
      players: {
        getAll: () => this.playerManager.getAllPlayers(),
        isOnline: (playerName: string) =>
          this.playerManager.isOnline(playerName),
        isOperator: (playerName: string) =>
          this.playerManager.isOperator(playerName),
        sendWebSocket: (playerId: string, data: unknown) =>
          this.sendToPlayer(playerId, data),
        broadcastWebSocket: (data: unknown) => this.broadcastPlayers(data),
        sendGameMessage: async (
          playerId: string,
          message: string,
          options = {},
        ) => {
          const {
            color = "white",
            bold = false,
            italic = false,
            underlined = false,
            sound = "entity.experience_orb.pickup",
          } = options;

          // Send WebSocket message for UI
          this.sendToPlayer(playerId, {
            type: "chat_message",
            message,
            timestamp: Date.now(),
            metadata: { color, bold, italic, underlined },
          });

          // Send in-game message
          const tellrawCommand =
            `tellraw ${playerId} {"text":"${message}","color":"${color}"${
              bold ? ',"bold":true' : ""
            }${italic ? ',"italic":true' : ""}${
              underlined ? ',"underlined":true' : ""
            }}`;

          // Play sound if specified
          if (sound) {
            await this.executeCommand(
              `execute at ${playerId} run playsound ${sound} master ${playerId} ~ ~ ~ 1 1`,
            );
          }

          await this.executeCommand(tellrawCommand);
        },
      },

      // Module execution
      modules: {
        execute: this.executeModuleScript.bind(this),
      },
      getCommands: (permission: string) =>
        this.getCommandsByPermission(permission),
      handleCommand: async (
        data: {
          command: string;
          data: {
            subcommand: string;
            arguments: unknown;
            sender: string;
            senderType: string;
          };
        },
      ) =>
        this.handleCommand(
          data.command as string,
          data.data?.subcommand as string,
          data.data?.arguments,
          data.data?.sender as string,
          data.data?.senderType as string,
        ),

      //to be renamed and/or removed
      sendToMinecraft: this.sendToMinecraft.bind(this),
      sendToPlayer: this.sendToPlayer.bind(this),
      broadcastPlayers: this.broadcastPlayers.bind(this),
      messagePlayer: this.messagePlayer.bind(this),

      log: this.logger.debug.bind(this.logger),
      debug: this.logger.debug.bind(this.logger),
      info: this.logger.info.bind(this.logger),
      warn: this.logger.warn.bind(this.logger),
      error: this.logger.error.bind(this.logger),
    };
  }

  async executeModuleScript(
    moduleName: string,
    methodName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.interpreter.executeModuleScript(
      moduleName,
      methodName,
      params,
    );
  }

  addMinecraftSocket(socket: WebSocket, req: Request): void {
    try {
      // Extract token from URL query parameters
      const authHeader = req.headers.get("Authorization");

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        this.logger.error("No valid Authorization header found");
        return false;
      }

      const token = authHeader.split(" ")[1];

      if (!token) {
        this.logger.error("No token provided in WebSocket connection");
        socket.close(1008, "No authentication token provided");
        return;
      }

      // Add socket to set
      this.minecraftSockets.add(socket);

      // Set the socket in the command handler
      this.wsCommandHandler.setSocket(socket);

      // Initialize RCON connection
      this.rconManager.createConnection(socket, token).catch((error) => {
        this.logger.error(`Failed to create RCON connection: ${error.message}`);
        // Don't close the socket - RCON is optional
      });

      if (socket.readyState === WebSocket.OPEN) {
        this.registerAllCommands().catch((error) => {
          this.logger.error(
            `Error registering commands after connection: ${error.message}`,
          );
        });
      } else {
        socket.addEventListener("open", () => {
          this.registerAllCommands().catch((error) => {
            this.logger.error(
              `Error registering commands after connection: ${error.message}`,
            );
          });
        });
      }
    } catch (error) {
      this.logger.error(`Error adding Minecraft socket: ${error.message}`);
      socket.close(1011, "Internal server error");
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

  private getHealthySocket(): WebSocket | null {
    return Array.from(this.minecraftSockets)
      .find((socket) => socket.readyState === WebSocket.OPEN) || null;
  }

  private async sendToMinecraft(data: unknown): Promise<unknown> {
    const socket = this.getHealthySocket();
    if (!socket) {
      throw new Error("No healthy Minecraft WebSocket connections available");
    }

    try {
      return await this.wsCommandHandler.sendCommand(socket, data);
    } catch (error) {
      this.logger.error(`Error sending command to Minecraft: ${error.message}`);
      throw error;
    }
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
        this.logger.error(
          `Failed to send message to player ${playerId}: ${error}`,
        );
        this.playerSockets.delete(playerId);
      }
    });
  }

  private sendToPlayer(playerId: string, data: unknown): void {
    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.send(JSON.stringify(data));
    } else {
      // this.logger.error(`No socket found for player ${playerId}`);
    }
  }

  // Response handling methods
  hasPendingResponse(id: string): boolean {
    return this.pendingResponses.has(id);
  }

  async resolvePendingResponse(id: string, data: unknown): Promise<void> {
    const resolver = this.pendingResponses.get(id);
    if (resolver) {
      resolver(data);
      this.pendingResponses.delete(id);
    }
  }

  async handleMessage(
    data: Record<string, unknown>,
    _type: "minecraft" | "fresh",
  ): Promise<Record<string, unknown>> {
    if (
      data.id && this.wsCommandHandler.handleResponse(data.id as string, data)
    ) {
      return {}; // Response was handled
    }

    switch (data.type) {
      case "custom_command_executed":
        // Commands can now run truly in parallel
        this.handleCommand(
          data.command as string,
          data.data?.subcommand as string,
          data.data?.arguments,
          data.data?.sender as string,
          data.data?.senderType as string,
        ).catch((error) => {
          this.logger.error(`Error handling command: ${error}`);
        });
        return {};
      case "command":
        return { result: await this.executeCommand(data.data as string) };
      case "register_command":
        return {
          result: await this.registerCommand(data.data as CommandMetadata),
        };
      default:
        this.logger.warn(`Unknown message type: ${JSON.stringify(data)}`);
        return { error: `Unknown message type: ${data.type}` };
    }
  }

  private async executeCommand(command: string): Promise<string> {
    try {
      const response = await this.sendToMinecraft({
        type: "command",
        data: command,
      });
      return (response as { result: string }).result ||
        JSON.stringify(response);
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
          subcommands: [],
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
            subcommands: [],
          };
          rootCommands.set(rootCommandName, rootCommand);
        }

        // Add this as a subcommand
        const subcommand = {
          name: command.path[command.path.length - 1],
          description: command.description,
          usage: command.usage,
          permissions: command.permissions,
          arguments: command.arguments,
        };

        rootCommand.subcommands = rootCommand.subcommands || [];
        rootCommand.subcommands.push(subcommand);
      }
    }

    this.logger.info(`Registering ${rootCommands.size} base commands...`);

    // Register each root command with its subcommands
    for (const rootCommand of rootCommands.values()) {
      await this.registerCommand(rootCommand);
    }

    this.logger.debug("All commands registered successfully.");
  }

  private async registerCommand(commandData: CommandMetadata): Promise<void> {
    try {
      const openSocket = Array.from(this.minecraftSockets)
        .find((socket) => socket.readyState === WebSocket.OPEN);

      if (!openSocket) {
        throw new Error("No open WebSocket connections available");
      }

      // Create the command registration payload
      const registrationData = {
        name: commandData.name,
        description: commandData.description,
        usage: commandData.usage,
        permissions: commandData.permissions,
        arguments: commandData.arguments,
        subcommands: commandData.subcommands || [],
      };

      await this.sendToMinecraft({
        type: "register_command",
        data: registrationData,
      });

      this.logger.debug(
        `Command "${commandData.name}" "${commandData.description}" registered.`,
      );
    } catch (error) {
      this.logger.error(
        `Error registering command "${commandData.name}": ${
          (error as Error).message
        }`,
      );
    }
  }

  getCommandsByPermission(permission: string): CommandMetadata[] {
    return this.interpreter.getCommandsByPermission(permission);
  }
}
