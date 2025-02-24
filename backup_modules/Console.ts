import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";

interface ConsoleState {
  id: string;
  owner: string;
  isPublic: boolean;
  created: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
}

@Module({
  name: "ConsoleManager",
  version: "1.0.0",
})
export class ConsoleManager {
  private readonly consoleStates = new Map<string, ConsoleState>();
  private initialized = false;

  private async saveConsoleState(
    context: ScriptContext,
    state: ConsoleState,
  ): Promise<void> {
    await context.kv.set(["consoles", "state", state.id], state);
    context.log(`Saved state for console ${state.id}`);
  }

  private async loadConsoleStates(context: ScriptContext): Promise<void> {
    context.log("Loading console states from storage...");

    const iterator = context.kv.list<ConsoleState>({
      prefix: ["consoles", "state"],
    });
    const states: ConsoleState[] = [];

    for await (const { value: state } of iterator) {
      states.push(state);
    }

    context.log(`Found ${states.length} consoles to restore`);

    // Clear existing states
    this.consoleStates.clear();

    // Restore each console
    for (const state of states) {
      try {
        context.log(`Restoring console ${state.id}`);
        this.consoleStates.set(state.id, state);

        await context.display.createConsole(
          state.id,
          state.position.x,
          state.position.y,
          state.position.z,
        );

        // Add initial message to show successful restoration
        await context.display.log(
          state.id,
          `Console restored at ${new Date().toISOString()}`,
        );
        await context.display.log(
          state.id,
          `Owner: ${state.owner}, Status: ${
            state.isPublic ? "Public" : "Private"
          }`,
        );

        context.log(`Successfully restored console ${state.id}`);
      } catch (error) {
        context.log(`Failed to restore console ${state.id}: ${error}`);
        this.consoleStates.delete(state.id);
      }
    }
  }

  @Event("server_started")
  async handleServerStart(context: ScriptContext): Promise<void> {
    context.log("Starting Console Manager initialization...");
    try {
      // Kill any existing display consoles to avoid duplicates
      await context.api.executeCommand(
        "kill @e[type=text_display,tag=display_console]",
      );
      context.log("Cleaned up existing display entities");

      await this.loadConsoleStates(context);
      this.initialized = true;
      context.log("Console Manager initialization completed successfully");
    } catch (error) {
      context.log(`Error during initialization: ${error}`);
      throw error;
    }
  }

  @Command(["console", "create"])
  @Description("Create a new console display")
  @Permission("operator")
  @Argument([{
    name: "id",
    type: "string",
    description: "Unique identifier for the console",
  }, {
    name: "public",
    type: "string",
    description: "Whether the console is publicly viewable",
  }])
  async createConsole(
    { params, kv, api, display, log }: ScriptContext,
  ): Promise<void> {
    const { args, sender } = params;
    const { id = "main", public: isPublic = false } = args;

    if (this.consoleStates.has(id)) {
      if (display.hasConsole(id)) {
        throw new Error(`Console with ID ${id} already exists`);
      } else {
        // State exists but display doesn't - clean up and recreate
        this.consoleStates.delete(id);
        await kv.delete(["consoles", "state", id]);
      }
    }

    const playerPos = await api.getPlayerPosition(sender);
    const consolePos = {
      x: playerPos.x + 2,
      y: playerPos.y + 1,
      z: playerPos.z,
    };

    log(
      `Creating console ${id} at position ${consolePos.x}, ${consolePos.y}, ${consolePos.z}`,
    );

    const state: ConsoleState = {
      id,
      owner: sender,
      isPublic,
      created: new Date().toISOString(),
      position: consolePos,
    };

    // Create display first
    await display.createConsole(id, consolePos.x, consolePos.y, consolePos.z);

    // If display creation succeeded, save state
    this.consoleStates.set(id, state);
    await this.saveConsoleState({ kv, log } as ScriptContext, state);

    // Log initial messages
    await display.log(id, `Console ${id} created by ${sender}`);
    await display.log(id, `Status: ${isPublic ? "Public" : "Private"}`);

    log(`Successfully created console ${id}`);
  }

  @Command(["console", "remove"])
  @Description("Remove a console display")
  @Permission("operator")
  @Argument([{
    name: "id",
    type: "string",
    description: "Console identifier to remove",
  }])
  async removeConsole(
    { params, kv, api, display }: ScriptContext,
  ): Promise<void> {
    const { args, sender } = params;
    const { id } = args;
    const state = this.consoleStates.get(id);

    if (!state) {
      throw new Error(`Console ${id} not found`);
    }

    if (state.owner !== sender) {
      throw new Error("You can only remove consoles you own");
    }

    await display.remove(id);
    this.consoleStates.delete(id);
    await kv.delete(["consoles", "state", id]);

    await api.tellraw(
      sender,
      `{"text":"Console ${id} removed","color":"green"}`,
    );
  }

  @Command(["console", "list"])
  @Description("List all available consoles")
  @Permission("player")
  async listConsoles({ params, api }: ScriptContext): Promise<void> {
    const { sender } = params;
    const consoles = Array.from(this.consoleStates.values())
      .filter((state) => state.isPublic || state.owner === sender)
      .map((state) =>
        `${state.id} (Owner: ${state.owner}, ${
          state.isPublic ? "Public" : "Private"
        })`
      );

    if (consoles.length === 0) {
      await api.tellraw(
        sender,
        `{"text":"No consoles available","color":"yellow"}`,
      );
      return;
    }

    await api.tellraw(sender, `{"text":"Available consoles:","color":"green"}`);
    for (const console of consoles) {
      await api.tellraw(sender, `{"text":"- ${console}","color":"white"}`);
    }
  }

  @Command(["console", "log"])
  @Description("Log a message to a console")
  @Permission("player")
  @Argument([
    { name: "id", type: "string", description: "Console identifier" },
    { name: "message", type: "string", description: "Message to log" },
  ])
  async logToConsole({ params, display, log }: ScriptContext): Promise<void> {
    const { sender, args } = params;
    const { id, message } = args;

    log(`Attempting to log to console ${id}`);
    const state = this.consoleStates.get(id);

    if (!state) {
      throw new Error(`Console ${id} not found in state manager`);
    }

    if (!state.isPublic && state.owner !== sender) {
      throw new Error("You do not have permission to log to this console");
    }

    log(`Sending log message to display API for console ${id}`);
    await display.log(id, `[${sender}] ${message}`);
  }

  @Command(["console", "clear"])
  @Description("Clear a console display")
  @Permission("player")
  @Argument([{
    name: "id",
    type: "string",
    description: "Console identifier to clear",
  }])
  async clearConsole({ params, display }: ScriptContext): Promise<void> {
    const { args, sender } = params;
    const { id } = args;
    const state = this.consoleStates.get(id);

    if (!state) {
      throw new Error(`Console ${id} not found`);
    }

    if (!state.isPublic && state.owner !== sender) {
      throw new Error("You do not have permission to clear this console");
    }

    await display.clear(id);
    await display.log(id, `Console cleared by ${sender}`);
  }

  @Command(["console", "move"])
  @Description("Move a console to your current position")
  @Permission("operator")
  @Argument([{
    name: "id",
    type: "string",
    description: "Console identifier to move",
  }])
  async moveConsole(
    { params, api, kv, display, log }: ScriptContext,
  ): Promise<void> {
    const { args, sender } = params;
    const { id } = args;
    const state = this.consoleStates.get(id);

    if (!state) {
      throw new Error(`Console ${id} not found`);
    }

    if (state.owner !== sender) {
      throw new Error("You can only move consoles you own");
    }

    // Get player position
    const playerPos = await api.getPlayerPosition(sender);
    const newPos = {
      x: playerPos.x + 2,
      y: playerPos.y + 1,
      z: playerPos.z,
    };

    log(
      `Moving console ${id} to position ${newPos.x}, ${newPos.y}, ${newPos.z}`,
    );

    await display.setPosition(id, newPos.x, newPos.y, newPos.z);

    // Update state
    state.position = newPos;
    this.consoleStates.set(id, state);
    await this.saveConsoleState({ kv, log } as ScriptContext, state);

    await display.log(id, `Console moved by ${sender}`);
    log(`Successfully moved console ${id}`);
  }

  @Command(["console", "resize"])
  @Description("Resize a console display")
  @Permission("operator")
  @Argument([
    { name: "id", type: "string", description: "Console identifier to resize" },
    { name: "width", type: "number", description: "New width (in pixels)" },
    { name: "height", type: "number", description: "New height (in lines)" },
  ])
  async resizeConsole(
    { params, display, kv, log }: ScriptContext,
  ): Promise<void> {
    const { args, sender } = params;
    const { id, width, height } = args;
    const state = this.consoleStates.get(id);

    if (!state) {
      throw new Error(`Console ${id} not found`);
    }

    if (state.owner !== sender) {
      throw new Error("You can only resize consoles you own");
    }

    if (width < 50 || width > 500 || height < 1 || height > 20) {
      throw new Error("Invalid dimensions. Width: 50-500, Height: 1-20");
    }

    log(`Resizing console ${id} to ${width}x${height}`);
    await display.resize(id, width, height);
    await display.log(id, `Console resized by ${sender} (${width}x${height})`);
    log(`Successfully resized console ${id}`);
  }

  // Event handlers for automatic logging
  @Event("player_joined")
  async handlePlayerJoin(
    { params, display, log }: ScriptContext,
  ): Promise<void> {
    // Log to all public consoles
    for (const [id, state] of this.consoleStates.entries()) {
      if (state.isPublic) {
        log(`Logging player join event to console ${id}`);
        await display.log(id, `Player joined: ${params.playerName}`);
      }
    }
  }

  @Event("player_left")
  async handlePlayerLeave(
    { params, display, log }: ScriptContext,
  ): Promise<void> {
    for (const [id, state] of this.consoleStates.entries()) {
      if (state.isPublic) {
        log(`Logging player leave event to console ${id}`);
        await display.log(id, `Player left: ${params.playerName}`);
      }
    }
  }

  @Event("player_death")
  async handlePlayerDeath(
    { params, display, log }: ScriptContext,
  ): Promise<void> {
    for (const [id, state] of this.consoleStates.entries()) {
      if (state.isPublic) {
        log(`Logging player death event to console ${id}`);
        await display.log(id, params.deathMessage);
      }
    }
  }
}
