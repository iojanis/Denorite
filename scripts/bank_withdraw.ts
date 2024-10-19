// bank_withdraw.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender, args } = params;
  const amount = args.amount;

  try {
    const balanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
    const balance = balanceRecord.value ? Number(balanceRecord.value) : 0;

    if (balance < amount) {
      await api.tellraw(sender, JSON.stringify({
        text: "You don't have enough coins in your bank account.",
        color: "red"
      }));
      return;
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
      text: `Withdrawn ${amount} XPL. New balance: ${newBalance} coins.`,
      color: "green"
    }));
    log(`${sender} withdrew ${amount} XPL. New balance: ${newBalance}`);
  } catch (error) {
    log(`Error processing withdrawal for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while processing your withdrawal.",
      color: "red"
    }));
  }
}
