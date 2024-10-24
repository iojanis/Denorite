import { Module, Command, Description, Permission, Socket, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

@Module({
  name: 'Economy',
  version: '1.0.0'
})
export class Economy {

  @Command(['bank', 'balance'])
  @Description('Check your bank balance')
  @Permission('player')
  @Socket()
  async checkBalance({ params, kv, api, log }: ScriptContext) {
    const { sender } = params;
    try {
      const balanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
      const balance = balanceRecord.value ? Number(balanceRecord.value) : 0;
      await api.tellraw(sender, JSON.stringify({
        text: `Your bank balance is ${balance} XPL.`,
        color: "green"
      }));
      log(`Balance checked for player ${sender}: ${balance}`);
      return { success: true, balance };
    } catch (error) {
      log(`Error checking balance for player ${sender}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while checking your balance.",
        color: "red"
      }));
      return { success: false, error: error.message };
    }
  }

  @Command(['bank', 'deposit'])
  @Description('Deposit XP levels into your bank account')
  @Permission('player')
  @Socket()
  @Argument([
    { name: 'amount', type: 'integer', description: 'The amount of XP levels to deposit' }
  ])
  async deposit({ params, kv, api, log }: ScriptContext) {
    const { sender, args } = params;
    const amount = args.amount;
    try {
      const xpLevels = await api.xpQuery(sender, 'levels');
      if (xpLevels < amount) {
        await api.tellraw(sender, JSON.stringify({
          text: "You don't have enough XP levels to deposit.",
          color: "red"
        }));
        return { success: false, error: "Insufficient XP levels" };
      }

      await api.xp('remove', sender, amount, 'levels');

      const result = await kv.atomic()
        .mutate({ type: "sum", key: ["plugins", "bank", "balances", sender], value: new Deno.KvU64(BigInt(amount)) })
        .commit();

      if (!result.ok) {
        throw new Error("Transaction failed");
      }

      const newBalanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
      const newBalance = newBalanceRecord.value ? Number(newBalanceRecord.value) : 0;

      await api.tellraw(sender, JSON.stringify({
        text: `Deposited ${amount} XPL. New balance: ${newBalance} XPL.`,
        color: "green"
      }));
      log(`${sender} deposited ${amount} XPL. New balance: ${newBalance}`);
      return { success: true, newBalance };
    } catch (error) {
      log(`Error processing deposit for player ${sender}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while processing your deposit.",
        color: "red"
      }));
      return { success: false, error: error.message };
    }
  }

  @Command(['bank', 'withdraw'])
  @Description('Withdraw XP levels from your bank account')
  @Permission('player')
  @Socket()
  @Argument([
    { name: 'amount', type: 'integer', description: 'The amount of XP levels to withdraw' }
  ])
  async withdraw({ params, kv, api, log }: ScriptContext) {
    const { sender, args } = params;
    const amount = args.amount;
    try {
      const balanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
      const balance = balanceRecord.value ? Number(balanceRecord.value) : 0;

      if (balance < amount) {
        await api.tellraw(sender, JSON.stringify({
          text: "You don't have enough XPL in your bank account.",
          color: "red"
        }));
        return { success: false, error: "Insufficient balance" };
      }

      const result = await kv.atomic()
        .check(balanceRecord)
        .mutate({
          type: "set",
          key: ["plugins", "bank", "balances", sender],
          value: new Deno.KvU64(BigInt(Math.max(0, balance - amount)))
        })
        .commit();

      if (!result.ok) {
        throw new Error("Transaction failed");
      }

      await api.xp('add', sender, amount, 'levels');

      const newBalanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
      const newBalance = newBalanceRecord.value ? Number(newBalanceRecord.value) : 0;

      await api.tellraw(sender, JSON.stringify({
        text: `Withdrawn ${amount} XPL. New balance: ${newBalance} XPL.`,
        color: "green"
      }));
      log(`${sender} withdrew ${amount} XPL. New balance: ${newBalance}`);
      return { success: true, newBalance };
    } catch (error) {
      log(`Error processing withdrawal for player ${sender}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while processing your withdrawal.",
        color: "red"
      }));
      return { success: false, error: error.message };
    }
  }

  @Command(['bank', 'send'])
  @Description('Send XP levels to another player')
  @Permission('player')
  @Socket()
  @Argument([
    { name: 'player', type: 'player', description: 'The player to send XPL to' },
    { name: 'amount', type: 'integer', description: 'The amount of XPL to send' }
  ])
  async send({ params, kv, api, log }: ScriptContext) {
    const { sender, args } = params;
    const receiver = args.player;
    const amount = args.amount;
    try {
      if (amount <= 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "The amount must be a positive number.",
          color: "red"
        }));
        return { success: false, error: "Invalid amount" };
      }

      const senderBalanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
      const senderBalance = senderBalanceRecord.value ? Number(senderBalanceRecord.value) : 0;

      if (senderBalance < amount) {
        await api.tellraw(sender, JSON.stringify({
          text: `You don't have enough XPL in your bank account. Your balance is ${senderBalance} XPL.`,
          color: "red"
        }));
        return { success: false, error: "Insufficient balance" };
      }

      const senderResult = await kv.atomic()
        .check(senderBalanceRecord)
        .set(["plugins", "bank", "balances", sender], new Deno.KvU64(BigInt(Math.max(0, senderBalance - amount))))
        .commit();

      if (!senderResult.ok) {
        throw new Error("Failed to debit sender's account");
      }

      const receiverBalanceRecord = await kv.get(["plugins", "bank", "balances", receiver]);
      const receiverBalance = receiverBalanceRecord.value ? Number(receiverBalanceRecord.value) : 0;

      const receiverResult = await kv.atomic()
        .check(receiverBalanceRecord)
        .set(["plugins", "bank", "balances", receiver], new Deno.KvU64(BigInt(receiverBalance + amount)))
        .commit();

      if (!receiverResult.ok) {
        await kv.atomic()
          .set(["plugins", "bank", "balances", sender], new Deno.KvU64(BigInt(senderBalance)))
          .commit();
        throw new Error("Failed to credit receiver's account");
      }

      await api.tellraw(sender, JSON.stringify({
        text: `You sent ${amount} XPL to ${receiver}. Your new balance is ${senderBalance - amount} XPL.`,
        color: "green"
      }));
      await api.tellraw(receiver, JSON.stringify({
        text: `You received ${amount} XPL from ${sender}. Your new balance is ${receiverBalance + amount} XPL.`,
        color: "green"
      }));
      log(`${sender} sent ${amount} XPL to ${receiver}`);
      return { success: true, senderNewBalance: senderBalance - amount, receiverNewBalance: receiverBalance + amount };
    } catch (error) {
      log(`Error processing transaction from ${sender} to ${receiver}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while processing the transaction. Your balance remains unchanged.",
        color: "red"
      }));
      return { success: false, error: error.message };
    }
  }
}
