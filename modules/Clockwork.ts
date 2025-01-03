import { Module, Command, Description, Permission, Event, Argument } from "../decorators.ts";
import { text, button, container, alert, divider } from "../tellraw-ui.ts";
import type { ScriptContext } from "../types.ts";

@Module({
  name: 'Clockwork',
  version: '1.0.1',
  description: 'Advanced time control system with per-setting configuration'
})
export class Clockwork {
  private readonly UPDATE_INTERVAL = 1000;
  private readonly DAY_START = 0;
  private readonly NOON = 6000;
  private readonly NIGHT_START = 12000;
  private readonly MIDNIGHT = 18000;
  private readonly FULL_DAY = 24000;

  // Helper methods for time calculations
  private normalizeTime(time: number): number {
    return ((time % this.FULL_DAY) + this.FULL_DAY) % this.FULL_DAY;
  }

  private isNightTime(time: number): boolean {
    const normalizedTime = this.normalizeTime(time);
    return normalizedTime >= this.NIGHT_START && normalizedTime < this.DAY_START + this.FULL_DAY;
  }

  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private calculateRealTimeDuration(speed: number, ticks: number): number {
    return (ticks / 20) * 1000 / speed;
  }

  // Config management methods
  private async getConfig(kv: any, key: string, defaultValue: any): Promise<any> {
    const result = await kv.get(['config', 'clockwork', key]);
    return result.value ?? defaultValue;
  }

  private async setConfig(kv: any, key: string, value: any): Promise<void> {
    await kv.set(['config', 'clockwork', key], value);
  }

  @Event('server_started')
  async handleServerStart({ api, kv, log }: ScriptContext): Promise<void> {
    try {
      // Only disable daylight cycle if Clockwork is enabled
      const isEnabled = await this.getConfig(kv, 'enabled', true);
      if (isEnabled) {
        await api.executeCommand('gamerule doDaylightCycle false');
      }

      // Initialize settings only if they don't exist
      const now = Date.now();
      const currentTime = await api.timeQuery("daytime");

      // Initialize each setting only if not already set
      const configs = [
        ['enabled', isEnabled],
        ['daySpeed', 1.0],
        ['nightSpeed', 1.0],
        ['currentTime', currentTime],
        ['lastTick', now],
        ['lastCommandTime', now]
      ];

      for (const [key, defaultValue] of configs) {
        const existingValue = await kv.get(['config', 'clockwork', key]);
        if (existingValue.value === undefined) {
          await this.setConfig(kv, key, defaultValue);
        }
      }

      log('Clockwork module initialized');
    } catch (error) {
      log(`Error initializing Clockwork: ${error.message}`);
    }
  }

  @Event('server_tick_start')
  async handleServerTick({ api, kv }: ScriptContext): Promise<void> {
    try {
      const enabled = await this.getConfig(kv, 'enabled', false);
      if (!enabled) return;

      const currentTime = await this.getConfig(kv, 'currentTime', 0);
      const lastTick = await this.getConfig(kv, 'lastTick', Date.now());
      const lastCommandTime = await this.getConfig(kv, 'lastCommandTime', Date.now());
      const daySpeed = await this.getConfig(kv, 'daySpeed', 1.0);
      const nightSpeed = await this.getConfig(kv, 'nightSpeed', 1.0);

      const now = Date.now();
      const tickDelta = now - lastTick;

      const currentSpeed = this.isNightTime(currentTime) ? nightSpeed : daySpeed;
      const timeProgress = (tickDelta / 50) * currentSpeed;
      const newTime = this.normalizeTime(currentTime + timeProgress);

      if (now - lastCommandTime >= this.UPDATE_INTERVAL) {
        await api.executeCommand(`time set ${Math.floor(newTime)}`);
        await this.setConfig(kv, 'lastCommandTime', now);
      }

      await this.setConfig(kv, 'currentTime', newTime);
      await this.setConfig(kv, 'lastTick', now);
    } catch (error) {
      // Silently fail for tick events
    }
  }

  @Command(['clock'])
  @Description('Show Clockwork help menu')
  @Permission('player')
  async showHelp({ params, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    const helpMenu = container([
      text("=== Clockwork Commands ===\n", {
        style: { color: "gold", styles: ["bold"] }
      }),

      button("/clockwork status", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/clockwork status"
        }
      }),
      text(" - View current time control status\n", { style: { color: "gray" } }),

      button("/clockwork enable", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/clockwork enable"
        }
      }),
      text(" - Enable custom time control\n", { style: { color: "gray" } }),

      button("/clockwork disable", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: "/clockwork disable"
        }
      }),
      text(" - Disable custom time control\n", { style: { color: "gray" } }),

      button("/clockwork speed <type> <value>", {
        variant: "ghost",
        onClick: {
          action: "suggest_command",
          value: "/clockwork speed "
        }
      }),
      text(" - Set day/night speed\n", { style: { color: "gray" } }),

      button("/clockwork set <time>", {
        variant: "ghost",
        onClick: {
          action: "suggest_command",
          value: "/clockwork set "
        }
      }),
      text(" - Set current time\n", { style: { color: "gray" } }),
    ]);

    const messages = await tellraw(
      sender,
      helpMenu.render({ platform: "minecraft", player: sender })
    );
    return { messages };
  }

  @Command(['clock', 'status'])
  @Description('Show current time control status')
  @Permission('player')
  async showStatus({ kv, api, tellraw, params }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const enabled = await this.getConfig(kv, 'enabled', false);
      const currentTime = await this.getConfig(kv, 'currentTime', 0);
      const daySpeed = await this.getConfig(kv, 'daySpeed', 1.0);
      const nightSpeed = await this.getConfig(kv, 'nightSpeed', 1.0);
      const lastCommandTime = await this.getConfig(kv, 'lastCommandTime', Date.now());
      const realTime = await api.timeQuery("daytime");

      const dayDuration = this.calculateRealTimeDuration(
        daySpeed,
        this.NIGHT_START - this.DAY_START
      );
      const nightDuration = this.calculateRealTimeDuration(
        nightSpeed,
        this.FULL_DAY - this.NIGHT_START
      );

      const currentPhase = this.isNightTime(currentTime) ? 'Night' : 'Day';
      const currentSpeed = this.isNightTime(currentTime) ? nightSpeed : daySpeed;

      const statusDisplay = container([
        text("⏰ Clockwork Status ⏰\n", {
          style: { color: "gold", styles: ["bold"] }
        }),

        text("System: ", { style: { color: "gray" } }),
        text(`${enabled ? "Enabled" : "Disabled"}\n`, {
          style: { color: enabled ? "green" : "red" }
        }),

        text("Current Phase: ", { style: { color: "gray" } }),
        text(`${currentPhase}\n`, {
          style: { color: currentPhase === 'Day' ? "yellow" : "blue" }
        }),

        divider(),

        text("Speed Settings\n", { style: { color: "gold" } }),
        text("Day Speed: ", { style: { color: "gray" } }),
        text(`${daySpeed}x\n`, { style: { color: "yellow" } }),
        text("Night Speed: ", { style: { color: "gray" } }),
        text(`${nightSpeed}x\n`, { style: { color: "blue" } }),
        text("Current Speed: ", { style: { color: "gray" } }),
        text(`${currentSpeed}x\n`, { style: { color: "green" } }),

        divider(),

        text("Time Info\n", { style: { color: "gold" } }),
        text("Day Length: ", { style: { color: "gray" } }),
        text(`${this.formatDuration(dayDuration)}\n`, { style: { color: "yellow" } }),
        text("Night Length: ", { style: { color: "gray" } }),
        text(`${this.formatDuration(nightDuration)}\n`, { style: { color: "blue" } }),
        text("Total Day: ", { style: { color: "gray" } }),
        text(`${this.formatDuration(dayDuration + nightDuration)}\n`, { style: { color: "green" } }),

        divider(),

        text("Current Time: ", { style: { color: "gray" } }),
        text(`${Math.floor(currentTime)} ticks\n`, { style: { color: "aqua" } }),
        text("Game Time: ", { style: { color: "gray" } }),
        text(`${realTime} ticks\n`, { style: { color: "aqua" } }),
        text("Last Update: ", { style: { color: "gray" } }),
        text(`${this.formatDuration(Date.now() - lastCommandTime)} ago`, { style: { color: "yellow" } }),

        enabled ? container([
          divider(),
          text("\nQuick Actions:\n", { style: { color: "gold" } }),
          button("Set Day", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: "/clockwork set day"
            }
          }),
          text(" "),
          button("Set Night", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: "/clockwork set night"
            }
          }),
          text(" "),
          button("Disable", {
            variant: "destructive",
            onClick: {
              action: "run_command",
              value: "/clockwork disable"
            }
          })
        ]) : container([
          divider(),
          button("Enable Clockwork", {
            variant: "success",
            onClick: {
              action: "run_command",
              value: "/clockwork enable"
            }
          })
        ])
      ]);

      const messages = await tellraw(
        sender,
        statusDisplay.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }

  // Additional commands follow similar pattern...
  // I'll show one more as example:

  @Command(['clock', 'speed'])
  @Description('Set time progression speed')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'day/night/both' },
    { name: 'speed', type: 'number', description: 'Speed multiplier (1.0 = normal)' }
  ])
  async setSpeed({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;

    try {
      const speed = parseFloat(args.speed?.toString() || "");
      if (isNaN(speed) || speed < 0) {
        throw new Error('Speed must be a positive number');
      }

      switch (args.type?.toLowerCase()) {
        case 'day':
          await this.setConfig(kv, 'daySpeed', speed);
          break;
        case 'night':
          await this.setConfig(kv, 'nightSpeed', speed);
          break;
        case 'both':
          await this.setConfig(kv, 'daySpeed', speed);
          await this.setConfig(kv, 'nightSpeed', speed);
          break;
        default:
          throw new Error('Type must be day, night, or both');
      }

      const successMsg = container([
        text("Speed Updated!\n", {
          style: { color: "green", styles: ["bold"] }
        }),
        text(`${args.type} speed set to `, { style: { color: "gray" } }),
        text(`${speed}x\n`, { style: { color: "gold" } }),
        button("View Status", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork status"
          }
        })
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Speed Update Failed",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }

  @Command(['clock', 'enable'])
  @Description('Enable custom time control')
  @Permission('operator')
  async enableClockwork({ kv, api, tellraw, params }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const currentTime = await api.timeQuery("daytime");
      const now = Date.now();

      await api.executeCommand('gamerule doDaylightCycle false');

      await this.setConfig(kv, 'enabled', true);
      await this.setConfig(kv, 'currentTime', currentTime);
      await this.setConfig(kv, 'lastTick', now);
      await this.setConfig(kv, 'lastCommandTime', now);

      const successMsg = container([
        text("⚡ Clockwork Enabled ⚡\n", {
          style: { color: "green", styles: ["bold"] }
        }),
        text("Custom time control is now active\n", {
          style: { color: "yellow" }
        }),
        divider(),
        button("View Status", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork status"
          }
        }),
        text(" "),
        button("Adjust Speed", {
          variant: "outline",
          onClick: {
            action: "suggest_command",
            value: "/clockwork speed both "
          }
        })
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Enable Failed",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }

  @Command(['clock', 'disable'])
  @Description('Disable custom time control')
  @Permission('operator')
  async disableClockwork({ kv, api, tellraw, params }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      await this.setConfig(kv, 'enabled', false);
      await api.executeCommand('gamerule doDaylightCycle true');

      const successMsg = container([
        text("🔸 Clockwork Disabled 🔸\n", {
          style: { color: "yellow", styles: ["bold"] }
        }),
        text("Vanilla time cycle restored\n", {
          style: { color: "gray" }
        }),
        divider(),
        button("Re-enable", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: "/clockwork enable"
          }
        }),
        text(" "),
        button("View Status", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork status"
          }
        })
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Disable Failed",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }

  @Command(['clock', 'set'])
  @Description('Set the current time')
  @Permission('operator')
  @Argument([
    {
      name: 'time',
      type: 'string',
      description: 'Time value (0-24000) or day/noon/night/midnight'
    }
  ])
  async setTime({ params, kv, api, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;

    try {
      if (!args.time) {
        const timeInfo = container([
          text("🕒 Time Reference Guide 🕒\n", {
            style: { color: "gold", styles: ["bold"] }
          }),
          text("Quick Set Options:\n", { style: { color: "yellow" } }),
          button("day", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: "/clockwork set day"
            }
          }),
          text(" (1000) "),
          button("noon", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: "/clockwork set noon"
            }
          }),
          text(" (6000) "),
          button("night", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: "/clockwork set night"
            }
          }),
          text(" (13000) "),
          button("midnight", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: "/clockwork set midnight"
            }
          }),
          text(" (18000)\n\n"),
          text("Or use a specific tick value (0-24000)", {
            style: { color: "gray" }
          })
        ]);

        const messages = await tellraw(
          sender,
          timeInfo.render({ platform: "minecraft", player: sender })
        );
        return { messages };
      }

      let targetTime: number;
      switch (args.time.toLowerCase()) {
        case 'day':
          targetTime = this.DAY_START + 1000;
          break;
        case 'noon':
          targetTime = this.NOON;
          break;
        case 'night':
          targetTime = this.NIGHT_START + 1000;
          break;
        case 'midnight':
          targetTime = this.MIDNIGHT;
          break;
        default:
          targetTime = parseInt(args.time);
          if (isNaN(targetTime) || targetTime < 0 || targetTime >= this.FULL_DAY) {
            throw new Error('Invalid time value. Use 0-24000 or day/noon/night/midnight');
          }
      }

      const now = Date.now();
      await api.executeCommand(`time set ${targetTime}`);
      await this.setConfig(kv, 'currentTime', targetTime);
      await this.setConfig(kv, 'lastTick', now);
      await this.setConfig(kv, 'lastCommandTime', now);

      const timeNames = {
        [this.DAY_START + 1000]: 'day',
        [this.NOON]: 'noon',
        [this.NIGHT_START + 1000]: 'night',
        [this.MIDNIGHT]: 'midnight'
      };

      const successMsg = container([
        text("⏰ Time Updated ⏰\n", {
          style: { color: "green", styles: ["bold"] }
        }),
        text("Set to: ", { style: { color: "gray" } }),
        text(`${timeNames[targetTime] || targetTime}\n`, {
          style: { color: "yellow" }
        }),

        divider(),

        text("Quick Set:\n", { style: { color: "gold" } }),
        button("Day", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork set day"
          }
        }),
        text(" "),
        button("Noon", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork set noon"
          }
        }),
        text(" "),
        button("Night", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork set night"
          }
        }),
        text(" "),
        button("Midnight", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork set midnight"
          }
        }),

        divider(),

        button("View Status", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork status"
          }
        })
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Time Set Failed",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }

  @Command(['clock', 'reset'])
  @Description('Reset all settings to default')
  @Permission('operator')
  async resetSettings({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const confirmMsg = container([
        text("⚠️ Reset Confirmation ⚠️\n", {
          style: { color: "red", styles: ["bold"] }
        }),
        text("This will reset all Clockwork settings to default values:\n", {
          style: { color: "yellow" }
        }),
        text("• Disable time control\n", { style: { color: "gray" } }),
        text("• Reset day/night speeds to 1.0x\n", { style: { color: "gray" } }),
        text("• Clear all custom timings\n", { style: { color: "gray" } }),
        divider(),
        button("Confirm Reset", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: "/clockwork confirm-reset"
          }
        }),
        text(" "),
        button("Cancel", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork status"
          }
        })
      ]);

      const messages = await tellraw(
        sender,
        confirmMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Reset Failed",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }

  @Command(['clock', 'confirm-reset'])
  @Description('Confirm settings reset')
  @Permission('operator')
  async confirmReset({ params, kv, api, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      // Reset all settings to default
      await this.setConfig(kv, 'enabled', false);
      await this.setConfig(kv, 'daySpeed', 1.0);
      await this.setConfig(kv, 'nightSpeed', 1.0);
      await this.setConfig(kv, 'currentTime', 0);
      await this.setConfig(kv, 'lastTick', Date.now());
      await this.setConfig(kv, 'lastCommandTime', Date.now());

      await api.executeCommand('gamerule doDaylightCycle true');

      const successMsg = container([
        text("🔄 Settings Reset Complete 🔄\n", {
          style: { color: "green", styles: ["bold"] }
        }),
        text("All settings have been restored to defaults\n", {
          style: { color: "yellow" }
        }),
        divider(),
        button("View Status", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/clockwork status"
          }
        }),
        text(" "),
        button("Enable Clockwork", {
          variant: "success",
          onClick: {
            action: "run_command",
            value: "/clockwork enable"
          }
        })
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Reset Failed",
        description: error.message
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender })
      );
      return { messages };
    }
  }
}
