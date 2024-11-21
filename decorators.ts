// deno-lint-ignore-file
// src/decorators.ts
// deno-lint-ignore-file
import { PlayerManager } from "./core/PlayerManager.ts";

// ... (existing metadata handling code from decorators.ts remains the same)

export function Online(location: 'game' | 'web' | 'both' = 'both') {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `online:${context.name.toString()}`, location);
    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params, playerManager } = scriptContext as { params: any, playerManager: PlayerManager };
      const sender = params.sender || params.playerName;

      if (!sender) {
        throw new Error('No sender specified for online-required action');
      }

      const isOnline = playerManager.isOnline(sender);
      if (!isOnline) {
        throw new Error('Player must be online to perform this action');
      }

      // Add location-specific checks if needed
      const player = playerManager.getPlayer(sender);
      if (location === 'game' && !player?.location) {
        throw new Error('This action requires the player to be in-game');
      }

      return originalMethod.apply(this, args);
    };
  };
}

export function Permission(permission: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `permission:${context.name.toString()}`, permission);
    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params, playerManager } = scriptContext as { params: any, playerManager: PlayerManager };
      const sender = params.sender || params.playerName;

      if (!sender) {
        throw new Error('No sender specified for permission check');
      }

      if (!playerManager.hasPermission(sender, permission)) {
        throw new Error(`Insufficient permissions. Required: ${permission}`);
      }

      return originalMethod.apply(this, args);
    };
  };
}

// Update the existing Command decorator to handle permissions
export function Command(commandPath: string[]) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `command:${context.name.toString()}`, { path: commandPath });
    return async function (this: any, ...args: unknown[]) {
      const [scriptContext] = args;
      const { params, playerManager } = scriptContext as { params: any, playerManager: PlayerManager };

      // Get the permission requirement from metadata
      const permissionMetadata = getMetadata(context.metadata, `permission:${context.name.toString()}`);
      if (permissionMetadata) {
        const sender = params.sender;
        if (!playerManager.hasPermission(sender, permissionMetadata)) {
          throw new Error(`Insufficient permissions. Required: ${permissionMetadata}`);
        }
      }

      return originalMethod.apply(this, args);
    };
  };
}
// Helper function to store metadata
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
    setMetadata(target, 'module', config);
  };
}

export function Event(eventName: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `event:${context.name.toString()}`, { name: eventName });
    return function (this: any, ...args: unknown[]) {
      // Here you can add any pre-processing logic
      const result = originalMethod.apply(this, args);
      // Here you can add any post-processing logic
      return result;
    };
  };
}

// export function Command(commandPath: string[]) {
//   return function (originalMethod: any, context: ClassMethodDecoratorContext) {
//     setMetadata(context.metadata, `command:${context.name.toString()}`, { path: commandPath });
//     return function (this: any, ...args: unknown[]) {
//       // Here you can add command-specific logic
//       return originalMethod.apply(this, args);
//     };
//   };
// }

export function Argument(configs: { name: string; type: string; description: string }[]) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `arguments:${context.name.toString()}`, configs);
    return function (this: any, ...args: unknown[]) {
      // Here you can add argument-specific logic if needed
      return originalMethod.apply(this, args);
    };
  };
}

// export function Permission(permission: string) {
//   return function (originalMethod: any, context: ClassMethodDecoratorContext) {
//     setMetadata(context.metadata, `permission:${context.name.toString()}`, permission);
//     return function (this: any, ...args: unknown[]) {
//       // Here you can add permission-specific logic
//       return originalMethod.apply(this, args);
//     };
//   };
// }

// // todo: if a method should only be executed if sender is online in a location (game / web | empty (both)) (can be combined with socket / command)
// export function Online(location: string) {
//   return function (originalMethod: any, context: ClassMethodDecoratorContext) {
//     setMetadata(context.metadata, `online:${context.name.toString()}`, location);
//     return function (this: any, ...args: unknown[]) {
//       // Here you can add permission-specific logic
//       return originalMethod.apply(this, args);
//     };
//   };
// }

// todo: limit execution rate for a method
export function Limit(limit: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `limit:${context.name.toString()}`, limit);
    return function (this: any, ...args: unknown[]) {
      // Here you can add permission-specific logic
      return originalMethod.apply(this, args);
    };
  };
}

export function Socket(socketName?: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    const name = socketName || context.name.toString();
    setMetadata(context.metadata, `socket:${context.name.toString()}`, { name });
    return function (this: any, ...args: unknown[]) {
      // Here you can add socket-specific logic
      return originalMethod.apply(this, args);
    };
  };
}

export function Description(description: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `description:${context.name.toString()}`, description);
    return function (this: any, ...args: unknown[]) {
      // Here you can add description-specific logic if needed
      return originalMethod.apply(this, args);
    };
  };
}

export function Schedule(cronExpression: string) {
  return function (originalMethod: any, context: ClassMethodDecoratorContext) {
    setMetadata(context.metadata, `schedule:${context.name.toString()}`, cronExpression);
    return function (this: any, ...args: unknown[]) {
      // Here you can add schedule-specific logic if needed
      return originalMethod.apply(this, args);
    };
  };
}

// Helper functions
const metadataSymbol = Symbol('metadata');
const symbolMetadataKey = Symbol.for('Symbol.metadata');

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
    if (key.description === 'Symbol.metadata') {
      const symbolMetadata = target[key];
      if (symbolMetadata && typeof symbolMetadata === 'object') {
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
