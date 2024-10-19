import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender } = params;

  try {
    const balanceRecord = await kv.get(["plugins", "bank", "balances", sender]);
    const balance = balanceRecord.value ? Number(balanceRecord.value) : 0;
    await api.tellraw(sender, JSON.stringify({
      text: `Your bank balance is ${balance} XPL.`,
      color: "green"
    }));
    log(`Balance checked for player ${sender}: ${balance}`);
  } catch (error) {
    log(`Error checking balance for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while checking your balance.",
      color: "red"
    }));
  }
}
