// deno-lint-ignore-file
// src/decorators.ts
// deno-lint-ignore-file
import { PlayerManager } from "./core/PlayerManager.ts";
import type { RateLimiter } from "./core/RateLimiter.ts";

export function Online(location: "game" | "web" | "both" = "both") {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(
      context.metadata,
      `online:${context.name.toString()}`,
      location,
    );
    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params, playerManager } = scriptContext as {
        params: any;
        playerManager: PlayerManager;
      };
      const sender = params.sender || params.playerName;

      if (!sender) {
        throw new Error("No sender specified for online-required action");
      }

      const isOnline = playerManager.isOnline(sender);
      if (!isOnline) {
        throw new Error("Player must be online to perform this action");
      }

      // Add location-specific checks if needed
      const player = playerManager.getPlayer(sender);
      if (location === "game" && !player?.location) {
        throw new Error("This action requires the player to be in-game");
      }

      return originalMethod.apply(this, args);
    };
  };
}

export function Permission(permission: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(
      context.metadata,
      `permission:${context.name.toString()}`,
      permission,
    );
    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params, playerManager } = scriptContext as {
        params: any;
        playerManager: PlayerManager;
      };
      const sender = params.sender || params.playerName;

      if (!sender && (permission !== "guest")) {
        throw new Error("No sender specified for permission check");
      }

      if (
        !playerManager.hasPermission(sender, permission) &&
        (permission !== "guest")
      ) {
        throw new Error(`Insufficient permissions. Required: ${permission}`);
      }

      return originalMethod.apply(this, args);
    };
  };
}

// Update the existing Command decorator to handle permissions
export function Command(commandPath: string[]) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `command:${context.name.toString()}`, {
      path: commandPath,
    });
    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params, playerManager } = scriptContext as {
        params: any;
        playerManager: PlayerManager;
      };

      // Get the permission requirement from metadata
      const permissionMetadata = getMetadata(
        context.metadata,
        `permission:${context.name.toString()}`,
      );
      if (permissionMetadata) {
        const sender = params.sender;
        if (
          !playerManager.hasPermission(sender, permissionMetadata) &&
          (permissionMetadata !== "guest")
        ) {
          throw new Error(
            `Insufficient permissions. Required: ${permissionMetadata}`,
          );
        }
      }

      return originalMethod.apply(this, args);
    };
  };
}

function setMetadata(target: any, key: string, value: any) {
  if (!target[metadataSymbol]) {
    target[metadataSymbol] = new Map();
  }
  target[metadataSymbol].set(key, value);
}

export function getMetadata(target: any, key: string): any {
  return target[metadataSymbol]?.get(key);
}

export function Module(config: { name: string; version: string }) {
  return function (target: Function) {
    setMetadata(target, "module", config);
  };
}

export function Event(eventName: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `event:${context.name.toString()}`, {
      name: eventName,
    });
    return function (this: any, ...args: unknown[]) {
      // Here you can add any pre-processing logic
      const result = originalMethod.apply(this, args);
      // Here you can add any post-processing logic
      return result;
    };
  };
}

export function Argument(
  configs: { name: string; type: string; description: string }[],
) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(
      context.metadata,
      `arguments:${context.name.toString()}`,
      configs,
    );
    return function (this: any, ...args: unknown[]) {
      // Here you can add argument-specific logic if needed
      return originalMethod.apply(this, args);
    };
  };
}

export function Socket(socketName?: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    const name = socketName || context.name.toString();
    setMetadata(context.metadata, `socket:${context.name.toString()}`, {
      name,
    });
    return function (this: any, ...args: unknown[]) {
      // Here you can add socket-specific logic
      return originalMethod.apply(this, args);
    };
  };
}

export function Description(description: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(
      context.metadata,
      `description:${context.name.toString()}`,
      description,
    );
    return function (this: any, ...args: unknown[]) {
      // Here you can add description-specific logic if needed
      return originalMethod.apply(this, args);
    };
  };
}

interface CronOptions {
  backoffSchedule?: number[];
}

export function Cron(cronExpression: string, options?: CronOptions) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `cron:${context.name.toString()}`, {
      expression: cronExpression,
      options,
    });

    return async function (this: any, ...args: unknown[]) {
      // The original method execution remains unchanged
      return originalMethod.apply(this, args);
    };
  };
}

export function Limit(limit: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `limit:${context.name.toString()}`, limit);

    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params } = scriptContext as { params: any };
      const sender = params.sender || params.playerName;

      if (!sender) {
        throw new Error("No sender specified for rate limit check");
      }

      // Parse the limit string (e.g., "10/minute", "100/hour")
      const [count, interval] = limit.split("/");
      const maxRequests = parseInt(count);

      // Convert interval to milliseconds
      let windowMs: number;
      switch (interval.toLowerCase()) {
        case "second":
          windowMs = 1000;
          break;
        case "minute":
          windowMs = 60 * 1000;
          break;
        case "hour":
          windowMs = 60 * 60 * 1000;
          break;
        case "day":
          windowMs = 24 * 60 * 60 * 1000;
          break;
        default:
          throw new Error(`Invalid rate limit interval: ${interval}`);
      }

      // Create rate limit config
      const config = {
        windowMs,
        maxRequests,
      };

      // Get method name for rate limiting
      const methodName = context.name.toString();

      // Check rate limit using RateLimiter
      const rateLimiter = scriptContext.rateLimiter as RateLimiter;
      const result = await rateLimiter.handleSocketRateLimit(
        sender,
        `${this.constructor.name}:${methodName}`,
        "player", // Default to player role, can be enhanced to be more dynamic
      );

      if (!result.allowed) {
        throw new Error(result.error || "Rate limit exceeded");
      }

      // Execute the original method if rate limit check passes
      return originalMethod.apply(this, args);
    };
  };
}

export interface WatchConfig {
  keys: string[][]; // Array of kv key paths to watch
  debounce?: number; // Optional debounce time in ms
  initial?: boolean; // Whether to trigger on initial load
}

export function Watch(config: WatchConfig) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(
      context.metadata,
      `watch:${context.name.toString()}`,
      {
        keys: config.keys,
        debounce: config.debounce || 0,
        initial: config.initial || false,
      },
    );
    return originalMethod;
  };
}

// Helper functions
const metadataSymbol = Symbol("metadata");
const symbolMetadataKey = Symbol.for("Symbol.metadata");

export function listMetadata(target: any): { [key: string]: any } {
  const result: { [key: string]: any } = {};

  // Function to safely get values from a Map
  const getMapValues = (map: Map<any, any>) => {
    const obj: { [key: string]: any } = {};
    map.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  };

  // Get metadata from the class (for @Module decorator)
  if (target[metadataSymbol] instanceof Map) {
    Object.assign(result, getMapValues(target[metadataSymbol]));
  }

  // Get metadata from Symbol(Symbol.metadata)
  for (const key of Object.getOwnPropertySymbols(target)) {
    if (key.description === "Symbol.metadata") {
      const symbolMetadata = target[key];
      if (symbolMetadata && typeof symbolMetadata === "object") {
        const nestedMetadata = symbolMetadata[metadataSymbol];
        if (nestedMetadata instanceof Map) {
          Object.assign(result, getMapValues(nestedMetadata));
        }
      }
      break;
    }
  }

  return result;
}

export function clearMetadata(target: any): void {
  if (target[metadataSymbol]) {
    target[metadataSymbol].clear();
  }
  if (target.prototype && target.prototype[metadataSymbol]) {
    target.prototype[metadataSymbol].clear();
  }
}
