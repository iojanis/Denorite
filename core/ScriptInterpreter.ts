import type { ScriptContext } from "../types.ts";
import { Logger } from "./logger.ts";
import { getMetadata, listMetadata } from "../decorators.ts";

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
}

export class ScriptInterpreter {
  private modules: Map<string, { instance: ModuleInstance; metadata: ModuleMetadata }> = new Map();
  private events: Map<string, DecoratedMethod[]> = new Map();
  private commands: Map<string, DecoratedMethod> = new Map();
  private sockets: Map<string, DecoratedMethod> = new Map();
  private commandRegistrations: Map<string, CommandRegistrationData> = new Map();
  private readonly contextFactory: (params: Record<string, unknown>) => ScriptContext;
  private logger: Logger;

  constructor(logger: Logger, contextFactory: (params: Record<string, unknown>) => ScriptContext) {
    this.logger = logger;
    this.contextFactory = contextFactory;
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
        arguments: argumentMetadata
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
        arguments: argumentMetadata
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
      arguments: allMetadata[`arguments:${methodName}`] || []
    });
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

      // Remove module from registry
      this.modules.delete(moduleName);
      this.logger.info(`Successfully unloaded module: ${moduleName}`);
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

    this.logger.info('Successfully unloaded all modules');
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

  async executeCommand(command: string, subcommand: string | undefined, args: unknown, sender: string, senderType: string): Promise<void> {
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
    await commandMethod.call(moduleInstance, context);
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
    const handler = this.sockets.get(socketType);
    if (!handler) {
      throw new Error(`Socket handler not found: ${socketType}`);
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

    const context = this.contextFactory({ socketType, ...data as Record<string, unknown> });
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
