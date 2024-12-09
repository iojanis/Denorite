import {Module, Command, Description, Permission, Socket, Argument, Event, Online} from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

interface EconomyConfig {
  minDepositAmount: number;
  welcomeBonus: number;
  transferFee: number;
}

interface Transaction {
  timestamp: string;
  type: 'deposit' | 'withdraw' | 'transfer' | 'bonus';
  amount: number;
  balance: number;
  description: string;
}

@Module({
  name: 'Economy',
  version: '1.1.1',
})
export class Economy {
  private readonly DEFAULT_CONFIG: EconomyConfig = {
    minDepositAmount: 5,
    welcomeBonus: 10,
    transferFee: 0.1
  };

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async getConfig(kv: any): Promise<EconomyConfig> {
    const config = await kv.get(['plugins', 'economy', 'config']);
    return config.value || this.DEFAULT_CONFIG;
  }

  private async getBalance(kv: any, player: string): Promise<number> {
    const record = await kv.get(['plugins', 'economy', 'balances', player]);
    return record.value ? Number(record.value) : 0;
  }

  private async addTransaction(kv: any, player: string, transaction: Transaction): Promise<void> {
    const key = ['plugins', 'economy', 'transactions', player];
    const existing = await kv.get(key);
    const transactions = existing.value || [];

    transactions.unshift(transaction);
    if (transactions.length > 50) transactions.length = 50;

    await kv.set(key, transactions);
  }

  @Event('player_joined')
  async handlePlayerSync({ params, kv, tellraw, api }: ScriptContext): Promise<{ messages: any[] }> {
    const { playerName } = params;
    let messages = [];

    await this.delay(1000);

    if (true) {
      const balance = await this.getBalance(kv, playerName);
      const config = await this.getConfig(kv);

      messages = await tellraw(playerName, JSON.stringify([
        { text: "Welcome to ", color: "gold" },
        { text: "XP Bank", color: "green", bold: true },
        { text: "!\n", color: "gold" },
        { text: `Your current balance: `, color: "yellow" },
        { text: `${balance} XPL`, color: "green", bold: true }
      ]));

      if (balance === 0 && config.welcomeBonus > 0) {
        await kv.set(['plugins', 'economy', 'balances', playerName], new Deno.KvU64(BigInt(config.welcomeBonus)));
        await this.addTransaction(kv, playerName, {
          timestamp: new Date().toISOString(),
          type: 'bonus',
          amount: config.welcomeBonus,
          balance: config.welcomeBonus,
          description: 'Welcome bonus'
        });

        messages = await tellraw(playerName, JSON.stringify({
          text: `You received a welcome bonus of ${config.welcomeBonus} XPL!`,
          color: "green"
        }));
      }
    }

    return { messages };
  }

  @Command(['bank'])
  @Description('Bank management commands')
  @Permission('player')
  async bank({ params, kv, tellraw, api }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const balance = await this.getBalance(kv, sender);
      const config = await this.getConfig(kv);

      messages = await tellraw(sender, JSON.stringify([
        { text: "=== XP Bank Commands ===\n", color: "gold", bold: true },
        { text: "Current Balance: ", color: "yellow" },
        { text: `${balance} XPL\n\n`, color: "green", bold: true },
        {
          text: "/bank balance",
          color: "yellow",
          clickEvent: {
            action: "run_command",
            value: "/bank balance"
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to view your balance and recent transactions"
          }
        },
        { text: " - View your balance and recent transactions\n", color: "gray" },
        { text: `/bank deposit <amount>`, color: "yellow" },
        { text: ` - Deposit XP levels (min: ${config.minDepositAmount} XPL)\n`, color: "gray" },
        { text: "/bank withdraw <amount>", color: "yellow" },
        { text: " - Withdraw XP levels\n", color: "gray" },
        { text: "/bank send <player> <amount>", color: "yellow" },
        { text: ` - Send XPL to another player (fee: ${config.transferFee} XPL)\n`, color: "gray" },
        { text: "\n\n", color: "white" },
        {
          text: "[Suggest Command]",
          color: "green",
          clickEvent: {
            action: "suggest_command",
            value: "/bank "
          },
          hoverEvent: {
            action: "show_text",
            value: "Click to write a bank command"
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

  @Command(['bank', 'config'])
  @Description('Configure bank settings')
  @Permission('operator')
  @Argument([
    { name: 'setting', type: 'string', description: 'Setting to change (minDeposit/welcomeBonus/transferFee)' },
    { name: 'value', type: 'integer', description: 'New value' }
  ])
  async configureBank({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const config = await this.getConfig(kv);

      switch (args.setting.toLowerCase()) {
        case 'mindeposit':
          config.minDepositAmount = Math.max(0, args.value);
          break;
        case 'welcomebonus':
          config.welcomeBonus = Math.max(0, args.value);
          break;
        case 'transferfee':
          config.transferFee = Math.max(0, args.value);
          break;
        default:
          throw new Error('Invalid setting. Use minDeposit, welcomeBonus, or transferFee');
      }

      await kv.set(['plugins', 'economy', 'config'], config);
      messages = await tellraw(sender, JSON.stringify({
        text: `Bank configuration updated successfully.`,
        color: "green"
      }));

      log(`Bank config updated by ${sender}: ${args.setting} = ${args.value}`);
      return { messages, success: true };
    } catch (error) {
      log(`Error in bank configuration: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['bank', 'balance'])
  @Description('Check your bank balance and recent transactions')
  @Permission('player')
  async checkBalance({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[], balance?: number, transactions?: Transaction[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const balance = await this.getBalance(kv, sender);
      const transactions = await kv.get(['plugins', 'economy', 'transactions', sender]);
      const recentTransactions = (transactions.value || []).slice(0, 5);

      messages = await tellraw(sender, JSON.stringify([
        { text: "=== Bank Statement ===\n", color: "gold", bold: true },
        { text: "Current Balance: ", color: "yellow" },
        { text: `${balance} XPL\n`, color: "green", bold: true }
      ]));

      if (recentTransactions.length > 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "Recent Transactions:",
          color: "yellow"
        }));

        for (const tx of recentTransactions) {
          const sign = tx.type === 'withdraw' || tx.type === 'transfer' ? '-' : '+';
          messages = await tellraw(sender, JSON.stringify({
            text: `${new Date(tx.timestamp).toLocaleString()}: ${sign}${tx.amount} XPL (${tx.description})`,
            color: "gray"
          }));
        }
      }

      return { messages, balance, transactions: recentTransactions };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Online()
  @Command(['bank', 'deposit'])
  @Description('Deposit XP levels into your bank account')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'The amount of XP levels to deposit' }
  ])
  async deposit({ params, kv, tellraw, api, log }: ScriptContext): Promise<{ messages: any[], success?: boolean, newBalance?: number }> {
    const { sender, args } = params;
    const amount = args.amount;
    let messages = [];

    try {
      const config = await this.getConfig(kv);

      if (amount < config.minDepositAmount) {
        throw new Error(`Minimum deposit amount is ${config.minDepositAmount} XPL`);
      }

      const xpLevels = await api.xpQuery(sender, 'levels');
      if (xpLevels < amount) {
        throw new Error(`You don't have enough XP levels (${xpLevels}/${amount})`);
      }

      await api.xp('remove', sender, amount, 'levels');

      const currentBalance = await this.getBalance(kv, sender);
      const newBalance = currentBalance + amount;

      await kv.atomic()
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(newBalance)))
        .commit();

      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: 'deposit',
        amount,
        balance: newBalance,
        description: 'XP level deposit'
      });

      messages = await tellraw(sender, JSON.stringify({
        text: `Successfully deposited ${amount} XPL. New balance: ${newBalance} XPL`,
        color: "green"
      }));

      log(`${sender} deposited ${amount} XPL. New balance: ${newBalance}`);
      return { messages, success: true, newBalance };
    } catch (error) {
      log(`Error in deposit: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Online()
  @Command(['bank', 'withdraw'])
  @Description('Withdraw XP levels from your bank account')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'The amount of XP levels to withdraw' }
  ])
  async withdraw({ params, kv, tellraw, api, log }: ScriptContext): Promise<{ messages: any[], success?: boolean, newBalance?: number }> {
    const { sender, args } = params;
    const amount = args.amount;
    let messages = [];

    try {
      if (amount <= 0) {
        throw new Error('Withdrawal amount must be greater than 0');
      }

      const currentBalance = await this.getBalance(kv, sender);
      if (currentBalance < amount) {
        throw new Error(`Insufficient balance. You only have ${currentBalance} XPL`);
      }

      const newBalance = currentBalance - amount;

      const result = await kv.atomic()
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(newBalance)))
        .commit();

      if (!result.ok) {
        throw new Error('Withdrawal failed. Please try again');
      }

      await api.xp('add', sender, amount, 'levels');

      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: 'withdraw',
        amount,
        balance: newBalance,
        description: 'XP level withdrawal'
      });

      messages = await tellraw(sender, JSON.stringify({
        text: `Successfully withdrew ${amount} XPL. New balance: ${newBalance} XPL`,
        color: "green"
      }));

      log(`${sender} withdrew ${amount} XPL. New balance: ${newBalance}`);
      return { messages, success: true, newBalance };
    } catch (error) {
      log(`Error in withdrawal: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['bank', 'send'])
  @Description('Send XP levels to another player')
  @Permission('player')
  @Argument([
    { name: 'player', type: 'player', description: 'The player to send XPL to' },
    { name: 'amount', type: 'integer', description: 'The amount of XPL to send' }
  ])
  async send({ params, kv, tellraw, log }: ScriptContext): Promise<{
    messages: any[],
    success?: boolean,
    senderNewBalance?: number,
    receiverNewBalance?: number
  }> {
    const { sender, args } = params;
    const { player: receiver, amount } = args;
    let messages = [];

    try {
      if (sender === receiver) {
        throw new Error("You cannot send XPL to yourself");
      }

      const config = await this.getConfig(kv);
      const totalAmount = amount + config.transferFee;

      const senderBalance = await this.getBalance(kv, sender);
      if (senderBalance < totalAmount) {
        throw new Error(`Insufficient balance. Need ${totalAmount} XPL (including ${config.transferFee} XPL transfer fee)`);
      }

      const receiverBalance = await this.getBalance(kv, receiver);

      // Perform transfer atomically
      const result = await kv.atomic()
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(senderBalance - totalAmount)))
        .set(['plugins', 'economy', 'balances', receiver], new Deno.KvU64(BigInt(receiverBalance + amount)))
        .commit();

      if (!result.ok) {
        throw new Error("Transfer failed. Please try again");
      }

      // Record transactions
      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: 'transfer',
        amount: totalAmount,
        balance: senderBalance - totalAmount,
        description: `Transfer to ${receiver} (including ${config.transferFee} XPL fee)`
      });

      await this.addTransaction(kv, receiver, {
        timestamp: new Date().toISOString(),
        type: 'transfer',
        amount,
        balance: receiverBalance + amount,
        description: `Transfer from ${sender}`
      });

      // Notify both parties
      messages = await tellraw(sender, JSON.stringify({
        text: `Sent ${amount} XPL to ${receiver} (fee: ${config.transferFee} XPL). New balance: ${senderBalance - totalAmount} XPL`,
        color: "green"
      }));

      messages = await tellraw(receiver, JSON.stringify({
        text: `Received ${amount} XPL from ${sender}. New balance: ${receiverBalance + amount} XPL`,
        color: "green"
      }));

      log(`${sender} sent ${amount} XPL to ${receiver} (fee: ${config.transferFee})`);
      return {
        messages,
        success: true,
        senderNewBalance: senderBalance - totalAmount,
        receiverNewBalance: receiverBalance + amount
      };
    } catch (error) {
      log(`Error in transfer: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }
}
