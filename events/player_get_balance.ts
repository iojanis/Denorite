import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, sendToPlayer, log, auth }: ScriptContext) {
  const { playerId } = params;

  // Verify player authentication
  const isAuthenticated = await auth.checkPermission('player');
  if (!isAuthenticated) {
    sendToPlayer(playerId, { type: 'error', message: 'Not authenticated' });
    return;
  }

  try {
    const balanceRecord = await kv.get(["plugins", "bank", "balances", playerId]);
    const balance = balanceRecord.value ? Number(balanceRecord.value) : 0;
    sendToPlayer(playerId, { type: 'balance', amount: balance });
    log(`Balance checked for player ${playerId} via web app: ${balance}`);
  } catch (error) {
    log(`Error checking balance for player ${playerId} via web app: ${error.message}`);
    sendToPlayer(playerId, { type: 'error', message: 'Failed to fetch balance' });
  }
}
