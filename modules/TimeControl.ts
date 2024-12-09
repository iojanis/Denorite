import { Module, Command, Description, Permission, Event, Argument } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface TimeControlState {
  enabled: boolean;
  daySpeed: number;
  nightSpeed: number;
  lastTick: number;
  currentTime: number;
  lastCommandTime: number;
}

@Module({
  name: 'TimeControl',
  version: '1.0.0',
  servers: 'all'
})
export class TimeControl {
  private readonly UPDATE_INTERVAL = 1000;
  private readonly DAY_START = 0;
  private readonly NOON = 6000;
  private readonly NIGHT_START = 12000;
  private readonly MIDNIGHT = 18000;
  private readonly FULL_DAY = 24000;

  // Helper methods remain unchanged
  private async getState(kv: any): Promise<TimeControlState> {
    const state = await kv.get(['timecontrol', 'state']);
    return state.value || {
      enabled: false,
      daySpeed: 0.1,
      nightSpeed: 0.1,
      lastTick: 0,
      currentTime: 0,
      lastCommandTime: 0
    };
  }

  private async setState(kv: any, newState: Partial<TimeControlState>): Promise<void> {
    const currentState = await this.getState(kv);
    await kv.set(['timecontrol', 'state'], {
      ...currentState,
      ...newState
    });
  }

  private normalizeTime(time: number): number {
    return ((time % this.FULL_DAY) + this.FULL_DAY) % this.FULL_DAY;
  }

  private shouldUpdateTime(currentState: TimeControlState): boolean {
    const now = Date.now();
    return now - currentState.lastCommandTime >= this.UPDATE_INTERVAL;
  }

  private isNightTime(time: number): boolean {
    const normalizedTime = this.normalizeTime(time);
    return normalizedTime >= this.NIGHT_START && normalizedTime < this.DAY_START + this.FULL_DAY;
  }

  private getCurrentSpeed(state: TimeControlState, time: number): number {
    return this.isNightTime(time) ? state.nightSpeed : state.daySpeed;
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

  @Event('server_started')
  async handleServerStart({ api, kv, log }: ScriptContext): Promise<void> {
    try {
      await api.executeCommand('gamerule doDaylightCycle false');

      const currentTime = await api.timeQuery("daytime");
      const now = Date.now();

      await this.setState(kv, {
        currentTime,
        lastTick: now,
        lastCommandTime: now,
        enabled: true,
        daySpeed: 1.0,
        nightSpeed: 1.0
      });

      log('TimeControl module initialized');
    } catch (error) {
      log(`Error initializing TimeControl: ${error.message}`);
    }
  }

  @Event('server_tick_start')
  async handleServerTick({ api, kv }: ScriptContext): Promise<void> {
    try {
      const state = await this.getState(kv);

      if (!state.enabled) {
        return;
      }

      const now = Date.now();
      const tickDelta = now - state.lastTick;

      const currentSpeed = this.getCurrentSpeed(state, state.currentTime);
      const timeProgress = (tickDelta / 50) * currentSpeed;
      const newTime = this.normalizeTime(state.currentTime + timeProgress);

      if (this.shouldUpdateTime(state)) {
        await api.executeCommand(`time set ${Math.floor(newTime)}`);

        await this.setState(kv, {
          currentTime: newTime,
          lastTick: now,
          lastCommandTime: now
        });
      } else {
        await this.setState(kv, {
          currentTime: newTime,
          lastTick: now
        });
      }
    } catch (error) {
      // Silently fail for tick events
    }
  }

  @Command(['timecontrol', 'enable'])
  @Description('Enable custom time control')
  @Permission('operator')
  async enableTimeControl({ kv, tellraw, params }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender } = params;
    let messages = [];

    try {
      const currentTime = await api.timeQuery("daytime");
      await this.setState(kv, {
        enabled: true,
        currentTime,
        lastTick: Date.now(),
        lastCommandTime: Date.now()
      });

      messages = await tellraw(sender, JSON.stringify({
        text: 'Time control enabled',
        color: 'green'
      }));

      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['timecontrol', 'disable'])
  @Description('Disable custom time control')
  @Permission('operator')
  async disableTimeControl({ kv, api, tellraw, params }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender } = params;
    let messages = [];

    try {
      await this.setState(kv, { enabled: false });
      await api.executeCommand('gamerule doDaylightCycle true');

      messages = await tellraw(sender, JSON.stringify({
        text: 'Time control disabled (vanilla time cycle restored)',
        color: 'yellow'
      }));

      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['timecontrol', 'speed'])
  @Description('Set time progression speed')
  @Permission('operator')
  @Argument([
    { name: 'type', type: 'string', description: 'day/night/both', optional: true },
    { name: 'speed', type: 'number', description: 'Speed multiplier (1.0 = normal speed)', optional: true }
  ])
  async setTimeSpeed({ kv, tellraw, params }: ScriptContext): Promise<{
    messages: any[],
    success?: boolean,
    speeds?: { day: number, night: number }
  }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const state = await this.getState(kv);

      if (!args.type) {
        messages = await tellraw(sender, JSON.stringify([
          {
            text: 'Current Speed Settings:\n',
            color: 'gold'
          },
          {
            text: `Day Speed: ${state.daySpeed}x\n`,
            color: 'yellow'
          },
          {
            text: `Night Speed: ${state.nightSpeed}x\n`,
            color: 'yellow'
          },
          {
            text: 'Usage: /timecontrol speed <day/night/both> <speed>',
            color: 'gray'
          }
        ]));
        return { messages, success: true, speeds: { day: state.daySpeed, night: state.nightSpeed } };
      }

      if (args.speed === undefined) {
        const speedValue = args.type === 'day' ? state.daySpeed :
          args.type === 'night' ? state.nightSpeed :
            `day: ${state.daySpeed}x, night: ${state.nightSpeed}x`;
        messages = await tellraw(sender, JSON.stringify({
          text: `Current ${args.type} speed: ${speedValue}`,
          color: 'yellow'
        }));
        return { messages, success: true, speeds: { day: state.daySpeed, night: state.nightSpeed } };
      }

      const speed = parseFloat(args.speed.toString());
      if (isNaN(speed) || speed < 0) {
        throw new Error('Speed must be a positive number');
      }

      let newState: Partial<TimeControlState> = {};
      switch (args.type.toLowerCase()) {
        case 'day':
          newState = { daySpeed: speed };
          break;
        case 'night':
          newState = { nightSpeed: speed };
          break;
        case 'both':
          newState = { daySpeed: speed, nightSpeed: speed };
          break;
        default:
          throw new Error('Type must be day, night, or both');
      }

      await this.setState(kv, newState);
      const updatedState = await this.getState(kv);

      messages = await tellraw(sender, JSON.stringify({
        text: `${args.type} speed set to ${speed}x`,
        color: 'green'
      }));

      return {
        messages,
        success: true,
        speeds: { day: updatedState.daySpeed, night: updatedState.nightSpeed }
      };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['timecontrol', 'status'])
  @Description('Show current time control status')
  @Permission('operator')
  async showStatus({ kv, api, tellraw, params }: ScriptContext): Promise<{
    messages: any[],
    success?: boolean,
    state?: TimeControlState
  }> {
    const { sender } = params;
    let messages = [];

    try {
      const state = await this.getState(kv);
      const realTime = await api.timeQuery("daytime");

      const dayDuration = this.calculateRealTimeDuration(
        state.daySpeed,
        this.NIGHT_START - this.DAY_START
      );
      const nightDuration = this.calculateRealTimeDuration(
        state.nightSpeed,
        this.FULL_DAY - this.NIGHT_START
      );
      const fullDayDuration = dayDuration + nightDuration;

      const currentPhase = this.isNightTime(state.currentTime) ? 'Night' : 'Day';
      const currentSpeed = this.getCurrentSpeed(state, state.currentTime);

      messages = await tellraw(sender, JSON.stringify([
        {
          text: '=== Time Control Status ===\n',
          color: 'gold',
          bold: true
        },
        {
          text: `Enabled: ${state.enabled}\n`,
          color: state.enabled ? 'green' : 'red'
        },
        {
          text: `Current Phase: ${currentPhase}\n`,
          color: currentPhase === 'Day' ? 'yellow' : 'blue'
        },
        {
          text: '=== Speed Settings ===\n',
          color: 'gold'
        },
        {
          text: `Day Speed: ${state.daySpeed}x\n`,
          color: 'yellow'
        },
        {
          text: `Night Speed: ${state.nightSpeed}x\n`,
          color: 'blue'
        },
        {
          text: `Current Speed: ${currentSpeed}x\n`,
          color: 'green'
        },
        {
          text: '=== Real Time Durations ===\n',
          color: 'gold'
        },
        {
          text: `Daytime: ${this.formatDuration(dayDuration)}\n`,
          color: 'yellow'
        },
        {
          text: `Nighttime: ${this.formatDuration(nightDuration)}\n`,
          color: 'blue'
        },
        {
          text: `Full Day: ${this.formatDuration(fullDayDuration)}\n`,
          color: 'green'
        },
        {
          text: '=== Current Time ===\n',
          color: 'gold'
        },
        {
          text: `Internal Time: ${Math.floor(state.currentTime)}\n`,
          color: 'aqua'
        },
        {
          text: `Game Time: ${realTime}\n`,
          color: 'aqua'
        },
        {
          text: `Last Update: ${this.formatDuration(Date.now() - state.lastCommandTime)} ago`,
          color: 'gray'
        }
      ]));

      return { messages, success: true, state };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['timecontrol', 'set'])
  @Description('Set the current time')
  @Permission('operator')
  @Argument([
    { name: 'time', type: 'string', description: 'Time value (0-24000) or day/noon/night/midnight', optional: true }
  ])
  async setTime({ params, kv, api, tellraw }: ScriptContext): Promise<{
    messages: any[],
    success?: boolean,
    time?: number
  }> {
    const { sender, args } = params;
    let messages = [];

    try {
      if (!args.time) {
        const realTime = await api.timeQuery("daytime");
        messages = await tellraw(sender, JSON.stringify([
          {
            text: 'Current Time Info:\n',
            color: 'gold'
          },
          {
            text: `Game Time: ${realTime}\n`,
            color: 'yellow'
          },
          {
            text: 'Usage: /timecontrol set <time>\n',
            color: 'gray'
          },
          {
            text: 'Valid times: day (1000), noon (6000), night (13000), midnight (18000), or 0-24000',
            color: 'gray'
          }
        ]));
        return { messages, success: true, time: realTime };
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
            throw new Error('Invalid time value. Use a number between 0-24000 or day/noon/night/midnight');
          }
      }

      await api.executeCommand(`time set ${targetTime}`);
      const now = Date.now();
      await this.setState(kv, {
        currentTime: targetTime,
        lastTick: now,
        lastCommandTime: now
      });

      let timeDesc = '';
      if (targetTime === this.DAY_START + 1000) timeDesc = 'day';
      else if (targetTime === this.NOON) timeDesc = 'noon';
      else if (targetTime === this.NIGHT_START + 1000) timeDesc = 'night';
      else if (targetTime === this.MIDNIGHT) timeDesc = 'midnight';
      else timeDesc = String(targetTime);

      messages = await tellraw(sender, JSON.stringify({
        text: `Time set to ${timeDesc}`,
        color: 'green'
      }));

      return { messages, success: true, time: targetTime };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: 'red'
      }));
      return { messages, success: false, error: error.message };
    }
  }
}
