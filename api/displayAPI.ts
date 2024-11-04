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

export function createDisplayAPI(sendToMinecraft: SendToMinecraft, log: LogFunction) {
  const consoles = new Map<string, DisplayConsole>();
  const DEFAULT_OPTIONS: Required<ConsoleOptions> = {
    width: 200,
    height: 10,
    backgroundColor: 0xFF000000, // Black background with full opacity
    textColor: "§a" // Minecraft color code for green
  };

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
      consoles.set(id, consoleObject);
      log(`Created console object in memory for ${id}`);

      // Create the display entity
      const nbt = {
        text: '{"text":""}',
        background: config.backgroundColor,
        default_background: false,
        line_width: config.width,
        see_through: false,
        alignment: "left",
        Tags: ["display_console", `console_${id}`] // Add unique tag per console
      };

      const command = `summon text_display ${x} ${y} ${z} {${Object.entries(nbt)
        .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
        .join(',')}}`;

      await executeCommand(command);
      log(`Display API created entity for console ${id}`);
    },

    async log(id: string, message: string): Promise<void> {
      log(`Display API logging to console ${id}: ${message}`);

      const consoleObject = consoles.get(id);
      if (!consoleObject) {
        log(`Display API: Console ${id} not found in internal state`);
        const availableConsoles = Array.from(consoles.keys()).join(', ');
        log(`Available consoles: ${availableConsoles}`);
        throw new Error(`Console with ID ${id} not found`);
      }

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

      const consoleObject = consoles.get(id);
      if (!consoleObject) {
        throw new Error(`Console with ID ${id} not found`);
      }

      consoleObject.lines = [];
      await executeCommand(`data modify entity @e[type=text_display,tag=console_${id},limit=1] text set value '{"text":""}'`);
    },

    async remove(id: string): Promise<void> {
      log(`Display API removing console ${id}`);

      const consoleObject = consoles.get(id);
      if (!consoleObject) {
        throw new Error(`Console with ID ${id} not found`);
      }

      await executeCommand(`kill @e[type=text_display,tag=console_${id},limit=1]`);
      consoles.delete(id);
    },

    async setPosition(id: string, x: number, y: number, z: number): Promise<void> {
      log(`Display API moving console ${id} to ${x},${y},${z}`);

      const consoleObject = consoles.get(id);
      if (!consoleObject) {
        throw new Error(`Console with ID ${id} not found`);
      }

      await executeCommand(`tp @e[type=text_display,tag=console_${id},limit=1] ${x} ${y} ${z}`);

      consoleObject.x = x;
      consoleObject.y = y;
      consoleObject.z = z;
    },

    async resize(id: string, width: number, height: number): Promise<void> {
      log(`Display API resizing console ${id} to ${width}x${height}`);

      const consoleObject = consoles.get(id);
      if (!consoleObject) {
        throw new Error(`Console with ID ${id} not found`);
      }

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
      return consoles.has(id);
    },

    getConsole(id: string): DisplayConsole | undefined {
      return consoles.get(id);
    },

    listConsoles(): string[] {
      return Array.from(consoles.keys());
    }
  };
}
