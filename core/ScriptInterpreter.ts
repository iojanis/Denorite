import type { ScriptContext } from "../types.ts";
import { Logger } from "./logger.ts";
import {getMetadata, listMetadata, WatchConfig} from "../decorators.ts";
import type { RateLimiter } from "./RateLimiter.ts";
import {CronManager} from "./CronManager.ts";

interface ModuleMetadata {
  name: string;
  version: string;
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

interface CommandRegistrationData extends CommandMetadata {
  path: string[];
  moduleName: string;
  methodName: string;
  arguments: string[];
  socketName: string;
}

interface WatchRegistration {
  moduleName: string;
  methodName: string;
  config: {
    keys: string[][];
    debounce: number;
    initial: boolean;
  };
  cleanup?: () => void;
}

export class ScriptInterpreter {
  private modules: Map<string, { instance: ModuleInstance; metadata: ModuleMetadata }> = new Map();
  private events: Map<string, DecoratedMethod[]> = new Map();
  private commands: Map<string, DecoratedMethod> = new Map();
  private sockets: Map<string, DecoratedMethod> = new Map();
  private commandRegistrations: Map<string, CommandRegistrationData> = new Map();
  private readonly contextFactory: (params: Record<string, unknown>) => ScriptContext;
  private watches: Map<string, WatchRegistration> = new Map();
  private pendingDebounces: Map<string, number> = new Map();
  private logger: Logger;
  private cronManager: CronManager;
  private rateLimiter: RateLimiter;

  constructor(logger: Logger, contextFactory: (params: Record<string, unknown>) => ScriptContext, kv: Deno.Kv,
              rateLimiter: RateLimiter) {
    this.logger = logger;
    this.contextFactory = contextFactory;
    this.cronManager = new CronManager(logger);
    this.rateLimiter = rateLimiter;
  }

  private async processCommandMetadata(
    key: string,
    value: any,
    moduleName: string,
    commandStructure: { [key: string]: any },
    allMetadata: { [key: string]: any }
  ): Promise<void> {
    const methodName = key.split(':')[1];
    const commandConfig = value as { path: string[] };
    const commandPath = commandConfig.path;

    // For paths like ["bank", "balance"], we need to register under "bank" with "balance" as subcommand
    const rootCommandName = commandPath[0];

    // Check if there's a socket decorator for this method
    const socketMetadata = allMetadata[`socket:${methodName}`];

    // If there is a socket decorator, get its name or generate from command path
    let socketName = socketMetadata?.name;
    if (!socketName && commandPath) {
      // Generate socket name from command path if none provided
      socketName = commandPath.join('_');
    }

    // If we have a socket name, register the socket handler
    if (socketName) {
      this.addSocketHandler(socketName, moduleName, methodName);
    }

    if (!commandStructure[rootCommandName]) {
      // Initialize the root command if it doesn't exist
      commandStructure[rootCommandName] = {
        name: rootCommandName,
        description: 'Root command',
        permissions: ['player'],
        subcommands: []
      };
    }

    if (commandPath.length === 1) {
      // This is a root command without subcommands
      const argumentMetadata = allMetadata[`arguments:${methodName}`] || [];
      const descriptionMetadata = allMetadata[`description:${methodName}`];
      const permissionMetadata = allMetadata[`permission:${methodName}`] || ['player'];

      Object.assign(commandStructure[rootCommandName], {
        name: rootCommandName,
        description: descriptionMetadata || 'No description provided',
        usage: argumentMetadata.length > 0
          ? argumentMetadata.map((arg: any) => `<${arg.name}>`).join(' ')
          : '',
        permissions: Array.isArray(permissionMetadata) ? permissionMetadata : [permissionMetadata],
        moduleName,
        methodName,
        arguments: argumentMetadata,
        socketName // Add socket name to command metadata
      });
    } else {
      // This is a subcommand
      const subcommandName = commandPath[commandPath.length - 1];
      const argumentMetadata = allMetadata[`arguments:${methodName}`] || [];
      const descriptionMetadata = allMetadata[`description:${methodName}`];
      const permissionMetadata = allMetadata[`permission:${methodName}`] || ['player'];

      const subcommandData = {
        name: subcommandName,
        description: descriptionMetadata || 'No description provided',
        usage: argumentMetadata.length > 0
          ? argumentMetadata.map((arg: any) => `<${arg.name}>`).join(' ')
          : '',
        permissions: Array.isArray(permissionMetadata) ? permissionMetadata : [permissionMetadata],
        moduleName,
        methodName,
        arguments: argumentMetadata,
        socketName // Add socket name to subcommand metadata
      };

      // Add to subcommands array of the root command
      if (!commandStructure[rootCommandName].subcommands) {
        commandStructure[rootCommandName].subcommands = [];
      }
      commandStructure[rootCommandName].subcommands.push(subcommandData);
    }

    // Store the full command path for our internal use
    const fullCommandPath = commandPath.join(' ');
    this.commands.set(fullCommandPath, { moduleName, methodName });

    // Store the registration data for later use
    this.commandRegistrations.set(fullCommandPath, {
      name: commandPath[commandPath.length - 1],
      path: commandPath,
      description: allMetadata[`description:${methodName}`] || 'No description provided',
      usage: (allMetadata[`arguments:${methodName}`] || [])
        .map((arg: any) => `<${arg.name}>`).join(' '),
      permissions: Array.isArray(allMetadata[`permission:${methodName}`])
        ? allMetadata[`permission:${methodName}`]
        : [allMetadata[`permission:${methodName}`] || 'player'],
      moduleName,
      methodName,
      arguments: allMetadata[`arguments:${methodName}`] || [],
      socketName // Add socket name to registration data
    });
  }

  private async startWatcher(registration: WatchRegistration): Promise<void> {
    const { moduleName, methodName, config } = registration;
    const kv = this.contextFactory({}).kv as Deno.Kv;

    // Create reader for the watch stream
    const reader = kv.watch(config.keys).getReader();

    // Store cleanup function
    registration.cleanup = () => {
      reader.cancel();
    };

    // Handle initial values if requested
    if (config.initial) {
      for (const keyPath of config.keys) {
        const initialValue = await kv.get(keyPath);
        await this.handleWatchUpdate(registration, [{
          key: keyPath,
          value: initialValue.value,
          versionstamp: initialValue.versionstamp
        }]);
      }
    }

    // Start watching for changes
    (async () => {
      try {
        while (true) {
          const { value: entries, done } = await reader.read();
          if (done) break;

          await this.handleWatchUpdate(registration, entries);
        }
      } catch (error) {
        this.logger.error(
          `Watch error for ${moduleName}.${methodName}: ${error.message}`
        );
      }
    })();
  }

  private async handleWatchUpdate(
    registration: WatchRegistration,
    entries: Array<{ key: string[]; value: unknown; versionstamp: string }>
  ): Promise<void> {
    const { moduleName, methodName, config } = registration;
    const moduleData = this.modules.get(moduleName);
    if (!moduleData) return;

    const { instance: moduleInstance } = moduleData;
    const watchMethod = moduleInstance[methodName];
    if (typeof watchMethod !== 'function') return;

    const context = this.contextFactory({
      entries,
      timestamp: Date.now()
    });

    // Handle debouncing if configured
    if (config.debounce > 0) {
      const debounceKey = `${moduleName}:${methodName}`;
      const existingTimeout = this.pendingDebounces.get(debounceKey);

      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        watchMethod.call(moduleInstance, context);
        this.pendingDebounces.delete(debounceKey);
      }, config.debounce);

      this.pendingDebounces.set(debounceKey, timeout);
    } else {
      // Execute immediately if no debounce
      await watchMethod.call(moduleInstance, context);
    }
  }

  async loadModule(modulePath: string, moduleImport: any): Promise<void> {
    this.logger.debug(`Loading module from path: ${modulePath}`);
    try {
      for (const [exportName, exportedItem] of Object.entries(moduleImport)) {
        this.logger.debug(`Examining exported item: ${exportName}`);

        if (typeof exportedItem === 'function' && exportedItem.prototype && exportedItem.prototype.constructor.name !== 'Object') {
          const moduleMetadata = getMetadata(exportedItem, 'module') as ModuleMetadata;

          if (moduleMetadata?.name && moduleMetadata?.version) {
            // Check if module already exists and unload it first
            if (this.modules.has(moduleMetadata.name)) {
              this.logger.debug(`Module ${moduleMetadata.name} already exists, unloading first`);
              await this.unloadModule(moduleMetadata.name);
            }

            const moduleContext = this.contextFactory({
              moduleName: moduleMetadata.name,
              moduleVersion: moduleMetadata.version,
              modulePath: modulePath
            });

            const instance = new (exportedItem as new (context: ScriptContext) => ModuleInstance)(moduleContext);
            this.modules.set(moduleMetadata.name, { instance, metadata: moduleMetadata });
            this.logger.info(`Loaded module: ${moduleMetadata.name} v${moduleMetadata.version}`);

            await this.processModuleMetadata(exportedItem, moduleMetadata);

            // Call onLoad if it exists
            if (typeof instance.onLoad === 'function') {
              try {
                await instance.onLoad();
              } catch (error) {
                this.logger.error(`Error during module initialization for ${moduleMetadata.name}: ${(error as Error).message}`);
                // Consider whether to unload the module on init failure
                await this.unloadModule(moduleMetadata.name);
                throw error;
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error loading module ${modulePath}: ${(error as Error).message}`);
      throw error;
    }
  }

  async unloadModule(moduleName: string): Promise<void> {
    this.logger.debug(`Unloading module: ${moduleName}`);

    try {
      // Get module instance before removing it
      const moduleData = this.modules.get(moduleName);
      if (!moduleData) {
        this.logger.warn(`Attempted to unload non-existent module: ${moduleName}`);
        return;
      }

      // Clean up event handlers
      for (const [eventName, handlers] of this.events.entries()) {
        this.events.set(
          eventName,
          handlers.filter(handler => handler.moduleName !== moduleName)
        );
        // Remove empty event entries
        if (this.events.get(eventName)?.length === 0) {
          this.events.delete(eventName);
        }
      }

      // Clean up commands
      for (const [commandPath, handler] of this.commands.entries()) {
        if (handler.moduleName === moduleName) {
          this.commands.delete(commandPath);
          this.commandRegistrations.delete(commandPath);
        }
      }

      // Clean up socket handlers
      for (const [socketEvent, handler] of this.sockets.entries()) {
        if (handler.moduleName === moduleName) {
          this.sockets.delete(socketEvent);
        }
      }

      // Call cleanup method if it exists
      const instance = moduleData.instance;
      if (typeof instance.onUnload === 'function') {
        try {
          await instance.onUnload();
        } catch (error) {
          this.logger.error(`Error during module cleanup for ${moduleName}: ${(error as Error).message}`);
        }
      }

      // Clean up watches
      for (const [registrationKey, registration] of this.watches.entries()) {
        if (registration.moduleName === moduleName) {
          // Cancel the watcher
          registration.cleanup?.();
          this.watches.delete(registrationKey);

          // Clear any pending debounced calls
          const debounceTimeout = this.pendingDebounces.get(registrationKey);
          if (debounceTimeout) {
            clearTimeout(debounceTimeout);
            this.pendingDebounces.delete(registrationKey);
          }
        }
      }

      // Remove module from registry
      this.modules.delete(moduleName);
      this.logger.debug(`Successfully unloaded module: ${moduleName}`);
    } catch (error) {
      this.logger.error(`Error unloading module ${moduleName}: ${(error as Error).message}`);
      throw error;
    }
  }

  async unloadAllModules(): Promise<void> {
    this.logger.debug('Unloading all modules');

    const moduleNames = Array.from(this.modules.keys());
    for (const moduleName of moduleNames) {
      await this.unloadModule(moduleName);
    }

    // Clear all remaining registries just in case
    this.events.clear();
    this.commands.clear();
    this.sockets.clear();
    this.commandRegistrations.clear();

    this.logger.debug('Successfully unloaded all modules');
  }


  private async processModuleMetadata(exportedItem: any, moduleMetadata: ModuleMetadata): Promise<void> {
    const allMetadata = listMetadata(exportedItem);
    const commandStructure: { [key: string]: any } = {};

    for (const [key, value] of Object.entries(allMetadata)) {
      if (key.startsWith('event:')) {
        const eventName = (value as { name: string }).name;
        this.addEventHandler(eventName, moduleMetadata.name, key.split(':')[1]);
      } else if (key.startsWith('command:')) {
        await this.processCommandMetadata(key, value, moduleMetadata.name, commandStructure, allMetadata);
      } else if (key.startsWith('socket:')) {
        const socketEventName = (value as { name: string }).name;
        this.addSocketHandler(socketEventName, moduleMetadata.name, key.split(':')[1]);
      } else if (key.startsWith('watch:')) {
        const watchConfig = value as WatchConfig;
        const methodName = key.split(':')[1];

        const registration: WatchRegistration = {
          moduleName: moduleMetadata.name,
          methodName,
          config: watchConfig
        };

        const registrationKey = `${moduleMetadata.name}:${methodName}`;
        this.watches.set(registrationKey, registration);

        // Start the watcher
        await this.startWatcher(registration);
      }
    }
  }

  private addEventHandler(eventName: string, moduleName: string, methodName: string): void {
    const handlers = this.events.get(eventName) || [];
    handlers.push({ moduleName, methodName });
    this.events.set(eventName, handlers);
    this.logger.debug(`Registered event handler: ${eventName} -> ${moduleName}.${methodName}`);
  }

  private addSocketHandler(eventName: string, moduleName: string, methodName: string): void {
    this.sockets.set(eventName, { moduleName, methodName });
    this.logger.debug(`Registered socket handler: ${eventName} -> ${moduleName}.${methodName}`);
  }

  async executeCommand(command: string, subcommand: string | undefined, args: unknown, sender: string, senderType: string): Promise<unknown> {
    let fullCommandPath = command;
    if (subcommand) {
      fullCommandPath += ` ${subcommand}`;
    }

    const decoratedMethod = this.commands.get(fullCommandPath);
    if (!decoratedMethod) {
      throw new Error(`Command not found: ${fullCommandPath}`);
    }

    const { moduleName, methodName } = decoratedMethod;
    const moduleData = this.modules.get(moduleName);
    if (!moduleData) {
      throw new Error(`Module not found: ${moduleName}`);
    }

    const { instance: moduleInstance } = moduleData;
    const commandMethod = moduleInstance[methodName];
    if (typeof commandMethod !== 'function') {
      throw new Error(`Command method not found: ${moduleName}.${methodName}`);
    }

    const context = this.contextFactory({ command, subcommand, ...args as Record<string, unknown>, args, sender, senderType });
    return await commandMethod.call(moduleInstance, context);
  }

  async executeEvent(eventType: string, data: unknown): Promise<void> {
    const handlers = this.events.get(eventType) || [];
    for (const { moduleName, methodName } of handlers) {
      const moduleData = this.modules.get(moduleName);
      if (moduleData) {
        const { instance: moduleInstance } = moduleData;
        const eventMethod = moduleInstance[methodName];
        if (typeof eventMethod === 'function') {
          const context = this.contextFactory({
            event: eventType,
            ...(data as Record<string, unknown>)
          });
          await eventMethod.call(moduleInstance, context);
        }
      }
    }
  }

  async executeSocket(socketType: string, data: unknown): Promise<unknown> {
    let handler = this.sockets.get(socketType);
    if (!handler) {
      // Check if this socket type corresponds to a command
      const commandRegistration = Array.from(this.commandRegistrations.values())
        .find(reg => reg.socketName === socketType);

      if (!commandRegistration) {
        throw new Error(`Socket handler not found: ${socketType}`);
      }

      // Use the command's module and method
      handler = {
        moduleName: commandRegistration.moduleName,
        methodName: commandRegistration.methodName
      };
    }

    const { moduleName, methodName } = handler;
    const moduleData = this.modules.get(moduleName);
    if (!moduleData) {
      throw new Error(`Module not found: ${moduleName}`);
    }

    const { instance: moduleInstance } = moduleData;
    const socketMethod = moduleInstance[methodName];
    if (typeof socketMethod !== 'function') {
      throw new Error(`Socket method not found: ${moduleName}.${methodName}`);
    }

    const context = this.contextFactory({
      socketType,
      ...data as Record<string, unknown>,
      // Include any command-specific context needed
    });

    return await socketMethod.call(moduleInstance, context);
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

    const context = this.contextFactory(params);
    return await method.call(moduleInstance, context);
  }

  getRegisteredCommands(): CommandRegistrationData[] {
    return Array.from(this.commandRegistrations.values());
  }

  getCommandsByPermission(permission: string): CommandRegistrationData[] {
    return Array.from(this.commandRegistrations.values())
      .filter(command => command.permissions.includes(permission));
  }

  getCommandByPath(path: string): CommandRegistrationData | undefined {
    return this.commandRegistrations.get(path);
  }
}
