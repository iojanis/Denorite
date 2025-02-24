import type { ScriptContext } from "../types.ts";
import { Logger } from "./logger.ts";
import { getMetadata, listMetadata, WatchConfig } from "../decorators.ts";
import type { RateLimiter } from "./RateLimiter.ts";
import { CronManager } from "./CronManager.ts";

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
  private modules: Map<
    string,
    { instance: ModuleInstance; metadata: ModuleMetadata }
  > = new Map();
  private events: Map<string, DecoratedMethod[]> = new Map();
  private commands: Map<string, DecoratedMethod> = new Map();
  private sockets: Map<string, DecoratedMethod> = new Map();
  private commandRegistrations: Map<string, CommandRegistrationData> =
    new Map();
  private readonly contextFactory: (
    params: Record<string, unknown>,
  ) => ScriptContext;
  private watches: Map<string, WatchRegistration> = new Map();
  private pendingDebounces: Map<string, number> = new Map();
  private logger: Logger;
  private cronManager: CronManager;
  private rateLimiter: RateLimiter;

  constructor(
    logger: Logger,
    contextFactory: (params: Record<string, unknown>) => ScriptContext,
    kv: Deno.Kv,
    rateLimiter: RateLimiter,
  ) {
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
    allMetadata: { [key: string]: any },
    moduleCode: string,
  ): Promise<void> {
    const methodName = key.split(":")[1];
    const commandConfig = value as { path: string[] };
    const commandPath = commandConfig.path;
    const rootCommandName = commandPath[0];

    const socketMetadata = allMetadata[`socket:${methodName}`];
    const argumentMetadata = allMetadata[`arguments:${methodName}`] || [];
    const descriptionMetadata = allMetadata[`description:${methodName}`];
    const permissionMetadata = allMetadata[`permission:${methodName}`] ||
      ["player"];

    let socketName = socketMetadata?.name;
    if (!socketName && commandPath) {
      socketName = commandPath.join("_");
    }

    const kvPaths = this.getKVPaths(moduleCode, methodName);

    this.logger.debug(`📝 Command: ${commandPath.join(" ")}
  ├─ Module: ${moduleName}.${methodName}
  ├─ Args: ${
      argumentMetadata.map((a: any) => `<${a.name}:${a.type}>`).join(" ")
    }
  ├─ Permissions: ${permissionMetadata}
  └─ Socket: ${socketName || "none"}`);

    if (socketName) {
      this.addSocketHandler(socketName, moduleName, methodName);
    }

    if (!commandStructure[rootCommandName]) {
      commandStructure[rootCommandName] = {
        name: rootCommandName,
        description: "Root command",
        permissions: ["player"],
        subcommands: [],
      };
    }

    if (commandPath.length === 1) {
      Object.assign(commandStructure[rootCommandName], {
        name: rootCommandName,
        description: descriptionMetadata || "No description provided",
        usage: argumentMetadata.length > 0
          ? argumentMetadata.map((arg: any) => `<${arg.name}>`).join(" ")
          : "",
        permissions: Array.isArray(permissionMetadata)
          ? permissionMetadata
          : [permissionMetadata],
        moduleName,
        methodName,
        arguments: argumentMetadata,
        socketName,
        kvPaths,
      });
    } else {
      const subcommandName = commandPath[commandPath.length - 1];
      const subcommandData = {
        name: subcommandName,
        description: descriptionMetadata || "No description provided",
        usage: argumentMetadata.length > 0
          ? argumentMetadata.map((arg: any) => `<${arg.name}>`).join(" ")
          : "",
        permissions: Array.isArray(permissionMetadata)
          ? permissionMetadata
          : [permissionMetadata],
        moduleName,
        methodName,
        arguments: argumentMetadata,
        socketName,
        kvPaths,
      };

      if (!commandStructure[rootCommandName].subcommands) {
        commandStructure[rootCommandName].subcommands = [];
      }
      commandStructure[rootCommandName].subcommands.push(subcommandData);
    }

    const fullCommandPath = commandPath.join(" ");
    this.commands.set(fullCommandPath, { moduleName, methodName });

    this.commandRegistrations.set(fullCommandPath, {
      name: commandPath[commandPath.length - 1],
      path: commandPath,
      description: descriptionMetadata || "No description provided",
      usage: argumentMetadata.length > 0
        ? argumentMetadata.map((arg: any) => `<${arg.name}>`).join(" ")
        : "",
      permissions: Array.isArray(permissionMetadata)
        ? permissionMetadata
        : [permissionMetadata],
      moduleName,
      methodName,
      arguments: argumentMetadata,
      socketName,
      kvPaths,
    });
  }

  private async startWatcher(registration: WatchRegistration): Promise<void> {
    const { moduleName, methodName, config } = registration;

    this.logger.debug(`👀 Watch: ${moduleName}.${methodName}
  ├─ Keys: ${config.keys.map((k) => k.join("/")).join(", ")}
  ├─ Debounce: ${config.debounce}ms
  └─ Initial Load: ${config.initial}`);

    const kv = this.contextFactory({}).kv as Deno.Kv;
    const reader = kv.watch(config.keys).getReader();

    registration.cleanup = () => {
      reader.cancel();
    };

    if (config.initial) {
      for (const keyPath of config.keys) {
        const initialValue = await kv.get(keyPath);
        await this.handleWatchUpdate(registration, [{
          key: keyPath,
          value: initialValue.value,
          versionstamp: initialValue.versionstamp,
        }]);
      }
    }

    await (async () => {
      try {
        while (true) {
          const { value: entries, done } = await reader.read();
          if (done) break;
          await this.handleWatchUpdate(registration, entries);
        }
      } catch (error) {
        this.logger.error(
          `Watch error for ${moduleName}.${methodName}: ${error.message}`,
        );
      }
    })();
  }

  private async handleWatchUpdate(
    registration: WatchRegistration,
    entries: Array<{ key: string[]; value: unknown; versionstamp: string }>,
  ): Promise<void> {
    const { moduleName, methodName, config } = registration;

    this.logger.debug(`📣 WatchUpdate: ${moduleName}.${methodName}
  ├─ Entries: ${entries.length}
  ├─ Keys: ${entries.map((e) => e.key.join("/")).join(", ")}
  └─ Debounced: ${this.pendingDebounces.has(`${moduleName}:${methodName}`)}`);

    const moduleData = this.modules.get(moduleName);
    if (!moduleData) return;

    const { instance: moduleInstance } = moduleData;
    const watchMethod = moduleInstance[methodName];
    if (typeof watchMethod !== "function") return;

    const context = this.contextFactory({
      entries,
      timestamp: Date.now(),
    });

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
      await watchMethod.call(moduleInstance, context);
    }
  }

  async loadModule(modulePath: string, moduleImport: any): Promise<void> {
    this.logger.debug(`📦 Loading module: ${modulePath}`);

    try {
      // Read the module file content for KV analysis
      let moduleCode: string = "";
      try {
        // Handle both absolute and relative module paths
        const moduleName = modulePath.split("/").pop()?.replace(".ts", "");
        const possiblePaths = [
          modulePath, // Original path
          `${Deno.cwd()}/modules/${moduleName}.ts`, // Under modules directory
          `${Deno.cwd()}/src/modules/${moduleName}.ts`, // Under src/modules
          `${Deno.cwd()}/${moduleName}.ts`, // Direct in root
        ];

        for (const path of possiblePaths) {
          try {
            moduleCode = await Deno.readTextFile(path);
            if (moduleCode) break;
          } catch (_) {
            continue;
          }
        }
      } catch (error) {
        this.logger.debug(`Note: Static analysis skipped - ${error.message}`);
      }

      const kvPaths = this.getKVPaths(moduleCode);

      for (const [exportName, exportedItem] of Object.entries(moduleImport)) {
        if (
          typeof exportedItem === "function" &&
          exportedItem.prototype &&
          exportedItem.prototype.constructor.name !== "Object"
        ) {
          const moduleMetadata = getMetadata(
            exportedItem,
            "module",
          ) as ModuleMetadata;

          if (moduleMetadata?.name && moduleMetadata?.version) {
            const moduleName = this.getModuleNameFromPath(
              modulePath,
              moduleMetadata.name,
            );

            if (this.modules.has(moduleName)) {
              await this.unloadModule(moduleName);
            }

            const moduleContext = this.contextFactory({
              moduleName: moduleName,
              moduleVersion: moduleMetadata.version,
              modulePath: modulePath,
            });

            const instance = new (exportedItem as new (
              context: ScriptContext,
            ) => ModuleInstance)(moduleContext);

            this.modules.set(moduleName, {
              instance,
              metadata: {
                ...moduleMetadata,
                name: moduleName,
              },
            });

            this.logger.debug(
              `📋 Module: ${moduleName} v${moduleMetadata.version}
  ├─ Class: ${exportName}
  ├─ Path: ${modulePath}
  └─ KV Paths: ${kvPaths.length ? "\n    " + kvPaths.join("\n    ") : "none"}`,
            );

            await this.processModuleMetadata(exportedItem, {
              ...moduleMetadata,
              name: moduleName,
            });

            if (typeof instance.onLoad === "function") {
              try {
                await instance.onLoad();
                this.logger.debug(`✓ Initialized ${moduleName}`);
              } catch (error) {
                this.logger.error(
                  `Error during module initialization for ${moduleName}: ${
                    (error as Error).message
                  }`,
                );
                await this.unloadModule(moduleName);
                throw error;
              }
            }
          } else {
            this.logger.warn(
              `Skipping export '${exportName}': Missing or invalid @Module decorator`,
            );
          }
        }
      }

      this.logger.info(`✓ Loaded module: ${modulePath}`);
    } catch (error) {
      this.logger.error(
        `Error loading module ${modulePath}: ${(error as Error).message}
Stack: ${(error as Error).stack}`,
      );
      throw error;
    }
  }

  private getKVPaths(moduleCode: string | undefined | null): string[] {
    const paths = new Set<string>();

    try {
      if (!moduleCode || typeof moduleCode !== "string") {
        return [];
      }

      // Find direct kv operations with key arrays
      const directKvOps =
        /kv\.(?:get|set|delete|list)\s*(?:<[^>]+>)?\s*\(\s*(?:\[([^\]]+)\])/g;
      for (const match of moduleCode.matchAll(directKvOps)) {
        if (match[1]) {
          const keyParts = match[1]
            .split(",")
            .map((part) => part.trim().replace(/['"]/g, ""))
            .filter(Boolean);
          if (keyParts.length) {
            paths.add(keyParts.join("/"));
          }
        }
      }

      // Find key variables and their values
      const keyVarPattern = /const\s+(\w+)\s*=\s*\[([^\]]+)\]/g;
      const keyVars = new Map<string, string>();
      for (const match of moduleCode.matchAll(keyVarPattern)) {
        const varName = match[1];
        const keyParts = match[2]
          .split(",")
          .map((part) => part.trim().replace(/['"]/g, ""))
          .filter(Boolean);
        keyVars.set(varName, keyParts.join("/"));
      }

      // Find kv operations using those variables
      const varKvOps = new RegExp(
        `kv\\.(get|set|delete)\\s*(?:<[^>]+>)?\\s*\\((${
          Array.from(keyVars.keys()).join("|")
        })\\)`,
        "g",
      );
      for (const match of moduleCode.matchAll(varKvOps)) {
        const varName = match[2];
        const path = keyVars.get(varName);
        if (path) {
          paths.add(path);
        }
      }

      // Find method-based key definitions
      const methodKeys =
        /private\s+\w+Key\([^)]*\)\s*:\s*string\[\]\s*{\s*return\s*\[([^\]]+)\]/g;
      for (const match of moduleCode.matchAll(methodKeys)) {
        const keyParts = match[1]
          .split(",")
          .map((part) => part.trim().replace(/['"]/g, ""))
          .filter(Boolean);
        if (keyParts.length) {
          paths.add(keyParts.join("/"));
        }
      }

      // Find atomic operations
      const atomicOps = /atomic\(\)[^}]*\.(check|set|delete)\(\s*\[([^\]]+)\]/g;
      for (const match of moduleCode.matchAll(atomicOps)) {
        if (match[2]) {
          const keyParts = match[2]
            .split(",")
            .map((part) => part.trim().replace(/['"]/g, ""))
            .filter(Boolean);
          if (keyParts.length) {
            paths.add(keyParts.join("/"));
          }
        }
      }

      // Handle KEYS object
      const keysObject = /KEYS\s*=\s*{([^}]+)}/s;
      const keysMatch = moduleCode.match(keysObject);
      if (keysMatch) {
        const keyDefs = /\[\s*([^\]]+)\s*\]/g;
        for (const match of keysMatch[1].matchAll(keyDefs)) {
          const keyParts = match[1]
            .split(",")
            .map((part) => part.trim().replace(/['"]/g, ""))
            .filter(Boolean);
          if (keyParts.length) {
            paths.add(keyParts.join("/"));
          }
        }
      }

      // Clean and normalize paths
      return Array.from(paths)
        .map((path) => {
          return path
            .replace(/\${[^}]+}/g, (match) => {
              const varName = match.slice(2, -1).trim();
              return `<${varName}>`;
            })
            .replace(/\([^)]+\)/g, "")
            .replace(/\s+/g, "")
            .replace(/\+/g, "/")
            .replace(/\/+/g, "/")
            .replace(/player\s*,\s*(\w+)/g, "player/$1")
            .replace(/plugins\s*,\s*(\w+)/g, "plugins/$1")
            .replace(/(\w+)\s*,\s*(\w+)/g, "$1/$2")
            // Convert variable-like segments to <>
            .replace(/([a-z]+)_?([a-z]+)/gi, (match) => {
              if (
                [
                  "player",
                  "plugins",
                  "economy",
                  "balances",
                  "transactions",
                  "store",
                ].includes(match)
              ) {
                return match;
              }
              return `<${match}>`;
            });
        })
        .filter((path) => {
          const segments = path.split("/");
          return segments.every((segment) =>
            segment &&
            !segment.includes("undefined") &&
            !segment.includes("null") &&
            !segment.includes("function")
          );
        })
        .sort();
    } catch (error) {
      return [];
    }
  }

  private getModuleNameFromPath(
    modulePath: string,
    originalName: string,
  ): string {
    const cleanPath = modulePath.replace(/\.ts$/, "");
    const pathSegments = cleanPath.split("/");
    const moduleIndex = pathSegments.indexOf("modules");
    if (moduleIndex !== -1) {
      pathSegments.splice(0, moduleIndex + 1);
    }
    if (pathSegments.length <= 1) {
      return originalName;
    }
    return pathSegments.join(":");
  }

  async unloadModule(moduleName: string): Promise<void> {
    this.logger.debug(`🗑️ Unload: ${moduleName}
  ├─ Events: ${
      Array.from(this.events.entries())
        .filter(([, handlers]) =>
          handlers.some((h) => h.moduleName === moduleName)
        )
        .map(([event]) => event).join(", ")
    }
  ├─ Commands: ${
      Array.from(this.commands.entries())
        .filter(([, handler]) => handler.moduleName === moduleName)
        .map(([command]) => command).join(", ")
    }
  ├─ Sockets: ${
      Array.from(this.sockets.entries())
        .filter(([, handler]) => handler.moduleName === moduleName)
        .map(([socket]) => socket).join(", ")
    }
  └─ Watches: ${
      Array.from(this.watches.entries())
        .filter(([, watch]) => watch.moduleName === moduleName)
        .map(([key]) => key).join(", ")
    }`);

    try {
      const moduleData = this.modules.get(moduleName);
      if (!moduleData) {
        this.logger.warn(
          `Attempted to unload non-existent module: ${moduleName}`,
        );
        return;
      }

      for (const [eventName, handlers] of this.events.entries()) {
        this.events.set(
          eventName,
          handlers.filter((handler) => handler.moduleName !== moduleName),
        );
        if (this.events.get(eventName)?.length === 0) {
          this.events.delete(eventName);
        }
      }

      for (const [commandPath, handler] of this.commands.entries()) {
        if (handler.moduleName === moduleName) {
          this.commands.delete(commandPath);
          this.commandRegistrations.delete(commandPath);
        }
      }

      for (const [socketEvent, handler] of this.sockets.entries()) {
        if (handler.moduleName === moduleName) {
          this.sockets.delete(socketEvent);
        }
      }

      const instance = moduleData.instance;
      if (typeof instance.onUnload === "function") {
        try {
          await instance.onUnload();
        } catch (error) {
          this.logger.error(
            `Error during module cleanup for ${moduleName}: ${error.message}`,
          );
        }
      }

      for (const [registrationKey, registration] of this.watches.entries()) {
        if (registration.moduleName === moduleName) {
          registration.cleanup?.();
          this.watches.delete(registrationKey);

          const debounceTimeout = this.pendingDebounces.get(registrationKey);
          if (debounceTimeout) {
            clearTimeout(debounceTimeout);
            this.pendingDebounces.delete(registrationKey);
          }
        }
      }

      this.modules.delete(moduleName);
    } catch (error) {
      this.logger.error(
        `Error unloading module ${moduleName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async unloadAllModules(): Promise<void> {
    this.logger.debug(`🧹 Unloading all modules
  ├─ Total: ${this.modules.size}
  ├─ Events: ${this.events.size}
  ├─ Commands: ${this.commands.size}
  ├─ Sockets: ${this.sockets.size}
  └─ Watches: ${this.watches.size}`);

    const moduleNames = Array.from(this.modules.keys());
    for (const moduleName of moduleNames) {
      await this.unloadModule(moduleName);
    }

    this.events.clear();
    this.commands.clear();
    this.sockets.clear();
    this.commandRegistrations.clear();
  }

  private async processModuleMetadata(
    exportedItem: any,
    moduleMetadata: ModuleMetadata,
  ): Promise<void> {
    const allMetadata = listMetadata(exportedItem);

    this.logger.debug(
      `📋 Module: ${moduleMetadata.name} v${moduleMetadata.version}
  ├─ Events (${
        Object.keys(allMetadata).filter((k) => k.startsWith("event:")).length
      }): ${
        Object.entries(allMetadata)
          .filter(([k]) => k.startsWith("event:"))
          .map(([, v]) => (v as any).name)
          .join(", ")
      }
  ├─ Commands (${
        Object.keys(allMetadata).filter((k) => k.startsWith("command:")).length
      }): ${
        Object.entries(allMetadata)
          .filter(([k]) => k.startsWith("command:"))
          .map(([k]) => k.split(":")[1])
          .join(", ")
      }
  ├─ Sockets (${
        Object.keys(allMetadata).filter((k) => k.startsWith("socket:")).length
      }): ${
        Object.entries(allMetadata)
          .filter(([k]) => k.startsWith("socket:"))
          .map(([, v]) => (v as any).name)
          .join(", ")
      }
  └─ Watches (${
        Object.keys(allMetadata).filter((k) => k.startsWith("watch:")).length
      }): ${
        Object.entries(allMetadata)
          .filter(([k]) => k.startsWith("watch:"))
          .map(([k]) => k.split(":")[1])
          .join(", ")
      }`,
    );

    const commandStructure: { [key: string]: any } = {};

    for (const [key, value] of Object.entries(allMetadata)) {
      if (key.startsWith("event:")) {
        const eventName = (value as { name: string }).name;
        this.addEventHandler(eventName, moduleMetadata.name, key.split(":")[1]);
      } else if (key.startsWith("command:")) {
        await this.processCommandMetadata(
          key,
          value,
          moduleMetadata.name,
          commandStructure,
          allMetadata,
        );
      } else if (key.startsWith("socket:")) {
        const socketEventName = (value as { name: string }).name;
        this.addSocketHandler(
          socketEventName,
          moduleMetadata.name,
          key.split(":")[1],
        );
      } else if (key.startsWith("watch:")) {
        const watchConfig = value as WatchConfig;
        const methodName = key.split(":")[1];

        const registration: WatchRegistration = {
          moduleName: moduleMetadata.name,
          methodName,
          config: watchConfig,
        };

        const registrationKey = `${moduleMetadata.name}:${methodName}`;
        this.watches.set(registrationKey, registration);

        await this.startWatcher(registration);
      }
    }
  }

  private addEventHandler(
    eventName: string,
    moduleName: string,
    methodName: string,
  ): void {
    const handlers = this.events.get(eventName) || [];

    this.logger.debug(`🎮 Event Handler: ${eventName}
  ├─ Module: ${moduleName}
  ├─ Method: ${methodName}
  └─ Total Handlers: ${handlers.length + 1}`);

    handlers.push({ moduleName, methodName });
    this.events.set(eventName, handlers);
  }

  private addSocketHandler(
    eventName: string,
    moduleName: string,
    methodName: string,
  ): void {
    this.logger.debug(`🔌 Socket Handler: ${eventName}
  ├─ Module: ${moduleName}
  └─ Method: ${methodName}`);

    this.sockets.set(eventName, { moduleName, methodName });
  }

  async executeCommand(
    command: string,
    subcommand: string | undefined,
    args: unknown,
    sender: string,
    senderType: string,
  ): Promise<unknown> {
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
    if (typeof commandMethod !== "function") {
      throw new Error(`Command method not found: ${moduleName}.${methodName}`);
    }

    const context = this.contextFactory({
      command,
      subcommand,
      ...args as Record<string, unknown>,
      args,
      sender,
      senderType,
    });

    this.logger.debug(`⚡ ${command}${subcommand ? " " + subcommand : ""} 
  ├─ Args: ${JSON.stringify(args)}
  ├─ Sender: ${sender} (${senderType})
  └─ Handler: ${moduleName}.${methodName}`);

    const result = await commandMethod.call(moduleInstance, context);

    this.logger.debug(
      `✓ Command complete: ${command}${subcommand ? " " + subcommand : ""}
  └─ Result: ${JSON.stringify(result)}`,
    );

    return result;
  }

  async executeEvent(eventType: string, data: unknown): Promise<void> {
    const handlers = this.events.get(eventType) || [];

    if (!eventType.includes("tick")) {
      this.logger.debug(`🔔 ${eventType}
    ├─ Data: ${JSON.stringify(data)}
    └─ Handlers: ${
        handlers.map((h) => `${h.moduleName}.${h.methodName}`).join(", ")
      }`);
    }

    for (const { moduleName, methodName } of handlers) {
      const moduleData = this.modules.get(moduleName);
      if (moduleData) {
        const { instance: moduleInstance } = moduleData;
        const eventMethod = moduleInstance[methodName];
        if (typeof eventMethod === "function") {
          const context = this.contextFactory({
            event: eventType,
            ...(data as Record<string, unknown>),
          });
          await eventMethod.call(moduleInstance, context);
        }
      }
    }
  }

  async executeSocket(socketType: string, data: unknown): Promise<unknown> {
    let handler = this.sockets.get(socketType);
    if (!handler) {
      const commandRegistration = Array.from(this.commandRegistrations.values())
        .find((reg) => reg.socketName === socketType);

      if (!commandRegistration) {
        throw new Error(`Socket handler not found: ${socketType}`);
      }

      handler = {
        moduleName: commandRegistration.moduleName,
        methodName: commandRegistration.methodName,
      };
    }

    const { moduleName, methodName } = handler;

    this.logger.debug(`📡 ${socketType}
  ├─ Data: ${JSON.stringify(data)}
  └─ Handler: ${moduleName}.${methodName}`);

    const moduleData = this.modules.get(moduleName);
    if (!moduleData) {
      throw new Error(`Module not found: ${moduleName}`);
    }

    const { instance: moduleInstance } = moduleData;
    const socketMethod = moduleInstance[methodName];
    if (typeof socketMethod !== "function") {
      throw new Error(`Socket method not found: ${moduleName}.${methodName}`);
    }

    const context = this.contextFactory({
      socketType,
      ...data as Record<string, unknown>,
    });

    const result = await socketMethod.call(moduleInstance, context);

    this.logger.debug(`✓ Socket complete: ${socketType}
  └─ Result: ${JSON.stringify(result)}`);

    return result;
  }

  async executeModuleScript(
    moduleName: string,
    methodName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.logger.debug(`📜 Script: ${moduleName}.${methodName}
  └─ Params: ${JSON.stringify(params)}`);

    const moduleData = this.modules.get(moduleName);
    if (!moduleData) {
      throw new Error(`Module ${moduleName} not found`);
    }

    const { instance: moduleInstance } = moduleData;
    const method = moduleInstance[methodName];
    if (typeof method !== "function") {
      throw new Error(`Method ${methodName} not found in module ${moduleName}`);
    }

    const context = this.contextFactory(params);
    const result = await method.call(moduleInstance, context);

    this.logger.debug(`✓ Script complete: ${moduleName}.${methodName}
  └─ Result: ${JSON.stringify(result)}`);

    return result;
  }

  getRegisteredCommands(): CommandRegistrationData[] {
    this.logger.debug(`📖 Commands Registry
  └─ Total: ${this.commandRegistrations.size}`);
    return Array.from(this.commandRegistrations.values());
  }

  getCommandsByPermission(permission: string): CommandRegistrationData[] {
    const commands = Array.from(this.commandRegistrations.values())
      .filter((command) => command.permissions.includes(permission));

    this.logger.debug(`🔑 Commands by Permission: ${permission}
  └─ Found: ${commands.length}`);

    return commands;
  }

  getCommandByPath(path: string): CommandRegistrationData | undefined {
    const command = this.commandRegistrations.get(path);

    this.logger.debug(`🔍 Command Lookup: ${path}
  └─ Found: ${command ? "yes" : "no"}`);

    return command;
  }
}
