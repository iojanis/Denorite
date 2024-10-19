import type { ScriptContext } from "../types.d.ts";

export default async function({ params, sendToMinecraft, log, kv, api }: ScriptContext) {
  const { data } = params;
  const { playerId, playerName, x, y, z, dimension } = data;

  const {
    tellraw, title
  } = api!;

  log(`Player ${playerName} (ID: ${playerId}) left the server`);

  // Retrieve session data
  const sessionData = await kv.get(["sessions", playerId]);
  if (!sessionData.value) {
    log(`No active session found for player ${playerName} (ID: ${playerId})`);
    return;
  }

  // Calculate session duration
  const startTime = new Date(sessionData.value.startTime);
  const endTime = new Date();
  const sessionDuration = (endTime.getTime() - startTime.getTime()) / 1000; // in seconds

  // Update player data
  const playerData = await kv.get(["players", playerId]);
  if (playerData.value) {
    await kv.set(["players", playerId], {
      ...playerData.value,
      lastLeft: endTime.toISOString(),
      totalPlayTime: (playerData.value.totalPlayTime || 0) + sessionDuration
    });
  }

  // End session
  await kv.delete(["sessions", playerId]);

  // Log session summary
  log(`Session ended for player ${playerName} (ID: ${playerId})`);
  log(`Session duration: ${sessionDuration.toFixed(2)} seconds`);
  log(`Start position: ${sessionData.value.x}, ${sessionData.value.y}, ${sessionData.value.z} in ${sessionData.value.dimension}`);
  log(`End position: ${x}, ${y}, ${z} in ${dimension}`);

  // Notify other players
  await sendToMinecraft({
    type: "command",
    data: `tellraw @a {"text":"${playerName} has left the server. They played for ${sessionDuration.toFixed(2)} seconds.","color":"yellow"}`
  });
}
