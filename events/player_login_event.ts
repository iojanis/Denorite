import type { ScriptContext } from "../types.d.ts";

export default async function({ params, sendToPlayer, sendToMinecraft, log, kv, auth }: ScriptContext) {
  const { data } = params;
  const { playerId, ticket } = data;

  log(`Received login request from player ${playerId}`);

  // Retrieve player data
  const playerData = await kv.get(["players", playerId]);

  if (!playerData.value || playerData.value.ticket !== ticket) {
    log(`Invalid ticket for player ${playerId}`);
    sendToPlayer(playerId, { type: "login_response", success: false, message: "Invalid ticket" });

    // Notify player in-game about the failed attempt
    await sendToMinecraft({
      type: "command",
      data: `tellraw ${playerData.value.name} {"text":"Login attempt failed. Invalid ticket used.","color":"red"}`
    });
    return;
  }

  // Generate JWT
  const token = await auth.createToken({ playerId, playerName: playerData.value.name });

  // Remove the used ticket
  await kv.set(["players", playerId], {
    ...playerData.value,
    ticket: null
  });

  log(`Successfully authenticated player ${playerId}`);
  sendToPlayer(playerId, { type: "login_response", success: true, token });

  // Notify player in-game about successful login
  await sendToMinecraft({
    type: "command",
    data: `tellraw ${playerData.value.name} {"text":"Login successful! Your ticket has been used and is now invalid.","color":"green"}`
  });
}
