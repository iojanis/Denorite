import type {Api, LogFunction, SendToMinecraft} from "../types.d.ts";

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

// Create a truly static Map that persists across multiple createDisplayAPI calls
const GLOBAL_CONSOLES = new Map<string, DisplayConsole>();

const DEFAULT_OPTIONS: Required<ConsoleOptions> = {
  width: 200,
  height: 10,
  backgroundColor: 0xFF000000, // Black background with full opacity
  textColor: "§a" // Minecraft color code for green
};

export function createDisplayAPI(sendToMinecraft: SendToMinecraft, log: LogFunction) {
  async function executeCommand(command: string): Promise<string> {
    try {
      const result = await sendToMinecraft({ type: 'command', data: command });
      log(`Display API executed command: ${command}`);
      if (typeof result.result === 'string') {
        return result.result;
      }
      throw new Error(`Unexpected result format: ${JSON.stringify(result)}`);
    } catch (error) {
      log(`Display API command error: ${error}`);
      throw error;
    }
  }

  async function verifyConsoleExists(id: string): Promise<DisplayConsole> {
    const consoleObject = GLOBAL_CONSOLES.get(id);
    if (!consoleObject) {
      // Try to verify if the entity exists in the game before throwing error
      const result = await executeCommand(`data get entity @e[type=text_display,tag=console_${id},limit=1]`);
      if (result.includes("No entity was found")) {
        log(`Available consoles: ${Array.from(GLOBAL_CONSOLES.keys()).join(', ')}`);
        throw new Error(`Console with ID ${id} not found`);
      }
      // If entity exists but not in our state, recreate the state
      log(`Reconstructing state for existing console ${id}`);
      const newConsole: DisplayConsole = {
        id,
        x: 0, // These will be approximate
        y: 0,
        z: 0,
        width: DEFAULT_OPTIONS.width,
        height: DEFAULT_OPTIONS.height,
        lines: []
      };
      GLOBAL_CONSOLES.set(id, newConsole);
      return newConsole;
    }
    return consoleObject;
  }

  return {
    async createConsole(id: string, x: number, y: number, z: number, options: ConsoleOptions = {}): Promise<void> {
      log(`Display API creating console ${id} at ${x},${y},${z}`);

      const config = { ...DEFAULT_OPTIONS, ...options };

      // Create or update console object
      const consoleObject: DisplayConsole = {
        id,
        x,
        y,
        z,
        width: config.width,
        height: config.height,
        lines: []
      };

      // Store in internal map first
      GLOBAL_CONSOLES.set(id, consoleObject);
      log(`Created console object in memory for ${id}`);

      // Create the display entity
      const nbt = {
        text: '{"text":""}',
        background: config.backgroundColor,
        default_background: false,
        line_width: config.width,
        see_through: false,
        alignment: "left",
        Tags: ["display_console", `console_${id}`]
      };

      const command = `summon text_display ${x} ${y} ${z} {${Object.entries(nbt)
        .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
        .join(',')}}`;

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

      const displayText = consoleObject.lines
        .map(line => DEFAULT_OPTIONS.textColor + line)
        .join('\n');

      // Use the unique tag for targeting
      const command = `data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":"${displayText}"}'`;
      await executeCommand(command);
      log(`Display API updated console ${id} text`);
    },

    async clear(id: string): Promise<void> {
      log(`Display API clearing console ${id}`);

      const consoleObject = await verifyConsoleExists(id);
      consoleObject.lines = [];
      await executeCommand(`data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":""}'`);
    },

    async remove(id: string): Promise<void> {
      log(`Display API removing console ${id}`);

      await verifyConsoleExists(id);
      await executeCommand(`kill @e[type=text_display,tag=console_${id},limit=1]`);
      GLOBAL_CONSOLES.delete(id);
    },

    async setPosition(id: string, x: number, y: number, z: number): Promise<void> {
      log(`Display API moving console ${id} to ${x},${y},${z}`);

      const consoleObject = await verifyConsoleExists(id);
      await executeCommand(`tp @e[type=text_display,tag=console_${id},limit=1] ${x} ${y} ${z}`);

      consoleObject.x = x;
      consoleObject.y = y;
      consoleObject.z = z;
    },

    async resize(id: string, width: number, height: number): Promise<void> {
      log(`Display API resizing console ${id} to ${width}x${height}`);

      const consoleObject = await verifyConsoleExists(id);
      consoleObject.width = width;
      consoleObject.height = height;

      if (consoleObject.lines.length > height) {
        consoleObject.lines = consoleObject.lines.slice(-height);
      }

      await executeCommand(`data modify entity @e[type=text_display,tag=console_${id},limit=1] line_width set value ${width}`);

      const displayText = consoleObject.lines
        .map(line => DEFAULT_OPTIONS.textColor + line)
        .join('\n');

      await executeCommand(`data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":"${displayText}"}'`);
    },

    hasConsole(id: string): boolean {
      return GLOBAL_CONSOLES.has(id);
    },

    getConsole(id: string): DisplayConsole | undefined {
      return GLOBAL_CONSOLES.get(id);
    },

    listConsoles(): string[] {
      return Array.from(GLOBAL_CONSOLES.keys());
    }
  };
}
