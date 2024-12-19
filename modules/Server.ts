import {
  Module,
  Command,
  Description,
  Permission,
  Event,
  Socket,
  Argument,
} from "../decorators.ts";
import { text, button, container, alert, divider } from "../tellraw-ui.ts";
import type { ScriptContext } from "../types.ts";

interface ServerConfig {
  name: string;
  url: string;
  version: string;
  description: string;
  map_url: string;
  motd: string;
  max_players: number;
  pvp: boolean;
  whitelist: boolean;
  spawn_protection: number;
  difficulty: string;
}

const DEFAULT_CONFIG: ServerConfig = {
  name: "Enchanted Server",
  url: "cou.ai",
  version: "1.21.1",
  description: "An Enchanted Minecraft Server",
  map_url: "",
  motd: "Welcome to the server!",
  max_players: 111,
  pvp: true,
  whitelist: false,
  spawn_protection: 16,
  difficulty: "normal",
};

@Module({
  name: "Server",
  version: "1.0.1",
  description: "Server management and configuration",
})
export class Server {
  private async getConfig(kv: any, key: string): Promise<any> {
    const result = await kv.get(["server", key]);
    return result.value ?? DEFAULT_CONFIG[key as keyof ServerConfig];
  }

  private async setConfig(kv: any, key: string, value: any): Promise<void> {
    await kv.set(["server", key], value);
  }

  private async getAllConfig(kv: any): Promise<Partial<ServerConfig>> {
    const config: Partial<ServerConfig> = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      config[key as keyof ServerConfig] = await this.getConfig(kv, key);
    }
    return config;
  }

  @Event("server_started")
  async handleServerStart({ kv, log }: ScriptContext): Promise<void> {
    try {
      // Initialize server config if not exists
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        const existing = await this.getConfig(kv, key);
        if (existing === undefined) {
          await this.setConfig(kv, key, value);
        }
      }
      log("Server configuration initialized");
    } catch (error) {
      log(`Error initializing server config: ${error.message}`);
    }
  }

  @Command(["server"])
  @Description("Server management commands")
  @Permission("player")
  async serverHelp({
    params,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    const helpMenu = container([
      text("📡 Server Management 📡\n", {
        style: { color: "gold", styles: ["bold"] },
      }),

      button("/server info", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/server info",
        },
      }),
      text(" - View server information\n", { style: { color: "gray" } }),

      button("/server config list", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/server config list",
        },
      }),
      text(" - List all configuration values\n", { style: { color: "gray" } }),

      button("/server config set <key> <value>", {
        variant: "ghost",
        onClick: {
          action: "suggest_command",
          value: "/server config set ",
        },
      }),
      text(" - Set a configuration value\n", { style: { color: "gray" } }),

      button("/server restart", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/server restart",
        },
      }),
      text(" - Restart the server\n", { style: { color: "gray" } }),

      button("/server motd", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/server motd",
        },
      }),
      text(" - View/edit server MOTD\n", { style: { color: "gray" } }),

      divider(),

      text("🔧 Operator Commands:\n", { style: { color: "gold" } }),
      text("• /server config reset - Reset to defaults\n", {
        style: { color: "gray" },
      }),
      text("• /server backup - Create server backup\n", {
        style: { color: "gray" },
      }),
      text("• /server maintenance - Toggle maintenance mode", {
        style: { color: "gray" },
      }),
    ]);

    const messages = await tellraw(
      sender,
      helpMenu.render({ platform: "minecraft", player: sender }),
    );
    return { messages };
  }

  @Command(["server", "info"])
  @Description("View server information")
  @Permission("guest")
  async serverInfo({
    params,
    kv,
    tellraw,
    api,
    playerManager,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const config = await this.getAllConfig(kv);
      // const serverProperties = await api.getServerProperties();
      // const uptime = await api.getServerUptime();

      const formatUptime = (ms: number): string => {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor(
          (ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000),
        );
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        return `${days}d ${hours}h ${minutes}m`;
      };

      const infoDisplay = container([
        text("🖥️ Server Information 🖥️\n", {
          style: { color: "gold", styles: ["bold"] },
        }),

        text("Name: ", { style: { color: "gray" } }),
        text(`${config.name}\n`, { style: { color: "yellow" } }),

        text("Version: ", { style: { color: "gray" } }),
        text(`${config.version}\n`, { style: { color: "aqua" } }),

        text("Description: ", { style: { color: "gray" } }),
        text(`${config.description}\n`, { style: { color: "white" } }),

        // divider(),

        // text("⚙️ Status\n", { style: { color: "gold" } }),
        // text("Uptime: ", { style: { color: "gray" } }),
        // text(`${formatUptime(uptime)}\n`, { style: { color: "green" } }),
        // text("Players: ", { style: { color: "gray" } }),
        // text(`${serverProperties.onlinePlayers}/${config.max_players}\n`, {
        //   style: { color: "yellow" }
        // }),
        // text("TPS: ", { style: { color: "gray" } }),
        // text(`${serverProperties.tps}\n`, {
        //   style: { color: serverProperties.tps >= 19 ? "green" : "red" }
        // }),

        divider(),

        text("🌐 Links\n", { style: { color: "gold" } }),
        text("Website: ", { style: { color: "gray" } }),
        text(`${config.url}\n`, {
          style: { color: "aqua" },
          onClick: {
            action: "open_url",
            value: config.url,
          },
        }),
        ...(config.map_url
          ? [
              text("Map: ", { style: { color: "gray" } }),
              text(`${config.map_url}\n`, {
                style: { color: "aqua" },
                onClick: {
                  action: "open_url",
                  value: config.map_url,
                },
              }),
            ]
          : []),

        divider(),

        text("🎮 Settings\n", { style: { color: "gold" } }),
        text("PvP: ", { style: { color: "gray" } }),
        text(`${config.pvp ? "Enabled" : "Disabled"}\n`, {
          style: { color: config.pvp ? "green" : "red" },
        }),
        text("Whitelist: ", { style: { color: "gray" } }),
        text(`${config.whitelist ? "Enabled" : "Disabled"}\n`, {
          style: { color: config.whitelist ? "yellow" : "gray" },
        }),
        text("Difficulty: ", { style: { color: "gray" } }),
        text(`${config.difficulty}\n`, { style: { color: "yellow" } }),

        divider(),

        button("View Config", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server config list",
          },
        }),
        text(" "),
        button("Edit MOTD", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server motd",
          },
        }),
        ...(playerManager.hasPermission(sender, "operator")
          ? [
              text(" "),
              button("Restart", {
                variant: "destructive",
                onClick: {
                  action: "run_command",
                  value: "/server restart",
                },
              }),
            ]
          : []),
      ]);

      const messages = await tellraw(
        sender,
        infoDisplay.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    }
  }

  @Command(["server", "config", "list"])
  @Description("List all server configuration values")
  @Permission("operator")
  async listConfig({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const config = await this.getAllConfig(kv);

      const configDisplay = container([
        text("⚙️ Server Configuration ⚙️\n", {
          style: { color: "gold", styles: ["bold"] },
        }),

        ...Object.entries(config)
          .map(([key, value]) => [
            text(`${key}: `, { style: { color: "gray" } }),
            text(`${value}\n`, { style: { color: "yellow" } }),
            button("Edit", {
              variant: "outline",
              onClick: {
                action: "suggest_command",
                value: `/server config set ${key} `,
              },
            }),
            text("\n"),
          ])
          .flat(),

        divider(),

        button("Reset All", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: "/server config reset",
          },
        }),
        text(" "),
        button("View Info", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server info",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        configDisplay.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    }
  }

  @Command(["server", "config", "set"])
  @Description("Set a server configuration value")
  @Permission("operator")
  @Argument([
    { name: "key", type: "string", description: "Configuration key" },
    { name: "value", type: "string", description: "New value" },
  ])
  async setConfigValue({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;

    try {
      const { key, value } = args;

      if (!(key in DEFAULT_CONFIG)) {
        throw new Error(`Invalid configuration key: ${key}`);
      }

      // Type validation
      let parsedValue: any = value;
      switch (typeof DEFAULT_CONFIG[key as keyof ServerConfig]) {
        case "number":
          parsedValue = Number(value);
          if (isNaN(parsedValue)) {
            throw new Error("Value must be a number");
          }
          break;
        case "boolean":
          if (!["true", "false"].includes(value.toLowerCase())) {
            throw new Error("Value must be true or false");
          }
          parsedValue = value.toLowerCase() === "true";
          break;
      }

      await this.setConfig(kv, key, parsedValue);

      const successMsg = container([
        text("✅ Configuration Updated\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text(`${key}: `, { style: { color: "gray" } }),
        text(`${parsedValue}\n`, { style: { color: "yellow" } }),
        divider(),
        button("View All Config", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server config list",
          },
        }),
        text(" "),
        button("View Server Info", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server info",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Config Update Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    }
  }

  @Command(["server", "restart"])
  @Description("Restart the server")
  @Permission("operator")
  async restartServer({
    params,
    tellraw,
    api,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const confirmMsg = container([
        text("⚠️ Server Restart Confirmation ⚠️\n", {
          style: { color: "red", styles: ["bold"] },
        }),
        text("Are you sure you want to restart the server?\n", {
          style: { color: "yellow" },
        }),
        text("This will disconnect all players!\n", {
          style: { color: "gray" },
        }),
        divider(),
        button("Confirm Restart", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: "/server confirm-restart",
          },
        }),
        text(" "),
        button("Cancel", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server info",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        confirmMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    }
  }

  @Command(["server", "confirm-restart"])
  @Description("Confirm server restart")
  @Permission("operator")
  async confirmRestart({
    params,
    tellraw,
    api,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      // Broadcast restart message to all players
      await tellraw("@a", {
        text: "⚠️ SERVER RESTART IN 10 SECONDS ⚠️",
        color: "red",
        bold: true,
      });

      // Wait 10 seconds
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Execute restart
      await api.executeCommand("stop");

      const messages = await tellraw(sender, "Server is restarting...");
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Restart Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    }
  }

  @Command(["server", "setup"])
  @Description("Initialize server with default configuration and apps")
  @Permission("operator")
  async setupServer({
    params,
    kv,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      // Default apps configuration
      const defaultApps = [
        {
          name: "EnderNET",
          title: "EnderNET",
          icon: "items/ender_eye.png",
          version: "1.0.0",
          description:
            "Core network interface for accessing server features and applications",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "Bcon",
          title: "Bcon",
          icon: "items/beacon.png",
          version: "1.0.0",
          description:
            "Beacon management system for territory control and effects",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "XPay",
          title: "XPay",
          icon: "boe.webp",
          version: "1.0.0",
          description: "Economic transaction and payment processing system",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "Inventory",
          title: "Inventory",
          icon: "items/chest.png",
          version: "1.0.0",
          description: "Advanced inventory management and organization system",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "Market",
          title: "Market",
          icon: "items/emerald.png",
          version: "1.0.0",
          description: "Global marketplace for trading items and services",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "Teams",
          title: "Teams",
          icon: "ega.webp",
          version: "1.0.0",
          description: "Team management and collaboration platform",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "Zones",
          title: "Zones",
          icon: "c.webp",
          version: "1.0.0",
          description: "Territory and protection zone management system",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "Code",
          title: "Code",
          icon: "eip.webp",
          version: "1.0.0",
          description:
            "Advanced scripting and programming interface for operators",
          permission: "operator",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "KView",
          title: "KView",
          icon: "items/name_tag.png",
          version: "1.0.0",
          description:
            "Advanced key value database interface for operators",
          permission: "operator",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
        {
          name: "COU",
          title: "COU",
          icon: "items/observer.png",
          version: "1.0.0",
          description:
            "Craft Observation Unit - AI assistant for server and community management",
          permission: "player",
          singleWindow: false,
          isClosable: true,
          height: 100,
          width: 100,
          updatedAt: Date.now(),
        },
      ];

      // Set the apps in KV store
      await kv.set(["apps"], defaultApps);

      // Initialize default server config
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        await this.setConfig(kv, key, value);
      }

      const successMsg = container([
        text("✅ Server Setup Complete\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Successfully initialized:\n", { style: { color: "gray" } }),
        text("• Default server configuration\n", {
          style: { color: "yellow" },
        }),
        text(`• ${defaultApps.length} default applications\n`, {
          style: { color: "yellow" },
        }),
        divider(),
        button("View Server Info", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server info",
          },
        }),
        text(" "),
        button("View Config", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/server config list",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Setup Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    }
  }

  @Socket("get_server_info")
  async getServerInfo({ kv }: ScriptContext): Promise<any> {
    try {
      const config = await this.getAllConfig(kv);
      return {
        success: true,
        data: config,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
