import type { Api, LogFunction, SendToMinecraft } from "../types.d.ts";

// Helper function to parse string values into appropriate types
export function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.match(/^-?\d+$/)) return parseInt(value, 10);
  if (value.match(/^-?\d*\.\d+$/)) return parseFloat(value);
  return value.replace(/^"|"$/g, ""); // Remove surrounding quotes if present
}

export function createMinecraftAPI(
  sendToMinecraft: SendToMinecraft,
  log: LogFunction,
): Api {
  async function executeCommand(command: string): Promise<string> {
    const errorPatterns: [RegExp, string][] = [
      [/Unknown or incomplete command/, "Unknown or incomplete command"],
      [/Incorrect argument for command/, "Incorrect argument for command"],
      [/No player was found|That player does not exist/, "Player not found"],
      [/You don't have permission/, "Insufficient permissions"],
      [/Player is not online/, "Player is not online"],
      [/Unknown (item|block|entity)/, "Unknown game element"],
      [
        /Invalid (position|number|game mode|difficulty|effect|enchantment|scoreboard objective|team|selector|JSON|UUID|time|dimension|biome|structure|advancement|recipe|loot table|bossbar|attribute|particle|sound|function|datapack)/,
        "Invalid command parameter",
      ],
    ];

    try {
      const result = await sendToMinecraft({ type: "command", data: command });
      // log(`Command result: ${JSON.stringify(result)}`);

      // Check if the result is a string (which seems to be the case now)
      if (typeof result.result === "string") {
        const resultString = result.result;

        // Check for error patterns in the result string
        for (const [pattern, message] of errorPatterns) {
          if (pattern.test(resultString)) {
            throw new Error(`${message}: ${command}`);
          }
        }

        // If no error patterns match, return the result
        return resultString;
      }

      // If result is not a string, throw an error
      throw new Error(`Unexpected result format: ${JSON.stringify(result)}`);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Unknown error occurred while executing command: ${command}`,
      );
    }
  }

  return {
    executeCommand(command: string): Promise<string> {
      return new Promise((resolve) => "sdsd");
    },

    async xp(mode, target, amount, type = "points") {
      let command = "";
      switch (mode) {
        case "get":
          command = `xp query ${target} ${type.toLowerCase()}`;
          break;
        case "set":
          command = `xp set ${target} ${amount} ${type.toLowerCase()}`;
          break;
        case "add":
          command = `xp add ${target} ${amount} ${type.toLowerCase()}`;
          break;
        case "remove":
          command = `xp add ${target} -${amount} ${type.toLowerCase()}`;
          break;
      }

      const result = await sendToMinecraft({ type: "command", data: command });
      // log(`XP command result: ${JSON.stringify(result)}`);

      if (result.error) {
        throw new Error(result.error);
      }

      const regex = /(\d+)/;
      const match = result.result.match(regex);
      return match ? match[1] : result.result;
    },

    async teleport(target, x, y, z) {
      const command = `tp ${target} ${x} ${y} ${z}`;
      const result = await sendToMinecraft({ type: "command", data: command });
      // log(`Teleport command result: ${JSON.stringify(result)}`);

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result;
    },

    async give(target, item, amount = 1) {
      const command = `give ${target} ${item} ${amount}`;
      const result = await sendToMinecraft({ type: "command", data: command });
      // log(`Give command result: ${JSON.stringify(result)}`);

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result;
    },

    async clear(
      target: string,
      item?: string,
      maxCount?: number,
    ): Promise<string> {
      let command = `clear ${target}`;
      if (item) command += ` ${item}`;
      if (maxCount !== undefined) command += ` ${maxCount}`;
      const result = await executeCommand(command);
      const regex = /Removed (\d+) items? from player (\w+)/;
      const match = result.match(regex);
      return match ? `${match[2]}: -${match[1]}` : result;
    },

    async setBlock(x, y, z, block) {
      const command = `setblock ${x} ${y} ${z} ${block}`;
      const result = await sendToMinecraft({ type: "command", data: command });
      // log(`SetBlock command result: ${JSON.stringify(result)}`);

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result;
    },

    async executeAs(target, command) {
      const fullCommand = `execute as ${target} run ${command}`;
      const result = await sendToMinecraft({
        type: "command",
        data: fullCommand,
      });
      // log(`Execute command result: ${JSON.stringify(result)}`);

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result;
    },

    async getPlayerPosition(player) {
      const command = `data get entity ${player} Pos`;
      const result = await sendToMinecraft({ type: "command", data: command });
      log(`Get player position result: ${JSON.stringify(result)}`);

      if (result.error) {
        throw new Error(result.error);
      }

      const regex = /\[([-\d.]+)d, ([-\d.]+)d, ([-\d.]+)d\]/;
      const match = result.result.match(regex);
      if (match) {
        return {
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
          z: parseFloat(match[3]),
        };
      } else {
        throw new Error("Failed to parse player position");
      }
    },

    async kill(target: string): Promise<string> {
      return await executeCommand(`kill ${target}`);
    },

    async weather(
      type: "clear" | "rain" | "thunder",
      duration?: number,
    ): Promise<string> {
      const command = duration
        ? `weather ${type} ${duration}`
        : `weather ${type}`;
      return await executeCommand(command);
    },

    async time(
      action: "set" | "add",
      value: number | "day" | "night",
    ): Promise<string> {
      return await executeCommand(`time ${action} ${value}`);
    },

    async gamemode(
      mode: "survival" | "creative" | "adventure" | "spectator",
      target?: string,
    ): Promise<string> {
      const command = target
        ? `gamemode ${mode} ${target}`
        : `gamemode ${mode}`;
      return await executeCommand(command);
    },

    async effect(
      action: "give" | "clear",
      target: string,
      effect?: string,
      duration?: number,
      amplifier?: number,
    ): Promise<string> {
      let command = `effect ${action} ${target}`;
      if (action === "give" && effect) {
        command += ` ${effect}`;
        if (duration !== undefined) command += ` ${duration}`;
        if (amplifier !== undefined) command += ` ${amplifier}`;
      }
      return await executeCommand(command);
    },

    async enchant(
      target: string,
      enchantment: string,
      level?: number,
    ): Promise<string> {
      const command = level
        ? `enchant ${target} ${enchantment} ${level}`
        : `enchant ${target} ${enchantment}`;
      return await executeCommand(command);
    },

    async summon(
      entity: string,
      x: number,
      y: number,
      z: number,
      nbt?: string,
    ): Promise<string> {
      const command = nbt
        ? `summon ${entity} ${x} ${y} ${z} ${nbt}`
        : `summon ${entity} ${x} ${y} ${z}`;
      return await executeCommand(command);
    },

    async setWorldSpawn(x: number, y: number, z: number): Promise<string> {
      return await executeCommand(`setworldspawn ${x} ${y} ${z}`);
    },

    async spawnPoint(
      target: string,
      x: number,
      y: number,
      z: number,
    ): Promise<string> {
      return await executeCommand(`spawnpoint ${target} ${x} ${y} ${z}`);
    },

    async difficulty(
      level: "peaceful" | "easy" | "normal" | "hard",
    ): Promise<string> {
      return await executeCommand(`difficulty ${level}`);
    },

    async getBlockData(
      x: number,
      y: number,
      z: number,
    ): Promise<Record<string, unknown>> {
      const result = await executeCommand(`data get block ${x} ${y} ${z}`);
      const nbtRegex = /{.*}/s;
      const match = result.match(nbtRegex);
      if (match) {
        try {
          return JSON.parse(match[0].replace(/(\w+):/g, '"$1":'));
        } catch (_error) {
          throw new Error("Failed to parse block data");
        }
      }
      throw new Error("No block data found");
    },

    async getEntityData(
      target: string,
      path?: string,
    ): Promise<Record<string, unknown>> {
      const command = path
        ? `data get entity ${target} ${path}`
        : `data get entity ${target}`;

      const result = await executeCommand(command);

      if (path) {
        // If a path is provided, the result might be a simple value or a nested object
        const simpleValueRegex = /: (.+)$/;
        const match = result.match(simpleValueRegex);
        if (match) {
          const value = match[1].trim();
          try {
            // Attempt to parse as JSON if it looks like an object or array
            if (value.startsWith("{") || value.startsWith("[")) {
              return JSON.parse(value.replace(/(\w+):/g, '"$1":'));
            }
            // Otherwise, return as a simple key-value pair
            return { [path.split(".").pop()!]: this.parseValue(value) };
          } catch (_error) {
            throw new Error("Failed to parse entity data");
          }
        }
      }

      // If no path is provided or the path result is complex, use the original NBT parsing
      const nbtRegex = /{.*}/s;
      const match = result.match(nbtRegex);
      if (match) {
        try {
          return JSON.parse(match[0].replace(/(\w+):/g, '"$1":'));
        } catch (_error) {
          throw new Error("Failed to parse entity data");
        }
      }

      throw new Error("No entity data found");
    },

    async fill(
      x1: number,
      y1: number,
      z1: number,
      x2: number,
      y2: number,
      z2: number,
      block: string,
      mode?: "replace" | "destroy" | "hollow" | "keep" | "outline",
    ): Promise<string> {
      let command = `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`;
      if (mode) command += ` ${mode}`;
      return await executeCommand(command);
    },

    async clone(
      x1: number,
      y1: number,
      z1: number,
      x2: number,
      y2: number,
      z2: number,
      x: number,
      y: number,
      z: number,
      maskMode?: "replace" | "masked",
      cloneMode?: "force" | "move" | "normal",
    ): Promise<string> {
      let command = `clone ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${x} ${y} ${z}`;
      if (maskMode) command += ` ${maskMode}`;
      if (cloneMode) command += ` ${cloneMode}`;
      return await executeCommand(command);
    },

    async getScoreboardPlayers(): Promise<Record<string, number>> {
      const result = await executeCommand(`scoreboard players list`);
      const players: Record<string, number> = {};
      const regex = /(\w+): (\d+)/g;
      let match;
      while ((match = regex.exec(result)) !== null) {
        players[match[1]] = parseInt(match[2]);
      }
      return players;
    },

    setScoreboardPlayer(
      player: string,
      objective: string,
      score: number,
    ): Promise<string> {
      return executeCommand(
        `scoreboard players set ${player} ${objective} ${score}`,
      );
    },

    addScoreboardPlayer(
      player: string,
      objective: string,
      score: number,
    ): Promise<string> {
      return executeCommand(
        `scoreboard players add ${player} ${objective} ${score}`,
      );
    },

    removeScoreboardPlayer(
      player: string,
      objective: string,
      score: number,
    ): Promise<string> {
      return executeCommand(
        `scoreboard players remove ${player} ${objective} ${score}`,
      );
    },

    async scoreboardObjectives(): Promise<string[]> {
      const result = await executeCommand("scoreboard objectives list");
      const regex = /- ([\w.]+):/g;
      const objectives: string[] = [];
      let match;
      while ((match = regex.exec(result)) !== null) {
        objectives.push(match[1]);
      }
      return objectives;
    },

    async scoreboardObjectiveAdd(
      objective: string,
      criteria: string,
      displayName?: string,
    ): Promise<string> {
      const command = displayName
        ? `scoreboard objectives add ${objective} ${criteria} ${
          JSON.stringify(displayName)
        }`
        : `scoreboard objectives add ${objective} ${criteria}`;
      const result = await executeCommand(command);
      const regex = /Added new objective '(\w+)'/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async scoreboardObjectiveRemove(objective: string): Promise<string> {
      const result = await executeCommand(
        `scoreboard objectives remove ${objective}`,
      );
      const regex = /Removed objective '(\w+)'/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async scoreboardObjectiveSetDisplay(
      slot: string,
      objective?: string,
    ): Promise<string> {
      const command = objective
        ? `scoreboard objectives setdisplay ${slot} ${objective}`
        : `scoreboard objectives setdisplay ${slot}`;
      const result = await executeCommand(command);
      if (objective) {
        const regex = /Set the display objective in slot '(\w+)' to '(\w+)'/;
        const match = result.match(regex);
        return match ? `${match[1]}: ${match[2]}` : result;
      } else {
        const regex = /Cleared the objective in slot '(\w+)'/;
        const match = result.match(regex);
        return match ? match[1] : result;
      }
    },

    async scoreboardPlayersOperation(
      target: string,
      targetObjective: string,
      operation: string,
      source: string,
      sourceObjective: string,
    ): Promise<string> {
      const result = await executeCommand(
        `scoreboard players operation ${target} ${targetObjective} ${operation} ${source} ${sourceObjective}`,
      );
      const regex = /Set score of (\w+) for player (\w+) to (-?\d+)/;
      const match = result.match(regex);
      return match ? `${match[2]} ${match[1]}: ${match[3]}` : result;
    },

    async getBossbar(
      id: string,
    ): Promise<Record<string, string | number | boolean>> {
      const result = await executeCommand(`bossbar get ${id}`);
      const data: Record<string, string | number | boolean> = {};
      const regex = /(\w+): ([\w\s]+)/g;
      let match;
      while ((match = regex.exec(result)) !== null) {
        data[match[1].toLowerCase()] = match[2];
      }
      return data;
    },

    async setBossbar(
      id: string,
      property:
        | "name"
        | "color"
        | "style"
        | "value"
        | "max"
        | "visible"
        | "players",
      value: string | number | boolean,
    ): Promise<string> {
      return await executeCommand(`bossbar set ${id} ${property} ${value}`);
    },

    async getWorldBorder(): Promise<
      { center: [number, number]; diameter: number }
    > {
      const centerResult = await executeCommand("worldborder get center");
      const sizeResult = await executeCommand("worldborder get");

      const centerRegex =
        /The world border is currently centered at ([\-\d.]+), ([\-\d.]+)/;
      const sizeRegex = /The world border is currently (\d+) blocks wide/;

      const centerMatch = centerResult.match(centerRegex);
      const sizeMatch = sizeResult.match(sizeRegex);

      if (centerMatch && sizeMatch) {
        return {
          center: [parseFloat(centerMatch[1]), parseFloat(centerMatch[2])],
          diameter: parseFloat(sizeMatch[1]),
        };
      }
      throw new Error("Failed to parse world border information");
    },

    async setWorldBorder(diameter: number, time?: number): Promise<string> {
      const command = time
        ? `worldborder set ${diameter} ${time}`
        : `worldborder set ${diameter}`;
      return await executeCommand(command);
    },

    async getTime(): Promise<{ day: number; daytime: number }> {
      const result = await executeCommand("time query");
      const dayRegex = /The time is (\d+)/;
      const daytimeRegex = /The daytime is (\d+)/;

      const dayMatch = result.match(dayRegex);
      const daytimeMatch = result.match(daytimeRegex);

      if (dayMatch && daytimeMatch) {
        return {
          day: parseInt(dayMatch[1]),
          daytime: parseInt(daytimeMatch[1]),
        };
      }
      throw new Error("Failed to parse time information");
    },

    async advancement(
      action: "grant" | "revoke",
      target: string,
      advancement: string,
    ): Promise<string> {
      const result = await executeCommand(
        `advancement ${action} ${target} ${advancement}`,
      );
      const regex = /Made (\d+) advancements/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async attribute(
      target: string,
      attribute: string,
      action: "get" | "base" | "modifier",
      ...args: string[]
    ): Promise<string> {
      const result = await executeCommand(
        `attribute ${target} ${attribute} ${action} ${args.join(" ")}`,
      );
      const regex = /(\d+(?:\.\d+)?)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async ban(target: string, reason?: string): Promise<string> {
      const command = reason ? `ban ${target} ${reason}` : `ban ${target}`;
      const result = await executeCommand(command);
      const regex = /Banned player: (\w+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async banIp(target: string, reason?: string): Promise<string> {
      const command = reason
        ? `ban-ip ${target} ${reason}`
        : `ban-ip ${target}`;
      const result = await executeCommand(command);
      const regex = /Banned IP Address: ([\d\.]+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async banlist(type?: "players" | "ips"): Promise<string> {
      const command = type ? `banlist ${type}` : "banlist";
      return await executeCommand(command);
    },

    async damage(
      target: string,
      amount: number,
      type?: string,
    ): Promise<string> {
      const command = type
        ? `damage ${target} ${amount} ${type}`
        : `damage ${target} ${amount}`;
      const result = await executeCommand(command);
      const regex = /Damaged (\w+) for (\d+)/;
      const match = result.match(regex);
      return match ? `${match[1]}: ${match[2]}` : result;
    },

    async datapack(
      action: "list" | "enable" | "disable",
      name?: string,
    ): Promise<string> {
      const command = name
        ? `datapack ${action} ${name}`
        : `datapack ${action}`;
      return await executeCommand(command);
    },

    async debug(action: "start" | "stop" | "function"): Promise<string> {
      return await executeCommand(`debug ${action}`);
    },

    async defaultGamemode(
      mode: "survival" | "creative" | "adventure" | "spectator",
    ): Promise<string> {
      return await executeCommand(`defaultgamemode ${mode}`);
    },

    async deOp(target: string): Promise<string> {
      const result = await executeCommand(`deop ${target}`);
      const regex = /Made (\w+) no longer a server operator/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async fillBiome(
      from: [number, number, number],
      to: [number, number, number],
      biome: string,
    ): Promise<string> {
      const result = await executeCommand(
        `fillbiome ${from.join(" ")} ${to.join(" ")} ${biome}`,
      );
      const regex = /(\d+) blocks? filled/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async forceload(
      action: "add" | "remove" | "query",
      from: [number, number],
      to?: [number, number],
    ): Promise<string> {
      const command = to
        ? `forceload ${action} ${from.join(" ")} ${to.join(" ")}`
        : `forceload ${action} ${from.join(" ")}`;
      return await executeCommand(command);
    },

    async function(name: string): Promise<string> {
      return await executeCommand(`function ${name}`);
    },

    async help(command?: string): Promise<string> {
      return await executeCommand(command ? `help ${command}` : "help");
    },

    async item(
      action: "replace" | "modify",
      target: string,
      slot: string,
      item?: string,
      count?: number,
    ): Promise<string> {
      let command = `item ${action} ${target} ${slot}`;
      if (item) command += ` ${item}`;
      if (count !== undefined) command += ` ${count}`;
      const result = await executeCommand(command);
      const regex = /Replaced (\d+) items?/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async kick(target: string, reason?: string): Promise<string> {
      const command = reason ? `kick ${target} ${reason}` : `kick ${target}`;
      const result = await executeCommand(command);
      const regex = /Kicked (\w+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async listPlayers(): Promise<string> {
      const result = await executeCommand("list");
      const regex = /There are (\d+) of a max of (\d+) players online:/;
      const match = result.match(regex);
      return match ? `${match[1]}/${match[2]}` : result;
    },

    async locate(structure: string): Promise<string> {
      const result = await executeCommand(`locate structure ${structure}`);
      const regex = /The nearest (.+) is at \[(-?\d+), ~, (-?\d+)\]/;
      const match = result.match(regex);
      return match ? `${match[1]}: ${match[2]}, ${match[3]}` : result;
    },

    async seed(): Promise<string> {
      const result = await executeCommand("seed");
      const seedRegex = /Seed: \[(-?\d+)\]/;
      const match = result.match(seedRegex);
      return match ? match[1] : result;
    },

    async loot(
      target: "spawn" | "give" | "insert" | "replace",
      destination: string,
      source: string,
      ...args: string[]
    ): Promise<string> {
      const result = await executeCommand(
        `loot ${target} ${destination} ${source} ${args.join(" ")}`,
      );
      const regex = /Dropped (\d+) stack\(s\)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async me(action: string): Promise<string> {
      return await executeCommand(`me ${action}`);
    },

    async msg(target: string, message: string): Promise<string> {
      return await executeCommand(`msg ${target} ${message}`);
    },

    async op(target: string): Promise<string> {
      const result = await executeCommand(`op ${target}`);
      const regex = /Made (\w+) a server operator/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async pardon(target: string): Promise<string> {
      const result = await executeCommand(`pardon ${target}`);
      const regex = /Unbanned (\w+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async pardonIp(target: string): Promise<string> {
      const result = await executeCommand(`pardon-ip ${target}`);
      const regex = /Unbanned IP address (\S+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async particle(
      name: string,
      pos: [number, number, number],
      ...args: string[]
    ): Promise<string> {
      return await executeCommand(
        `particle ${name} ${pos.join(" ")} ${args.join(" ")}`,
      );
    },

    async playSound(
      sound: string,
      source: string,
      target: string,
      ...args: string[]
    ): Promise<string> {
      return await executeCommand(
        `playsound ${sound} ${source} ${target} ${args.join(" ")}`,
      );
    },

    async recipe(
      action: "give" | "take",
      target: string,
      recipe: string,
    ): Promise<string> {
      const result = await executeCommand(
        `recipe ${action} ${target} ${recipe}`,
      );
      const regex = /(\d+) recipe\(s\) (given|taken)/;
      const match = result.match(regex);
      return match ? `${match[1]} ${match[2]}` : result;
    },

    async reload(): Promise<string> {
      return await executeCommand("reload");
    },

    async say(message: string): Promise<string> {
      return await executeCommand(`say ${message}`);
    },

    async schedule(
      action: "function" | "clear",
      time: string,
      name: string,
    ): Promise<string> {
      return await executeCommand(`schedule ${action} ${name} ${time}`);
    },

    async setIdleTimeout(minutes: number): Promise<string> {
      return await executeCommand(`setidletimeout ${minutes}`);
    },

    async spectate(target?: string, player?: string): Promise<string> {
      const command = player
        ? `spectate ${target} ${player}`
        : target
        ? `spectate ${target}`
        : "spectate";
      return await executeCommand(command);
    },

    async spreadPlayers(
      center: [number, number],
      distance: number,
      maxRange: number,
      respectTeams: boolean,
      targets: string,
    ): Promise<string> {
      const result = await executeCommand(
        `spreadplayers ${
          center.join(" ")
        } ${distance} ${maxRange} ${respectTeams} ${targets}`,
      );
      const regex = /Spread (\d+) entities/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async stopSound(
      target: string,
      source?: string,
      sound?: string,
    ): Promise<string> {
      let command = `stopsound ${target}`;
      if (source) command += ` ${source}`;
      if (sound) command += ` ${sound}`;
      return await executeCommand(command);
    },

    async tag(
      target: string,
      action: "add" | "remove" | "list",
      value?: string,
    ): Promise<string> {
      const command = value
        ? `tag ${target} ${action} ${value}`
        : `tag ${target} ${action}`;
      if (action === "list") {
        const result = await executeCommand(command);
        const regex = /(\d+) tag\(s\) on/;
        const match = result.match(regex);
        return match ? match[1] : result;
      }
      return executeCommand(command);
    },

    async team(
      action: "add" | "remove" | "empty" | "join" | "leave" | "modify",
      team: string,
      ...args: string[]
    ): Promise<string> {
      return await executeCommand(`team ${action} ${team} ${args.join(" ")}`);
    },

    async teamMsg(message: string): Promise<string> {
      return await executeCommand(`teammsg ${message}`);
    },

    async tellraw(target: string, message: string): Promise<string> {
      return await executeCommand(`tellraw ${target} ${message}`);
    },

    async title(
      target: string,
      action: "title" | "subtitle" | "actionbar" | "clear" | "reset",
      ...args: string[]
    ): Promise<string> {
      return await executeCommand(
        `title ${target} ${action} ${args.join(" ")}`,
      );
    },

    async trigger(
      objective: string,
      action?: "add" | "set",
      value?: number,
    ): Promise<string> {
      let command = `trigger ${objective}`;
      if (action && value !== undefined) command += ` ${action} ${value}`;
      return await executeCommand(command);
    },

    async whitelist(
      action: "on" | "off" | "list" | "add" | "remove" | "reload",
      target?: string,
    ): Promise<string> {
      const command = target
        ? `whitelist ${action} ${target}`
        : `whitelist ${action}`;
      if (action === "list") {
        const result = await executeCommand(command);
        const regex = /There are (\d+) whitelisted players/;
        const match = result.match(regex);
        return match ? match[1] : result;
      }
      return executeCommand(command);
    },

    async worldBorderCenter(x: number, z: number): Promise<string> {
      const result = await executeCommand(`worldborder center ${x} ${z}`);
      const regex = /Set world border center to ([-\d.]+), ([-\d.]+)/;
      const match = result.match(regex);
      return match ? `${match[1]}, ${match[2]}` : result;
    },

    async worldBorderDamage(damagePerBlock: number): Promise<string> {
      const result = await executeCommand(
        `worldborder damage amount ${damagePerBlock}`,
      );
      const regex = /Set world border damage amount to ([\d.]+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async worldBorderWarningDistance(distance: number): Promise<string> {
      const result = await executeCommand(
        `worldborder warning distance ${distance}`,
      );
      const regex = /Set world border warning to (\d+) blocks/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async worldBorderWarningTime(time: number): Promise<string> {
      const result = await executeCommand(`worldborder warning time ${time}`);
      const regex = /Set world border warning to (\d+) seconds/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async gameruleList(): Promise<Record<string, string>> {
      const result = await executeCommand("gamerule");
      const rules: Record<string, string> = {};
      const regex = /(\w+) = (true|false|\d+)/g;
      let match;
      while ((match = regex.exec(result)) !== null) {
        rules[match[1]] = match[2];
      }
      return rules;
    },

    async gameruleSet(
      rule: string,
      value: string | number | boolean,
    ): Promise<string> {
      const result = await executeCommand(`gamerule ${rule} ${value}`);
      const regex = /Gamerule (\w+) is now set to: (true|false|\d+)/;
      const match = result.match(regex);
      return match ? `${match[1]}: ${match[2]}` : result;
    },

    async gameruleGet(rule: string): Promise<string> {
      const result = await executeCommand(`gamerule ${rule}`);
      const regex = /Gamerule (\w+) is currently set to: (true|false|\d+)/;
      const match = result.match(regex);
      return match ? match[2] : result;
    },

    async xpAdd(target: string, amount: number): Promise<string> {
      const result = await executeCommand(`xp add ${target} ${amount}`);
      const regex = /Given (\d+) experience to (\w+)/;
      const match = result.match(regex);
      return match ? `${match[2]}: +${match[1]}` : result;
    },

    async xpSet(target: string, amount: number): Promise<string> {
      const result = await executeCommand(`xp set ${target} ${amount}`);
      const regex = /Set (\w+)'s experience to (\d+)/;
      const match = result.match(regex);
      return match ? `${match[1]}: ${match[2]}` : result;
    },

    async xpQuery(target: string, type: "points" | "levels"): Promise<number> {
      const result = await executeCommand(`xp query ${target} ${type}`);
      const regex = /(\w+) has (\d+) experience (points|levels)/;
      const match = result.match(regex);
      return match ? parseInt(match[2]) : 0;
    },

    async timeSet(
      value: number | "day" | "night" | "noon" | "midnight",
    ): Promise<string> {
      const result = await executeCommand(`time set ${value}`);
      const regex = /Set the time to (\d+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async timeAdd(amount: number): Promise<string> {
      const result = await executeCommand(`time add ${amount}`);
      const regex = /Added (\d+) to the time/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async timeQuery(type: "daytime" | "gametime" | "day"): Promise<number> {
      const result = await executeCommand(`time query ${type}`);
      const regex = /The time is (\d+)/;
      const match = result.match(regex);
      return match ? parseInt(match[1]) : 0;
    },

    async weatherClear(duration?: number): Promise<string> {
      const command = duration ? `weather clear ${duration}` : "weather clear";
      const result = await executeCommand(command);
      const regex = /Changing to clear weather(?: for (\d+) seconds)?/;
      const match = result.match(regex);
      return match ? (match[1] || "Clear") : result;
    },

    async weatherRain(duration?: number): Promise<string> {
      const command = duration ? `weather rain ${duration}` : "weather rain";
      const result = await executeCommand(command);
      const regex = /Changing to rainy weather(?: for (\d+) seconds)?/;
      const match = result.match(regex);
      return match ? (match[1] || "Rain") : result;
    },

    async weatherThunder(duration?: number): Promise<string> {
      const command = duration
        ? `weather thunder ${duration}`
        : "weather thunder";
      const result = await executeCommand(command);
      const regex = /Changing to thunder(?: for (\d+) seconds)?/;
      const match = result.match(regex);
      return match ? (match[1] || "Thunder") : result;
    },

    async difficultySet(
      level: "peaceful" | "easy" | "normal" | "hard",
    ): Promise<string> {
      const result = await executeCommand(`difficulty ${level}`);
      const regex = /Set game difficulty to (\w+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async difficultyGet(): Promise<string> {
      const result = await executeCommand("difficulty");
      const regex = /The difficulty is (\w+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async advancementGrant(
      target: string,
      advancement: string | "everything",
    ): Promise<string> {
      const result = await executeCommand(
        `advancement grant ${target} ${advancement}`,
      );
      const regex = /Granted (\d+) advancements? to (\w+)/;
      const match = result.match(regex);
      return match ? `${match[2]}: ${match[1]}` : result;
    },

    async advancementRevoke(
      target: string,
      advancement: string | "everything",
    ): Promise<string> {
      const result = await executeCommand(
        `advancement revoke ${target} ${advancement}`,
      );
      const regex = /Revoked (\d+) advancements? from (\w+)/;
      const match = result.match(regex);
      return match ? `${match[2]}: -${match[1]}` : result;
    },

    async bossbarAdd(id: string, name: string): Promise<string> {
      const result = await executeCommand(
        `bossbar add ${id} ${JSON.stringify(name)}`,
      );
      const regex = /Created custom bossbar (.+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async bossbarRemove(id: string): Promise<string> {
      const result = await executeCommand(`bossbar remove ${id}`);
      const regex = /Removed custom bossbar (.+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async bossbarList(): Promise<string[]> {
      const result = await executeCommand("bossbar list");
      const regex = /- (.+)/g;
      const matches = result.match(regex);
      return matches ? matches.map((m) => m.slice(2)) : [];
    },

    async datapackList(): Promise<{ available: string[]; enabled: string[] }> {
      const result = await executeCommand("datapack list");
      const availableRegex = /Available:(?:\s*\n\s*- (.+))+/;
      const enabledRegex = /Enabled:(?:\s*\n\s*- (.+))+/;
      const availableMatch = result.match(availableRegex);
      const enabledMatch = result.match(enabledRegex);
      return {
        available: availableMatch
          ? availableMatch[0].split("\n").slice(1).map((s) => s.trim().slice(2))
          : [],
        enabled: enabledMatch
          ? enabledMatch[0].split("\n").slice(1).map((s) => s.trim().slice(2))
          : [],
      };
    },

    async datapackEnable(name: string): Promise<string> {
      const result = await executeCommand(`datapack enable ${name}`);
      const regex = /Enabled data pack (.+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async datapackDisable(name: string): Promise<string> {
      const result = await executeCommand(`datapack disable ${name}`);
      const regex = /Disabled data pack (.+)/;
      const match = result.match(regex);
      return match ? match[1] : result;
    },

    async effectGive(
      target: string,
      effect: string,
      duration?: number,
      amplifier?: number,
      hideParticles?: boolean,
    ): Promise<string> {
      let command = `effect give ${target} ${effect}`;
      if (duration !== undefined) command += ` ${duration}`;
      if (amplifier !== undefined) command += ` ${amplifier}`;
      if (hideParticles !== undefined) command += ` ${hideParticles}`;
      const result = await executeCommand(command);
      const regex =
        /Given (.+) \(ID (\d+)\) \* (\d+) to (\w+) for (\d+) seconds/;
      const match = result.match(regex);
      return match
        ? `${match[4]}: ${match[1]} (${match[2]}) x${match[3]} for ${match[5]}s`
        : result;
    },

    async effectClear(target: string, effect?: string): Promise<string> {
      const command = effect
        ? `effect clear ${target} ${effect}`
        : `effect clear ${target}`;
      const result = await executeCommand(command);
      const regex = /Removed (\d+) effect(?:s)? from (\w+)/;
      const match = result.match(regex);
      return match ? `${match[2]}: -${match[1]}` : result;
    },

    async getPlayerData(player: string): Promise<Record<string, string>> {
      const result = await executeCommand(`data get entity ${player}`);
      try {
        const dataString = result.slice(result.indexOf("{"));
        return JSON.parse(dataString.replace(/(\w+):/g, '"$1":'));
      } catch (error: unknown) {
        throw new Error("Failed to parse player data: " + error);
      }
    },

    async getPlayerRotation(
      player: string,
    ): Promise<{ yaw: number; pitch: number }> {
      const data = await this.getPlayerData(player);
      return {
        yaw: data.Rotation[0],
        pitch: data.Rotation[1],
      };
    },

    async getPlayerHealth(player: string): Promise<number> {
      const data = await this.getPlayerData(player);
      return data.Health;
    },

    async getPlayerFood(
      player: string,
    ): Promise<{ level: number; saturation: number }> {
      const data = await this.getPlayerData(player);
      return {
        level: data.foodLevel,
        saturation: data.foodSaturationLevel,
      };
    },

    async getPlayerXP(
      player: string,
    ): Promise<{ level: number; points: number; total: number }> {
      const data = await this.getPlayerData(player);
      return {
        level: data.XpLevel,
        points: Math.floor(data.XpP * data.XpLevel),
        total: data.XpTotal,
      };
    },

    async getPlayerGameMode(player: string): Promise<number> {
      const data = await this.getPlayerData(player);
      return data.playerGameType;
    },

    async getPlayerInventory(
      player: string,
    ): Promise<Array<{ slot: number; id: string; count: number }>> {
      const data = await this.getPlayerData(player);
      return data.Inventory.map((
        item: { Slot: number; id: string; Count: number },
      ) => ({
        slot: item.Slot,
        id: item.id,
        count: item.Count,
      }));
    },

    async getPlayerSelectedItem(
      player: string,
    ): Promise<{ id: string; count: number } | null> {
      const data = await this.getPlayerData(player);
      if (data.SelectedItem) {
        return {
          id: data.SelectedItem.id,
          count: data.SelectedItem.Count,
        };
      }
      return null;
    },

    async getPlayerAttributes(
      player: string,
    ): Promise<Array<{ name: string; base: number }>> {
      const data = await this.getPlayerData(player);
      return data.Attributes.map((attr: { Name: string; Base: number }) => ({
        name: attr.Name,
        base: attr.Base,
      }));
    },

    async getPlayerRecipes(player: string): Promise<string[]> {
      const data = await this.getPlayerData(player);
      return data.recipeBook.recipes;
    },

    async getPlayerLastDeathLocation(
      player: string,
    ): Promise<{ x: number; y: number; z: number; dimension: string } | null> {
      const data = await this.getPlayerData(player);
      if (data.LastDeathLocation) {
        return {
          x: data.LastDeathLocation.pos[0],
          y: data.LastDeathLocation.pos[1],
          z: data.LastDeathLocation.pos[2],
          dimension: data.LastDeathLocation.dimension,
        };
      }
      return null;
    },
  };
}
