import { Module, Command, Description, Permission, Argument, Event } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface Kill {
  victim: string;
  killer: string;
  timestamp: string;
  location: {
    x: number;
    y: number;
    z: number;
  };
}

interface Bounty {
  playerId: string;
  amount: number;
  kills: Kill[];
  lastKill: string;
  active: boolean;
  pardonedBy?: string;
  pardonedAt?: string;
}

@Module({
  name: 'Paladin',
  version: '1.0.0',
  description: 'Justice system with bounties and pardons'
})
export class Paladin {
  private readonly INITIAL_BOUNTY = 10;         // Initial bounty amount
  private readonly BOUNTY_MULTIPLIER = 2;       // Each subsequent kill doubles the bounty
  private readonly BAN_THRESHOLD = -111;        // Ban threshold for negative balance
  private readonly RECENT_KILL_TIME = 300000;   // 5 minutes in milliseconds

  private async getBounty(kv: any, playerId: string): Promise<Bounty | null> {
    const result = await kv.get(['paladin', 'bounties', playerId]);
    return result.value;
  }

  private async getActiveBounties(kv: any): Promise<Bounty[]> {
    const bounties: Bounty[] = [];
    const iterator = kv.list({ prefix: ['paladin', 'bounties'] });
    for await (const entry of iterator) {
      const bounty = entry.value as Bounty;
      if (bounty.active) {
        bounties.push(bounty);
      }
    }
    return bounties;
  }

  private calculateBountyAmount(killCount: number): number {
    return this.INITIAL_BOUNTY * Math.pow(this.BOUNTY_MULTIPLIER, killCount - 1);
  }

  private async processBountyCollection(kv: any, target: string, collector: string, bountyAmount: number): Promise<void> {
    // Add money to collector
    const collectorBalanceResult = await kv.get(['plugins', 'economy', 'balances', collector]);
    const collectorBalance = collectorBalanceResult.value ? Number(collectorBalanceResult.value) : 0;

    // Remove money from target
    const targetBalanceResult = await kv.get(['plugins', 'economy', 'balances', target]);
    const targetBalance = targetBalanceResult.value ? Number(targetBalanceResult.value) : 0;

    await kv.atomic()
      .set(['plugins', 'economy', 'balances', collector], new Deno.KvU64(BigInt(collectorBalance + bountyAmount)))
      .set(['plugins', 'economy', 'balances', target], new Deno.KvU64(BigInt(targetBalance - bountyAmount)))
      .commit();
  }

  @Event('player_death')
  async handlePlayerDeath({ params, kv, tellraw, log, api }: ScriptContext): Promise<{ messages: any[] }> {
    const { victim, killer, x, y, z } = params;
    let messages = [];

    try {
      // Only process player kills (not environment/mob deaths)
      if (!killer || killer === victim) {
        return { messages };
      }

      const kill: Kill = {
        victim,
        killer,
        timestamp: new Date().toISOString(),
        location: { x: Number(x), y: Number(y), z: Number(z) }
      };

      // Get or create killer's bounty record
      let bounty = await this.getBounty(kv, killer);
      if (!bounty) {
        bounty = {
          playerId: killer,
          amount: this.INITIAL_BOUNTY,
          kills: [kill],
          lastKill: kill.timestamp,
          active: true
        };
      } else {
        bounty.kills.push(kill);
        bounty.amount = this.calculateBountyAmount(bounty.kills.length);
        bounty.lastKill = kill.timestamp;
        bounty.active = true;
        // Clear any previous pardon
        bounty.pardonedBy = undefined;
        bounty.pardonedAt = undefined;
      }

      await kv.set(['paladin', 'bounties', killer], bounty);

      // Check recent kills (last 5 minutes)
      const recentKills = bounty.kills.filter(k =>
        new Date(kill.timestamp).getTime() - new Date(k.timestamp).getTime() <= this.RECENT_KILL_TIME
      ).length;

      // Process bounty collection if victim had an active bounty
      const victimBounty = await this.getBounty(kv, victim);
      if (victimBounty?.active) {
        await this.processBountyCollection(kv, victim, killer, victimBounty.amount);

        // Deactivate the collected bounty
        victimBounty.active = false;
        await kv.set(['paladin', 'bounties', victim], victimBounty);

        messages = await tellraw(killer, JSON.stringify([
          {text: "Bounty Collected!\n", color: "gold", bold: true},
          {text: "You received ", color: "gray"},
          {text: `${victimBounty.amount} XPL`, color: "yellow"},
          {text: " for bringing ", color: "gray"},
          {text: victim, color: "red"},
          {text: " to justice!", color: "gray"}
        ]));
      }

      // Announce new bounty
      messages = await this.broadcastBounty(tellraw, bounty, recentKills);

      // Check if killer should be banned
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', killer]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (balance <= this.BAN_THRESHOLD) {
        // Ban the player
        await api.ban(killer, JSON.stringify({
          reason: `Balance below ${this.BAN_THRESHOLD} XPL due to excessive killing`,
          by: "Paladin System"
        }));

        messages = await tellraw('@a', JSON.stringify([
          {text: "JUSTICE SERVED\n", color: "dark_red", bold: true},
          {text: killer, color: "red"},
          {text: " has been banned for their crimes!", color: "gray"}
        ]));
      }

      log(`Player ${killer} killed ${victim}, new bounty: ${bounty.amount} XPL`);
      return { messages };
    } catch (error) {
      log(`Error in death handler: ${error.message}`);
      return { messages };
    }
  }

  private async broadcastBounty(tellraw: any, bounty: Bounty, recentKills: number): Promise<any[]> {
    let messages = [];

    const baseMessage = [
      { text: "⚔ BOUNTY NOTICE ⚔\n", color: "dark_red", bold: true },
      { text: bounty.playerId, color: "red" },
      { text: " has killed ", color: "gray" },
      { text: bounty.kills[bounty.kills.length - 1].victim, color: "yellow" },
      { text: "\nBounty: ", color: "gray" },
      { text: `${bounty.amount} XPL`, color: "gold" }
    ];

    if (recentKills > 1) {
      baseMessage.push(
        { text: "\nWarning: ", color: "dark_red", bold: true },
        { text: `${recentKills} kills in the last 5 minutes!`, color: "red" }
      );
    }

    baseMessage.push(
      { text: "\n\n" },
      {
        text: "[Track Location]",
        color: "green",
        clickEvent: {
          action: "run_command",
          value: `/paladin track ${bounty.playerId}`
        },
        hoverEvent: {
          action: "show_text",
          value: "Click to track this player"
        }
      },
      { text: "  " },
      {
        text: "[View History]",
        color: "aqua",
        clickEvent: {
          action: "run_command",
          value: `/paladin history ${bounty.playerId}`
        }
      }
    );

    messages = await tellraw('@a', JSON.stringify(baseMessage));
    return messages;
  }

  @Command(['paladin'])
  @Description('Justice system commands')
  @Permission('player')
  async paladin({ params, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      messages = await tellraw(sender, JSON.stringify([
        {text: "=== Paladin Commands ===\n", color: "gold", bold: true},

        {
          text: "/paladin bounties",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/paladin bounties"
          }
        },
        {text: " - List all active bounties\n", color: "gray"},

        {text: "/paladin track <player>", color: "yellow"},
        {text: " - Track a player with bounty\n", color: "gray"},

        {text: "/paladin history <player>", color: "yellow"},
        {text: " - View player's kill history\n", color: "gray"},

        {text: "/paladin status", color: "yellow"},
        {text: " - Check your bounty status\n", color: "gray"},

        {text: "/paladin pardon <player> <amount>", color: "yellow"},
        {text: " - Pay to pardon someone\n", color: "gray"},

        {text: "\n\n", color: "white"},
        {
          text: "[View Active Bounties]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: "/paladin bounties"
          }
        }
      ]));

      return { messages };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['paladin', 'bounties'])
  @Description('List all active bounties')
  @Permission('player')
  async listBounties({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], bounties?: Bounty[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const bounties = await this.getActiveBounties(kv);

      if (bounties.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No active bounties. The realm is peaceful... for now.",
          color: "green",
          italic: true
        }));
        return { messages, bounties: [] };
      }

      messages = await tellraw(sender, JSON.stringify([
        {text: "Active Bounties\n", color: "gold", bold: true},
        {text: "Click on a bounty to track the target\n\n", color: "gray", italic: true}
      ]));

      // Sort bounties by amount (highest first)
      bounties.sort((a, b) => b.amount - a.amount);

      for (const bounty of bounties) {
        const recentKill = new Date(bounty.lastKill).getTime() > Date.now() - this.RECENT_KILL_TIME;

        messages = await tellraw(sender, JSON.stringify([
          {text: "• ", color: "dark_red"},
          {
            text: bounty.playerId,
            color: recentKill ? "red" : "yellow",
            clickEvent: {
              action: "run_command",
              value: `/paladin track ${bounty.playerId}`
            },
            hoverEvent: {
              action: "show_text",
              value: "Click to track this player"
            }
          },
          {text: ` - ${bounty.amount} XPL`, color: "gold"},
          {text: ` (${bounty.kills.length} kills)`, color: "gray"},
          recentKill ? [
            {text: " ", color: "white"},
            {text: "ACTIVE THREAT", color: "red", bold: true}
          ] : [],
          {text: "\n"}
        ]));
      }

      log(`Bounties listed by ${sender}`);
      return { messages, bounties };
    } catch (error) {
      log(`Error listing bounties: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['paladin', 'track'])
  @Description('Track a player with bounty')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to track' }
  ])
  async trackPlayer({ params, kv, tellraw, api, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const bounty = await this.getBounty(kv, args.player);
      if (!bounty?.active) {
        throw new Error('No active bounty found for this player');
      }

      // Get player's current location
      const position = await api.getPlayerPosition(args.player);
      if (!position) {
        throw new Error('Player not found or offline');
      }

      const { x, y, z } = position;
      const lastKill = bounty.kills[bounty.kills.length - 1];
      const lastKillTime = new Date(bounty.lastKill).getTime();
      const timeSinceKill = Date.now() - lastKillTime;
      const isRecentKill = timeSinceKill <= this.RECENT_KILL_TIME;

      messages = await tellraw(sender, JSON.stringify([
        {text: "⚔ Bounty Target Located ⚔\n", color: "dark_red", bold: true},
        {text: args.player, color: "red"},
        {text: ` - Bounty: `, color: "gray"},
        {text: `${bounty.amount} XPL\n`, color: "gold"},
        {text: "\nCurrent Location:\n", color: "yellow"},
        {
          text: `${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}\n`,
          color: "aqua",
          clickEvent: {
            action: "suggest_command",
            value: `/tp ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)}`
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to copy coordinates"
          }
        },
        {text: "\nLast Kill:\n", color: "gray"},
        {text: `Victim: `, color: "gray"},
        {text: lastKill.victim + "\n", color: "yellow"},
        {text: "Location: ", color: "gray"},
        {
          text: `${Math.floor(lastKill.location.x)}, ${Math.floor(lastKill.location.y)}, ${Math.floor(lastKill.location.z)}\n`,
          color: "aqua",
          clickEvent: {
            action: "suggest_command",
            value: `/tp ${Math.floor(lastKill.location.x)} ${Math.floor(lastKill.location.y)} ${Math.floor(lastKill.location.z)}`
          }
        },
        {text: "Time: ", color: "gray"},
        {text: `${Math.floor(timeSinceKill / 60000)} minutes ago\n`, color: "yellow"},

        isRecentKill ? [
          {text: "\nWARNING: ", color: "dark_red", bold: true},
          {text: "Target killed recently! Approach with caution!\n", color: "red"}
        ] : [],

        {text: "\nActions:\n", color: "gold"},
        {
          text: "[Update Location] ",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: `/paladin track ${args.player}`
          }
        },
        {
          text: "[View History] ",
          color: "aqua",
          clickEvent: {
            action: "run_command",
            value: `/paladin history ${args.player}`
          }
        },
        {
          text: "[Pardon]",
          color: "light_purple",
          clickEvent: {
            action: "suggest_command",
            value: `/paladin pardon ${args.player} `
          }
        }
      ]));

      // Create tracking compass
      await api.give(sender, 'minecraft:compass{display:{Name:\'{"text":"Bounty Tracker","color":"red","italic":false}\',Lore:[\'{"text":"Tracking: ' + args.player + '","color":"gray"}\']}}');

      log(`${sender} is tracking ${args.player} (bounty: ${bounty.amount} XPL)`);
      return { messages };
    } catch (error) {
      log(`Error tracking player: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['paladin', 'history'])
  @Description('View player\'s kill history')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to check' }
  ])
  async viewHistory({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], bounty?: Bounty }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const bounty = await this.getBounty(kv, args.player);
      if (!bounty) {
        throw new Error('No history found for this player');
      }

      messages = await tellraw(sender, JSON.stringify([
        {text: "Kill History for ", color: "gold"},
        {text: args.player + "\n", color: bounty.active ? "red" : "gray"},
        {text: "Total Kills: ", color: "gray"},
        {text: `${bounty.kills.length}\n`, color: "yellow"},
        bounty.active ? [
          {text: "Current Bounty: ", color: "gray"},
          {text: `${bounty.amount} XPL\n`, color: "gold"}
        ] : [],
        bounty.pardonedBy ? [
          {text: "Pardoned by: ", color: "gray"},
          {text: bounty.pardonedBy, color: "green"},
          {text: ` on ${new Date(bounty.pardonedAt!).toLocaleString()}\n`, color: "gray"}
        ] : [],
        {text: "\nRecent Kills:\n", color: "dark_red"}
      ]));

      // Show last 10 kills, most recent first
      const recentKills = [...bounty.kills]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      for (const kill of recentKills) {
        const killTime = new Date(kill.timestamp).getTime();
        const timeSince = Date.now() - killTime;
        const isRecent = timeSince <= this.RECENT_KILL_TIME;

        messages = await tellraw(sender, JSON.stringify([
          {text: "• ", color: isRecent ? "dark_red" : "gray"},
          {text: kill.victim, color: "yellow"},
          {text: ` at `, color: "gray"},
          {
            text: `${Math.floor(kill.location.x)}, ${Math.floor(kill.location.y)}, ${Math.floor(kill.location.z)}`,
            color: "aqua",
            clickEvent: {
              action: "suggest_command",
              value: `/tp ${Math.floor(kill.location.x)} ${Math.floor(kill.location.y)} ${Math.floor(kill.location.z)}`
            }
          },
          {text: `\n  ${new Date(kill.timestamp).toLocaleString()}`, color: "gray"},
          isRecent ? [
            {text: " ", color: "white"},
            {text: "RECENT", color: "red", bold: true}
          ] : [],
          {text: "\n"}
        ]));
      }

      log(`${sender} viewed kill history for ${args.player}`);
      return { messages, bounty };
    } catch (error) {
      log(`Error viewing history: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['paladin', 'pardon'])
  @Description('Pay to pardon someone\'s bounty')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'Player to pardon' },
    { name: 'amount', type: 'integer', description: 'Amount to pay' }
  ])
  async pardonPlayer({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const bounty = await this.getBounty(kv, args.player);
      if (!bounty?.active) {
        throw new Error('No active bounty found for this player');
      }

      if (args.amount <= 0) {
        throw new Error('Pardon amount must be positive');
      }

      if (sender === args.player) {
        throw new Error('You cannot pardon yourself');
      }

      // Check pardoner's balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (balance < args.amount) {
        throw new Error(`Insufficient funds. You have ${balance} XPL`);
      }

      // Process pardon payment
      const targetBalanceResult = await kv.get(['plugins', 'economy', 'balances', args.player]);
      const targetBalance = targetBalanceResult.value ? Number(targetBalanceResult.value) : 0;

      const result = await kv.atomic()
        .check(balanceResult)
        .check({ key: ['paladin', 'bounties', args.player], versionstamp: null })
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(balance - args.amount)))
        .set(['plugins', 'economy', 'balances', args.player], new Deno.KvU64(BigInt(targetBalance + args.amount)))
        .commit();

      if (!result.ok) {
        throw new Error('Failed to process pardon payment');
      }

      // Update bounty status
      bounty.active = false;
      bounty.pardonedBy = sender;
      bounty.pardonedAt = new Date().toISOString();
      await kv.set(['paladin', 'bounties', args.player], bounty);

      // Notify players
      messages = await tellraw('@a',[
        {text: "✧ PARDON GRANTED ✧\n", color: "green", bold: true},
        {text: sender, color: "aqua"},
        {text: " has pardoned ", color: "gray"},
        {text: args.player, color: "yellow"},
        {text: " by paying ", color: "gray"},
        {text: `${args.amount} XPL`, color: "gold"}
      ]);

      log(`${sender} pardoned ${args.player} for ${args.amount} XPL`);
      return { messages, success: true };
    } catch (error) {
      log(`Error pardoning player: ${error.message}`);
      messages = await tellraw(sender, {
        text: `Error: ${error.message}`,
        color: "red"
      });
      return { messages, success: false, error: error.message };
    }
  }
}
