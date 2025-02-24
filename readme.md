# 🔮 Denorite: Deno for Minecraft

> ⚠️ **BETA STATUS NOTICE** ⚠️
>
> Denorite is currently in beta. The following issues have been identified in the core codebase:
>
> - **ScriptInterpreter.ts**: The `getKVPaths` method uses regex-based analysis which may miss some complex key patterns
> - **SocketManager.ts**: WebSocket connections lack robust reconnection strategies and error recovery
> - **CronManager.ts**: Jobs are registered but lack proper scheduling precision guarantees
> - **RateLimiter.ts**: Cleanup relies on intervals that might cause memory leaks if not properly managed
> - **RconClient.ts**: Connection retries could lead to resource exhaustion under certain failure scenarios
> - **WebSocketCommandHandler.ts**: Command timeouts can accumulate if not properly cleaned up
> - **KvManager.ts**: Transaction retries aren't properly bounded in some atomic operations
>
> Please proceed with caution and expect API changes in future releases.

## Introduction

Denorite is a powerful framework that bridges the Deno runtime with Minecraft, enabling you to create dynamic server applications using TypeScript. It provides a modern, secure environment for building plugins, tools, and server management utilities that extend your Minecraft server's capabilities.

## Core Features

- **TypeScript-first Development**: Build type-safe, maintainable Minecraft server extensions
- **Modular Architecture**: Create modules that can be dynamically loaded and unloaded
- **Decorator-based API**: Elegant, declarative approach to defining commands, events, and handlers
- **Key-Value Storage**: Persistent data management using Deno's KV system
- **WebSocket Integration**: Real-time communication between Minecraft and web interfaces
- **Integrated Economy System**: Built-in support for virtual economies
- **Team & Permissions Management**: Sophisticated role-based permissions
- **Spatial Zone Control**: Geographic protection and management
- **UI Components**: Rich UI components for in-game interfaces

## Architecture

Denorite's architecture consists of:

1. **ScriptManager**: Orchestrates module loading, execution, and lifecycle management
2. **ScriptInterpreter**: Handles decorators, command registration, and event processing
3. **SocketManager**: Manages WebSocket connections for real-time communication
4. **KvManager**: Provides an interface to the persistent key-value storage
5. **AuthService**: Handles authentication, token generation, and permission validation
6. **PlayerManager**: Tracks player connections, sessions, and metadata
7. **RateLimiter**: Prevents abuse by limiting request frequency
8. **CronManager**: Schedules recurring tasks using cron expressions

## Getting Started

### Prerequisites

- Deno (v2.0 or higher)
- A Minecraft server with fabric and Denorite mod installed
- Basic knowledge of TypeScript

### Installation

1. Clone the Denorite repository:
   ```bash
   git clone https://github.com/iojanis/denorite.git
   cd denorite
   ```

2. Create a `.env` file with your configuration:
   ```
   DENO_KV_URL=file://./data.db
   DENORITE_SERVER_SECRET=your_secret
   DENORITE_JWT_SECRET=your_jwt_secret
   RCON_HOST=localhost
   RCON_PORT=25575
   DENORITE_ADMIN_USER=your_minecraft_username
   ```

3. Start the Denorite server:
   ```bash
   deno run --allow-all main.ts
   ```

## Creating Modules

Modules are the building blocks of Denorite functionality. Each module is a TypeScript class decorated with `@Module`.

### Basic Module Structure

```typescript
// modules/HelloWorld.ts
import {
  Module,
  Command,
  Description,
  Permission,
  Argument,
  Event
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

@Module({
  name: "HelloWorld",
  version: "1.0.0",
  description: "A simple Hello World module"
})
export class HelloWorld {
  constructor(private context: ScriptContext) {}

  @Command(["hello"])
  @Description("Send a greeting to a player")
  @Permission("player")
  @Argument([
    { name: "target", type: "string", description: "Player to greet" }
  ])
  async hello(ctx: ScriptContext): Promise<{ success: boolean }> {
    const { sender, args } = ctx.params;
    const target = args.target || sender;
    
    await ctx.api.sendMessage(target, "Hello from Denorite!");
    return { success: true };
  }

  @Event("server_started")
  async handleServerStart({ log }: ScriptContext): Promise<void> {
    log("Hello World module initialized!");
  }
}
```

## Core Decorators

Denorite uses decorators to define module functionality. Here are examples from the provided modules:

### @Module

The `@Module` decorator defines a module and its metadata:

```typescript
// From Economy.ts
@Module({
  name: "Economy",
  version: "1.1.1"
})
export class Economy {
  // Module implementation
}

// From Zones.ts
@Module({
  name: "Zones",
  version: "1.0.1",
  description: "Zone management with teams and economy integration"
})
export class Zones {
  // Module implementation
}
```

### @Command

The `@Command` decorator registers a Minecraft command:

```typescript
// From Teams.ts - Simple command
@Command(["teams"])
@Description("Team management commands")
@Permission("player")
async teams({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
  // Command implementation
}

// From Economy.ts - Command with subcommand
@Command(["bank", "deposit"])
@Description("Deposit XP levels into your bank account")
@Permission("player")
@Argument([
  { name: "amount", type: "integer", description: "The amount of XP levels to deposit" }
])
async deposit({ params, kv, tellraw, api, log }: ScriptContext): Promise<{ messages: any[]; success?: boolean; newBalance?: number }> {
  // Command implementation
}
```

### @Event

The `@Event` decorator registers an event handler:

```typescript
// From ChatHelper.ts
@Event("player_joined")
async handlePlayerJoin(context: ScriptContext) {
  const { params, broadcastPlayers } = context;
  await broadcastPlayers({
    type: "chat",
    player: params.playerName,
    message: `${params.playerName} joined the game`,
    timestamp: Date.now(),
  });
}

// From Sessions.ts
@Event("player_left")
async handlePlayerLeft({ params, kv, log }: ScriptContext): Promise<void> {
  // Event handler implementation
}
```

### @Socket

The `@Socket` decorator registers a WebSocket event handler:

```typescript
// From KvHelper.ts
@Socket("kv_get_data")
@Permission("operator")
async handleGetData({ params, log, kv }: ScriptContext): Promise<{
  entries: KvEntry[];
  hasMore: boolean;
}> {
  // Socket handler implementation
}

// From Economy.ts
@Socket("socket_bank_balance")
@Permission("player")
async getSocketBalance({ params, kv }: ScriptContext): Promise<any> {
  try {
    const balance = await this.getBalance(kv, params.playerName);
    return {
      success: true,
      balance,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
```

### @Watch

The `@Watch` decorator watches for changes to KV store entries:

```typescript
@Watch({
  keys: [["player", "stats"]],
  debounce: 1000,
  initial: true
})
async handleStatsChange(ctx: ScriptContext): Promise<void> {
  const { entries } = ctx.params;
  // React to changes
}
```

### @Cron

The `@Cron` decorator schedules recurring tasks:

```typescript
@Cron("0 0 * * *") // Daily at midnight
@Description("Gives daily rewards to all players")
async dailyRewards(ctx: ScriptContext): Promise<void> {
  const players = await ctx.api.getPlayers();
  
  for (const player of players) {
    // Process daily rewards
  }
}
```

### @Online

The `@Online` decorator ensures a player is online before executing:

```typescript
// From Economy.ts
@Online()
@Command(["bank", "deposit"])
@Description("Deposit XP levels into your bank account")
@Permission("player")
@Argument([
  { name: "amount", type: "integer", description: "The amount of XP levels to deposit" }
])
async deposit({ params, kv, tellraw, api, log }: ScriptContext): Promise<{ messages: any[]; success?: boolean; newBalance?: number }> {
  // Implementation that requires player to be online
}
```

## Key Module Features

The provided modules demonstrate many powerful features of Denorite:

### Economy System (Economy.ts)

The Economy module provides a virtual currency system using XP levels:

```typescript
// Bank balance check
@Command(["bank", "balance"])
@Description("Check your bank balance")
@Permission("player")
async checkBalance({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[]; balance?: number }> {
  const { sender } = params;
  const balance = await this.getBalance(kv, sender);
  
  // UI display code
  
  return { messages, balance };
}

// Money transfer
@Command(["bank", "send"])
@Description("Send XP levels to another player")
@Permission("player")
@Argument([
  { name: "player", type: "player", description: "The player to send XPL to" },
  { name: "amount", type: "integer", description: "The amount of XPL to send" }
])
async send({ params, kv, tellraw, log }: ScriptContext): Promise<{
  messages: any[];
  success?: boolean;
  senderNewBalance?: number;
  receiverNewBalance?: number;
}> {
  // Implementation for transferring currency between players
}
```

### Team Management (Teams.ts)

The Teams module provides a rich team management system:

```typescript
// Team creation with economy integration
@Command(["teams", "create"])
@Description("Create a new team (costs 1 XPL)")
@Permission("player")
@Argument([
  { name: "name", type: "string", description: "Team name" },
  { name: "description", type: "string", description: "Team description" }
])
async createTeam({
  params,
  kv,
  api,
  tellraw,
  log,
}: ScriptContext): Promise<{ messages: any[] }> {
  // Check if player has enough XPL
  const balanceResult = await kv.get(["plugins", "economy", "balances", sender]);
  const balance = balanceResult.value ? Number(balanceResult.value) : 0;

  if (balance < this.TEAM_CREATION_COST) {
    throw new Error(`You need ${this.TEAM_CREATION_COST} XPL to create a team`);
  }
  
  // Create team and deduct cost
  // ...
}

// Team invitation system
@Command(["teams", "invite"])
@Description("Invite a player to your team")
@Permission("player")
@Argument([
  { name: "player", type: "player", description: "Player to invite" }
])
async invitePlayer({
  params,
  kv,
  tellraw,
  log,
}: ScriptContext): Promise<{ messages: any[] }> {
  // Implementation for team invitations
}
```

### Zone Protection (Zones.ts)

The Zones module provides spatial protection and management:

```typescript
// Creating a protected zone
@Command(["zones", "create"])
@Description("Create a new zone (costs 1 XPL)")
@Permission("player")
@Argument([
  { name: "name", type: "string", description: "Zone name" },
  { name: "description", type: "string", description: "Zone description" }
])
async createZone({
  params,
  kv,
  tellraw,
  api,
  rcon,
  bluemap,
  log,
}: ScriptContext): Promise<{ messages: any[] }> {
  // Zone creation implementation with spatial protection
}

// Zone teleportation
@Command(["zones", "tp"])
@Description("Teleport to a zone center")
@Permission("player")
@Argument([
  { name: "zoneId", type: "string", description: "Zone ID to teleport to" }
])
async teleportToZone({
  params,
  kv,
  tellraw,
  api,
  log,
}: ScriptContext): Promise<{ messages: any[] }> {
  // Implementation for teleporting to zones
}

// Zone map visualization
@Command(["zones", "map"])
@Description("Show an ASCII map of zones around you")
@Permission("player")
@Argument([
  {
    name: "zoom",
    type: "number",
    description: "Zoom level (1-3)",
    required: false,
    default: 2,
  }
])
async showZoneMap({
  params,
  kv,
  tellraw,
  api,
}: ScriptContext): Promise<{ messages: any[] }> {
  // Implementation for visualizing zones
}
```

### Sessions and Authentication (Sessions.ts)

The Sessions module manages player login and authentication:

```typescript
@Event("player_joined")
async handlePlayerJoined(
  { params, kv, log, tellraw }: ScriptContext
): Promise<void> {
  const { playerId, playerName, x, y, z, dimension } = params;
  const adminUsername = Deno.env.get("DENORITE_ADMIN_USER");
  const isAdmin = playerName === adminUsername;

  try {
    // Generate authentication tickets
    const playerTicket = this.generateTicket();
    const adminTicket = isAdmin ? this.generateTicket() : null;
    
    // Store player data and send welcome messages
    // ...
  } catch (error) {
    // Error handling
  }
}

@Socket("ticket_module")
async ticketAuth(
  { params, kv, auth, log }: ScriptContext
): Promise<{ success: boolean; token?: any; error?: string }> {
  // Implementation for ticket-based authentication
}
```

### Rich UI Components (from various modules)

Many modules use the tellraw-ui component system for rich in-game interfaces:

```typescript
// From Economy.ts
const balanceDisplay = container([
  text("=== Bank Balance ===", {
    style: { color: "gold", styles: ["bold"] }
  }),
  text("\nCurrent Balance: ", { style: { color: "yellow" } }),
  this.renderCurrency(balance, false),
  text("\n"),
  button("View History", {
    variant: "outline",
    onClick: {
      action: "run_command",
      value: "/bank history"
    }
  }),
  text("\n"),
  button("Return to Menu", {
    variant: "ghost",
    onClick: {
      action: "run_command",
      value: "/bank"
    }
  })
]);

// From Clockwork.ts - Status display with conditional UI
const statusDisplay = container([
  text("⏰ Clockwork Status ⏰\n", {
    style: { color: "gold", styles: ["bold"] },
  }),

  text("System: ", { style: { color: "gray" } }),
  text(`${enabled ? "Enabled" : "Disabled"}\n`, {
    style: { color: enabled ? "green" : "red" },
  }),

  text("Current Phase: ", { style: { color: "gray" } }),
  text(`${currentPhase}\n`, {
    style: { color: currentPhase === "Day" ? "yellow" : "blue" },
  }),

  divider(),
  
  // Conditional UI elements based on state
  enabled
    ? container([
        divider(),
        text("\nQuick Actions:\n", { style: { color: "gold" } }),
        button("Set Day", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork set day",
          },
        }),
        text(" "),
        button("Set Night", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork set night",
          },
        }),
        text(" "),
        button("Disable", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: "/clockwork disable",
          },
        }),
      ])
    : container([
        divider(),
        button("Enable Clockwork", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: "/clockwork enable",
          },
        }),
      ]),
]);
```

## ScriptContext API

The `ScriptContext` provides access to Denorite's functionality:

### Key-Value Storage

```typescript
// From Teams.ts - Atomic transactions
const result = await kv.atomic()
  .check(existingTeam)
  .check({
    key: ["plugins", "economy", "balances", sender],
    versionstamp: balanceResult.versionstamp,
  })
  .set(["teams", teamId], team)
  .set(["player", sender, "team"], teamId)
  .set(
    ["plugins", "economy", "balances", sender],
    new Deno.KvU64(BigInt(balance - this.TEAM_CREATION_COST)),
  )
  .commit();

// From Economy.ts - Get/Set operations
const balanceResult = await kv.get(["plugins", "economy", "balances", sender]);
const playerBalance = balanceResult.value ? Number(balanceResult.value) : 0;

await kv.set(
  ["plugins", "economy", "balances", sender],
  new Deno.KvU64(BigInt(playerBalance - amount)),
);
```

### Minecraft Interaction

```typescript
// From Zones.ts - Player teleportation
const { x, y, z } = zone.center;
await api.teleport(sender, x.toString(), y.toString(), z.toString());

// From Clockwork.ts - Command execution
await api.executeCommand("gamerule doDaylightCycle false");
await api.executeCommand(`time set ${Math.floor(newTime)}`);

// From Zones.ts - Player position
const position = await api.getPlayerPosition(sender);

// From Economy.ts - XP management
const xpLevels = await api.xpQuery(sender, "levels");
await api.xp("remove", sender, amount, "levels");
```

### Rich Text (Tellraw)

```typescript
// From Issues.ts - Using tellraw UI components
const threadContent = container([
  text(`=== ${thread.title} ===`, {
    style: { color: "gold", styles: ["bold"] },
  }),
  text(`\nBy: ${thread.author}`, { style: { color: "yellow" } }),
  text(`\nCreated: ${new Date(thread.createdAt).toLocaleString()}`, {
    style: { color: "gray" },
  }),
  text("\n\n"),
  text(thread.content, { style: { color: "white" } }),
  text("\n\n"),
  ...(owners.includes(sender) ? [] : [
    button("Buy Copy", {
      variant: "success",
      onClick: {
        action: "run_command",
        value: `/library buy ${thread.id}`,
      },
    }),
  ]),
  // Additional UI elements
]);

const messages = await tellraw(
  sender,
  threadContent.render({ platform: "minecraft", player: sender })
);

// From Paladin.ts - Direct JSON approach
messages = await tellraw("@a", JSON.stringify([
  { text: "JUSTICE SERVED\n", color: "dark_red", bold: true },
  { text: killer, color: "red" },
  { text: " has been banned for their crimes!", color: "gray" },
]));
```

### WebSocket Communication

```typescript
// From ChatHelper.ts - Broadcast to all players
await broadcastPlayers({
  type: "chat",
  player: params.playerName,
  message: `${params.playerName} joined the game`,
  timestamp: Date.now(),
});

// From Bcon.ts - Send to specific player
ctx.sendToPlayer(playerName, {
  type: "notification",
  message: "You received a gift!",
  data: { item: "diamond", count: 5 }
});
```

### Player Management

```typescript
// From Teams.ts - Check permissions
if (!team || team.leader !== sender) {
  throw new Error("Only the team leader can modify zones");
}

// From Zones.ts - Check team membership
const teamResult = await kv.get(["players", sender, "team"]);
const teamId = teamResult.value;
if (!teamId) {
  throw new Error("You must be in a team to create a zone");
}

// From Issues.ts - Send messages to multiple players
for (const member of team.members) {
  await tellraw(
    member,
    leaveMsg.render({ platform: "minecraft", player: member })
  );
}
```

### Logging

```typescript
// From various modules
log(`Player ${sender} created zone ${name} for team ${teamId}`);
log(`Thread created: ${threadId} by ${sender}`);
log(`Error in zone deletion: ${error.message}`);
```

## Best Practices

Based on analysis of the provided module examples, here are recommended best practices:

### 1. Use Atomic Transactions

Always use atomic transactions when updating multiple related values to maintain data consistency:

```typescript
// From Economy.ts - Money transfer with atomic transactions
const result = await kv.atomic()
  .set(
    ["plugins", "economy", "balances", sender],
    new Deno.KvU64(BigInt(senderBalance - totalAmount)),
  )
  .set(
    ["plugins", "economy", "balances", receiver],
    new Deno.KvU64(BigInt(receiverBalance + amount)),
  )
  .commit();

if (!result.ok) {
  throw new Error("Transfer failed. Please try again");
}
```

### 2. Standardize Error Handling

Implement consistent error handling patterns across your modules:

```typescript
// From Library.ts
try {
  // Operation that might fail
  return { messages, thread: updatedThread };
} catch (error) {
  log(`Error updating thread: ${error.message}`);
  const errorMessage = alert([], {
    variant: "destructive",
    title: "Error",
    description: error.message,
  });
  const messages = await tellraw(
    sender,
    errorMessage.render({ platform: "minecraft", player: sender })
  );
  return { messages, error: error.message };
}
```

### 3. Use UI Component System

Instead of manually constructing JSON, use the tellraw-ui component system:

```typescript
// From Clockwork.ts
const confirmMsg = container([
  text("⚠️ Reset Confirmation ⚠️\n", {
    style: { color: "red", styles: ["bold"] },
  }),
  text("This will reset all Clockwork settings to default values:\n", {
    style: { color: "yellow" },
  }),
  text("• Disable time control\n", { style: { color: "gray" } }),
  text("• Reset day/night speeds to 1.0x\n", {
    style: { color: "gray" },
  }),
  text("• Clear all custom timings\n", { style: { color: "gray" } }),
  divider(),
  button("Confirm Reset", {
    variant: "destructive",
    onClick: {
      action: "run_command",
      value: `/clockwork confirm-reset`,
    },
  }),
  text(" "),
  button("Cancel", {
    variant: "outline",
    onClick: {
      action: "run_command",
      value: `/clockwork status`,
    },
  }),
]);
```

### 4. Implement Permission Checks Early

Check permissions at the beginning of your methods to fail fast:

```typescript
// From Zones.ts
if (!team || team.leader !== sender) {
  throw new Error("Only the team leader can delete zones");
}

// From Economy.ts - Using the @Permission decorator
@Permission("player")
@Command(["bank", "deposit"])
async deposit(ctx: ScriptContext): Promise<{ success: boolean }> {
  // Command implementation for players only
}
```

### 5. Use Proper KV Structure

Organize your KV store with consistent, hierarchical keys:

```typescript
// From Sessions.ts - Well-organized key structure
private readonly KEYS = {
  PLAYER: {
    STATS: (playerName: string) => ["player", playerName, "stats"],
    SESSIONS: (playerName: string) => ["player", playerName, "sessions"],
    CURRENT_SESSION: (
      playerName: string,
    ) => ["player", playerName, "currentSession"],
    ROLE: (playerName: string) => ["player", playerName, "role"],
    PERMISSION_LEVEL: (
      playerName: string,
    ) => ["player", playerName, "permissionLevel"],
  },
  TICKETS: {
    PLAYER: (ticket: string) => ["tickets", "player", ticket],
    PLAYER_NAME: (
      playerName: string,
    ) => ["tickets", "playerName", playerName],
    ADMIN: () => ["tickets", "admin"],
    PENDING_ADMIN_SOCKET: (
      socketId: string,
    ) => ["tickets", "pending_admin_socket", socketId],
  },
  MAPPINGS: {
    NAME_TO_ID: (playerName: string) => ["playerNameToId", playerName],
    ID_TO_NAME: (playerId: string) => ["playerIdToName", playerId],
  },
};

// Using the key structure
await kv.get(this.KEYS.PLAYER.STATS(playerName));
```

### 6. Implement Graceful Cleanup

Always clean up resources in the `onUnload` method:

```typescript
// Example onUnload implementation
async onUnload(): Promise<void> {
  // Cancel any active timeouts
  for (const timeout of this.activeTimeouts) {
    clearTimeout(timeout);
  }
  
  // Close any open connections
  for (const connection of this.openConnections) {
    await connection.close();
  }
  
  // Clear any in-memory state
  this.cache.clear();
  
  this.context.info("Module resources cleaned up");
}
```

## Conclusion

Denorite provides a powerful, modern framework for extending Minecraft servers with TypeScript. By leveraging Deno's security-focused runtime and TypeScript's type safety, you can create robust, maintainable plugins that enhance your Minecraft server's functionality.

The module-based architecture, combined with decorators for commands, events, and socket handlers, makes it easy to organize and extend your code. Whether you're building simple utilities or complex game mechanics, Denorite offers the tools to bring your ideas to life.

## Additional Resources

- [Deno Documentation](https://deno.land/manual)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Minecraft Commands Reference](https://minecraft.fandom.com/wiki/Commands)
- [JWT Authentication](https://jwt.io/introduction)
