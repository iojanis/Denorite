import type { Api, LogFunction, SendToMinecraft } from "../types.d.ts";

interface DisplayConsole {
  id: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  lines: string[];
}

interface ConsoleOptions {
  width?: number;
  height?: number;
  backgroundColor?: number;
  textColor?: string;
}

// Static cache and constants at module level
const CONSOLE_CACHE = new Map<string, DisplayConsole>();

const DEFAULT_OPTIONS: Required<ConsoleOptions> = {
  width: 200,
  height: 10,
  backgroundColor: 0xFF000000,
  textColor: "§a",
};

// Also track if we've done initial load
let hasLoadedFromKV = false;

export function createDisplayAPI(
  sendToMinecraft: SendToMinecraft,
  log: LogFunction,
  kv: Deno.Kv,
) {
  async function loadFromKV(id: string): Promise<DisplayConsole | null> {
    const result = await kv.get<DisplayConsole>(["display_consoles", id]);
    return result.value;
  }

  async function saveToKV(console: DisplayConsole): Promise<void> {
    await kv.set(["display_consoles", console.id], console);
    log(`Saved console ${console.id} to KV storage`);
  }

  async function executeCommand(command: string): Promise<string> {
    try {
      const result = await sendToMinecraft({ type: "command", data: command });
      log(`Display API executed command: ${command}`);
      if (typeof result.result === "string") {
        return result.result;
      }
      throw new Error(`Unexpected result format: ${JSON.stringify(result)}`);
    } catch (error) {
      log(`Display API command error: ${error}`);
      throw error;
    }
  }

  async function verifyConsoleExists(id: string): Promise<DisplayConsole> {
    // Check static cache first
    let consoleObject = CONSOLE_CACHE.get(id);

    if (!consoleObject) {
      // Try loading from KV storage
      consoleObject = await loadFromKV(id);

      if (!consoleObject) {
        // Verify if entity exists in game
        const result = await executeCommand(
          `data get entity @e[type=text_display,tag=console_${id},limit=1]`,
        );
        if (result.includes("No entity was found")) {
          log(
            `Available consoles: ${
              Array.from(CONSOLE_CACHE.keys()).join(", ")
            }`,
          );
          throw new Error(`Console with ID ${id} not found`);
        }

        // If entity exists but no state, recreate state
        log(`Reconstructing state for existing console ${id}`);
        consoleObject = {
          id,
          x: 0,
          y: 0,
          z: 0,
          width: DEFAULT_OPTIONS.width,
          height: DEFAULT_OPTIONS.height,
          lines: [],
        };

        // Save reconstructed state
        CONSOLE_CACHE.set(id, consoleObject);
        await saveToKV(consoleObject);
      } else {
        // Add loaded console to cache
        CONSOLE_CACHE.set(id, consoleObject);
      }
    }

    return consoleObject;
  }

  async function loadAllConsoles(): Promise<void> {
    if (hasLoadedFromKV) {
      return; // Skip if we've already loaded
    }

    const iterator = kv.list<DisplayConsole>({ prefix: ["display_consoles"] });
    for await (const entry of iterator) {
      if (entry.value) {
        CONSOLE_CACHE.set(entry.value.id, entry.value);
        log(`Loaded console ${entry.value.id} from KV storage`);
      }
    }
    hasLoadedFromKV = true;
  }

  // Initial load of consoles from KV
  loadAllConsoles().catch((error) => {
    log(`Error loading consoles from KV: ${error}`);
  });

  return {
    async createConsole(
      id: string,
      x: number,
      y: number,
      z: number,
      options: ConsoleOptions = {},
    ): Promise<void> {
      log(`Display API creating console ${id} at ${x},${y},${z}`);

      const config = { ...DEFAULT_OPTIONS, ...options };

      const consoleObject: DisplayConsole = {
        id,
        x,
        y,
        z,
        width: config.width,
        height: config.height,
        lines: [],
      };

      // Store in both cache and KV
      CONSOLE_CACHE.set(id, consoleObject);
      await saveToKV(consoleObject);
      log(`Created console object in memory for ${id}`);

      const nbt = {
        text: '{"text":""}',
        background: config.backgroundColor,
        default_background: false,
        line_width: config.width,
        see_through: false,
        alignment: "left",
        Tags: ["display_console", `console_${id}`],
      };

      const command = `summon text_display ${x} ${y} ${z} {${
        Object.entries(nbt)
          .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
          .join(",")
      }}`;

      await executeCommand(command);
      log(`Display API created entity for console ${id}`);
    },

    async log(id: string, message: string): Promise<void> {
      log(`Display API logging to console ${id}: ${message}`);

      const consoleObject = await verifyConsoleExists(id);

      // Update lines
      consoleObject.lines.push(message);
      if (consoleObject.lines.length > consoleObject.height) {
        consoleObject.lines.shift();
      }

      // Save updated state
      await saveToKV(consoleObject);

      const displayText = consoleObject.lines
        .map((line) => DEFAULT_OPTIONS.textColor + line)
        .join("\n");

      const command =
        `data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":"${displayText}"}'`;
      await executeCommand(command);
      log(`Display API updated console ${id} text`);
    },

    async clear(id: string): Promise<void> {
      log(`Display API clearing console ${id}`);

      const consoleObject = await verifyConsoleExists(id);
      consoleObject.lines = [];

      // Save cleared state
      await saveToKV(consoleObject);

      await executeCommand(
        `data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":""}'`,
      );
    },

    async remove(id: string): Promise<void> {
      log(`Display API removing console ${id}`);

      await verifyConsoleExists(id);
      await executeCommand(
        `kill @e[type=text_display,tag=console_${id},limit=1]`,
      );

      // Remove from both cache and KV
      CONSOLE_CACHE.delete(id);
      await kv.delete(["display_consoles", id]);
    },

    async setPosition(
      id: string,
      x: number,
      y: number,
      z: number,
    ): Promise<void> {
      log(`Display API moving console ${id} to ${x},${y},${z}`);

      const consoleObject = await verifyConsoleExists(id);
      await executeCommand(
        `tp @e[type=text_display,tag=console_${id},limit=1] ${x} ${y} ${z}`,
      );

      consoleObject.x = x;
      consoleObject.y = y;
      consoleObject.z = z;

      // Save updated position
      await saveToKV(consoleObject);
    },

    async resize(id: string, width: number, height: number): Promise<void> {
      log(`Display API resizing console ${id} to ${width}x${height}`);

      const consoleObject = await verifyConsoleExists(id);
      consoleObject.width = width;
      consoleObject.height = height;

      if (consoleObject.lines.length > height) {
        consoleObject.lines = consoleObject.lines.slice(-height);
      }

      // Save updated dimensions
      await saveToKV(consoleObject);

      await executeCommand(
        `data modify entity @e[type=text_display,tag=console_${id},limit=1] line_width set value ${width}`,
      );

      const displayText = consoleObject.lines
        .map((line) => DEFAULT_OPTIONS.textColor + line)
        .join("\n");

      await executeCommand(
        `data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":"${displayText}"}'`,
      );
    },

    hasConsole(id: string): boolean {
      return CONSOLE_CACHE.has(id);
    },

    getConsole(id: string): DisplayConsole | undefined {
      return CONSOLE_CACHE.get(id);
    },

    listConsoles(): string[] {
      return Array.from(CONSOLE_CACHE.keys());
    },
  };
}
