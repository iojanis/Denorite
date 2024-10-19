import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender, args } = params;
  const amount = args.amount;

  try {
    // Check player's XP levels
    const xpLevels = await api.xpQuery(sender, 'levels');
    if (xpLevels < amount) {
      await api.tellraw(sender, JSON.stringify({
        text: "You don't have enough XP levels to deposit.",
        color: "red"
      }));
      return;
    }

    // Perform the deposit
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
  } catch (error) {
    log(`Error processing deposit for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while processing your deposit.",
      color: "red"
    }));
  }
}
