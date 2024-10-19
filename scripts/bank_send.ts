// bank_send.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender, args } = params;
  const receiver = args.player;
  const amount = args.amount;

  try {
    // Validate amount
    if (amount <= 0) {
      await api.tellraw(sender, JSON.stringify({
        text: "The amount must be a positive number.",
        color: "red"
      }));
      return;
    }

    // Check if sender is trying to send money to themselves
    // if (sender === receiver) {
    //   await api.tellraw(sender, JSON.stringify({
    //     text: "You cannot send money to yourself.",
    //     color: "red"
    //   }));
    //   return;
    // }

    const senderBalanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
    const senderBalance = senderBalanceRecord.value ? Number(senderBalanceRecord.value) : 0;

    if (senderBalance < amount) {
      await api.tellraw(sender, JSON.stringify({
        text: `You don't have enough XPL in your bank account. Your balance is ${senderBalance} XPL.`,
        color: "red"
      }));
      return;
    }

    // First transaction: Debit sender's account
    const senderResult = await kv.atomic()
      .check(senderBalanceRecord)
      .set(["plugins", "bank", "balances", sender], new Deno.KvU64(BigInt(Math.max(0, senderBalance - amount))))
      .commit();

    if (!senderResult.ok) {
      throw new Error("Failed to debit sender's account");
    }

    // Second transaction: Credit receiver's account
    const receiverBalanceRecord = await kv.get(["plugins", "bank", "balances", receiver]);
    const receiverBalance = receiverBalanceRecord.value ? Number(receiverBalanceRecord.value) : 0;

    const receiverResult = await kv.atomic()
      .check(receiverBalanceRecord)
      .set(["plugins", "bank", "balances", receiver], new Deno.KvU64(BigInt(receiverBalance + amount)))
      .commit();

    if (!receiverResult.ok) {
      // If crediting receiver's account fails, we should revert the sender's transaction
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
  } catch (error) {
    log(`Error processing transaction from ${sender} to ${receiver}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while processing the transaction. Your balance remains unchanged.",
      color: "red"
    }));
  }
}
