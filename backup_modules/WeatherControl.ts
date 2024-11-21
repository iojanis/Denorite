import { Module, Command, Description, Permission, Event, Argument } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface WeatherControlState {
  enabled: boolean;
  currentWeather: 'clear' | 'rain' | 'thunder';
  duration: number;             // Duration in seconds
  customCycle: boolean;         // Whether custom weather cycle is enabled
  cycleSettings: {
    clear: {
      minDuration: number;      // In seconds
      maxDuration: number;
      weight: number;           // Probability weight
    };
    rain: {
      minDuration: number;
      maxDuration: number;
      weight: number;
    };
    thunder: {
      minDuration: number;
      maxDuration: number;
      weight: number;
    };
  };
  lastChange: number;           // Timestamp of last weather change
  nextChange: number;           // Timestamp of next scheduled change
  regionWeather: Record<string, {
    weather: 'clear' | 'rain' | 'thunder';
    until: number;
  }>;
}

@Module({
  name: 'WeatherControl',
  version: '1.0.0',
  servers: 'all'
})
export class WeatherControl {
  private readonly UPDATE_INTERVAL = 5000; // Check weather every 5 seconds
  private readonly DEFAULT_DURATION = 6000; // Default duration in seconds
  private readonly VANILLA_DURATIONS = {
    clear: { min: 12000, max: 180000 },  // 10-150 minutes
    rain: { min: 12000, max: 24000 },    // 10-20 minutes
    thunder: { min: 3600, max: 15600 }   // 3-13 minutes
  };

  private async getState(kv: any): Promise<WeatherControlState> {
    const state = await kv.get(['weathercontrol', 'state']);
    return state.value || {
      enabled: false,
      currentWeather: 'clear',
      duration: this.DEFAULT_DURATION,
      customCycle: false,
      cycleSettings: {
        clear: {
          minDuration: this.VANILLA_DURATIONS.clear.min,
          maxDuration: this.VANILLA_DURATIONS.clear.max,
          weight: 70
        },
        rain: {
          minDuration: this.VANILLA_DURATIONS.rain.min,
          maxDuration: this.VANILLA_DURATIONS.rain.max,
          weight: 20
        },
        thunder: {
          minDuration: this.VANILLA_DURATIONS.thunder.min,
          maxDuration: this.VANILLA_DURATIONS.thunder.max,
          weight: 10
        }
      },
      lastChange: 0,
      nextChange: 0,
      regionWeather: {}
    };
  }

  private async setState(kv: any, newState: Partial<WeatherControlState>): Promise<void> {
    const currentState = await this.getState(kv);
    await kv.set(['weathercontrol', 'state'], {
      ...currentState,
      ...newState
    });
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  }

  private pickNextWeather(settings: WeatherControlState['cycleSettings']): 'clear' | 'rain' | 'thunder' {
    const totalWeight = settings.clear.weight + settings.rain.weight + settings.thunder.weight;
    const random = Math.random() * totalWeight;
    
    if (random < settings.clear.weight) return 'clear';
    if (random < settings.clear.weight + settings.rain.weight) return 'rain';
    return 'thunder';
  }

  private getRandomDuration(type: 'clear' | 'rain' | 'thunder', settings: WeatherControlState['cycleSettings']): number {
    const { minDuration, maxDuration } = settings[type];
    return Math.floor(Math.random() * (maxDuration - minDuration + 1) + minDuration);
  }

  @Event('server_started')
  async handleServerStart({ api, kv, log }: ScriptContext): Promise<void> {
    try {
      await api.executeCommand('gamerule doWeatherCycle false');
      
      const now = Date.now();
      await this.setState(kv, {
        enabled: true,
        lastChange: now,
        nextChange: now + (this.DEFAULT_DURATION * 1000)
      });

      log('WeatherControl module initialized');
    } catch (error) {
      log(`Error initializing WeatherControl: ${error.message}`);
    }
  }

  @Event('server_tick_start')
  async handleServerTick({ api, kv }: ScriptContext): Promise<void> {
    try {
      const state = await this.getState(kv);
      if (!state.enabled || !state.customCycle) return;

      const now = Date.now();
      if (now >= state.nextChange) {
        const nextWeather = this.pickNextWeather(state.cycleSettings);
        const duration = this.getRandomDuration(nextWeather, state.cycleSettings);

        await api.executeCommand(`weather ${nextWeather}`);
        await this.setState(kv, {
          currentWeather: nextWeather,
          lastChange: now,
          nextChange: now + (duration * 1000)
        });
      }
    } catch (error) {
      // Silently fail for tick events
    }
  }

  @Command(['weathercontrol', 'set'])
  @Description('Set the current weather')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'Weather type (clear/rain/thunder)', optional: true },
    { name: 'duration', type: 'number', description: 'Duration in seconds', optional: true }
  ])
  async setWeather({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender, args } = params;

    try {
      if (!args.type) {
        const state = await this.getState(kv);
        await api.tellraw(sender, JSON.stringify([
          {
            text: 'Current Weather Info:\n',
            color: 'gold'
          },
          {
            text: `Weather: ${state.currentWeather}\n`,
            color: 'yellow'
          },
          {
            text: 'Usage: /weather set <clear/rain/thunder> [duration]\n',
            color: 'gray'
          }
        ]));
        return;
      }

      const weatherType = args.type.toLowerCase();
      if (!['clear', 'rain', 'thunder'].includes(weatherType)) {
        throw new Error('Invalid weather type. Use clear, rain, or thunder');
      }

      const duration = args.duration || this.DEFAULT_DURATION;
      if (duration < 0) {
        throw new Error('Duration cannot be negative');
      }

      const now = Date.now();
      await api.executeCommand(`weather ${weatherType}`);
      await this.setState(kv, {
        currentWeather: weatherType as WeatherControlState['currentWeather'],
        duration,
        lastChange: now,
        nextChange: now + (duration * 1000)
      });

      await api.tellraw(sender, JSON.stringify({
        text: `Weather set to ${weatherType} for ${this.formatDuration(duration)}`,
        color: 'green'
      }));
    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
    }
  }

  @Command(['weathercontrol', 'cycle'])
  @Description('Configure weather cycle settings')
  @Permission('operator')
  @Argument([
    { name: 'action', type: 'string', description: 'enable/disable/config', optional: true }
  ])
  async configureCycle({ params, kv, api }: ScriptContext): Promise<void> {
    const { sender, args } = params;

    try {
      if (!args.action) {
        const state = await this.getState(kv);
        await api.tellraw(sender, JSON.stringify([
          {
            text: '=== Weather Cycle Settings ===\n',
            color: 'gold',
            bold: true
          },
          {
            text: `Custom Cycle: ${state.customCycle ? 'Enabled' : 'Disabled'}\n\n`,
            color: state.customCycle ? 'green' : 'red'
          },
          {
            text: '=== Clear Weather ===\n',
            color: 'yellow'
          },
          {
            text: `Duration: ${this.formatDuration(state.cycleSettings.clear.minDuration)} - ${this.formatDuration(state.cycleSettings.clear.maxDuration)}\n`,
            color: 'yellow'
          },
          {
            text: `Weight: ${state.cycleSettings.clear.weight}%\n\n`,
            color: 'yellow'
          },
          {
            text: '=== Rain ===\n',
            color: 'aqua'
          },
          {
            text: `Duration: ${this.formatDuration(state.cycleSettings.rain.minDuration)} - ${this.formatDuration(state.cycleSettings.rain.maxDuration)}\n`,
            color: 'aqua'
          },
          {
            text: `Weight: ${state.cycleSettings.rain.weight}%\n\n`,
            color: 'aqua'
          },
          {
            text: '=== Thunder ===\n',
            color: 'blue'
          },
          {
            text: `Duration: ${this.formatDuration(state.cycleSettings.thunder.minDuration)} - ${this.formatDuration(state.cycleSettings.thunder.maxDuration)}\n`,
            color: 'blue'
          },
          {
            text: `Weight: ${state.cycleSettings.thunder.weight}%\n\n`,
            color: 'blue'
          },
          {
            text: 'Usage: /weather cycle <enable/disable/config>\n',
            color: 'gray'
          }
        ]));
        return;
      }

      switch (args.action.toLowerCase()) {
        case 'enable':
          await this.setState(kv, { customCycle: true });
          await api.tellraw(sender, JSON.stringify({
            text: 'Custom weather cycle enabled',
            color: 'green'
          }));
          break;

        case 'disable':
          await this.setState(kv, { customCycle: false });
          await api.tellraw(sender, JSON.stringify({
            text: 'Custom weather cycle disabled (vanilla weather restored)',
            color: 'yellow'
          }));
          break;

        case 'config':
          const type = args._[1];
          const setting = args._[2];
          const value = parseFloat(args._[3]);

          if (!type || !setting || isNaN(value)) {
            await api.tellraw(sender, JSON.stringify([
              {
                text: 'Usage: /weather cycle config <type> <setting> <value>\n',
                color: 'yellow'
              },
              {
                text: 'Types: clear, rain, thunder\n',
                color: 'gray'
              },
              {
                text: 'Settings: minDuration, maxDuration, weight\n',
                color: 'gray'
              },
              {
                text: 'Example: /weather cycle config rain weight 30',
                color: 'gray'
              }
            ]));
            return;
          }

          const state = await this.getState(kv);
          const settings = { ...state.cycleSettings };

          if (!['clear', 'rain', 'thunder'].includes(type)) {
            throw new Error('Invalid weather type');
          }

          if (!['minDuration', 'maxDuration', 'weight'].includes(setting)) {
            throw new Error('Invalid setting');
          }

          settings[type][setting] = value;

          // Validate settings
          if (setting === 'minDuration' && value > settings[type].maxDuration) {
            throw new Error('minDuration cannot be greater than maxDuration');
          }
          if (setting === 'maxDuration' && value < settings[type].minDuration) {
            throw new Error('maxDuration cannot be less than minDuration');
          }
          if (setting === 'weight' && value < 0) {
            throw new Error('Weight cannot be negative');
          }

          await this.setState(kv, { cycleSettings: settings });
          await api.tellraw(sender, JSON.stringify({
            text: `Updated ${type} ${setting} to ${value}`,
            color: 'green'
          }));
          break;

        default:
          throw new Error('Invalid action. Use enable, disable, or config');
      }
    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
    }
  }

  @Command(['weathercontrol', 'status'])
  @Description('Show current weather status')
  @Permission('operator')
  async showStatus({ kv, api, params }: ScriptContext): Promise<void> {
    const { sender } = params;

    try {
      const state = await this.getState(kv);
      const now = Date.now();
      const timeUntilNext = Math.max(0, state.nextChange - now) / 1000;

      await api.tellraw(sender, JSON.stringify([
        {
          text: '=== Weather Status ===\n',
          color: 'gold',
          bold: true
        },
        {
          text: `Current Weather: ${state.currentWeather}\n`,
          color: 'yellow'
        },
        {
          text: `Time Since Last Change: ${this.formatDuration(Math.floor((now - state.lastChange) / 1000))}\n`,
          color: 'aqua'
        },
        {
          text: `Time Until Next Change: ${this.formatDuration(Math.floor(timeUntilNext))}\n`,
          color: 'aqua'
        },
        {
          text: '\n=== Cycle Status ===\n',
          color: 'gold'
        },
        {
          text: `Custom Cycle: ${state.customCycle ? 'Enabled' : 'Disabled'}\n`,
          color: state.customCycle ? 'green' : 'red'
        },
        {
          text: `Current Duration: ${this.formatDuration(state.duration)}\n`,
          color: 'yellow'
        }
      ]));
    } catch (error) {
      await api.tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
    }
  }
}