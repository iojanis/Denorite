import type { ScriptContext } from "../types.d.ts";
import { sleep } from "https://deno.land/x/sleep/mod.ts";
import { generateShortTicket } from "../utils.ts";

export default async function({ params, sendToMinecraft, log, kv }: ScriptContext) {
  const { data } = params;
  const { playerId, playerName, x, y, z, dimension } = data;

  log(`Player ${playerName} (ID: ${playerId}) joined the server`);

  // Check if the player has joined before
  const existingPlayer = await kv.get(["players", playerId]);
  const isNewPlayer = !existingPlayer.value;

  let playerData = existingPlayer.value || {};
  const useTicketLogin = !playerData.hashedPassword;

  // Generate a short, uppercase ticket if using ticket-based login
  const ticket = useTicketLogin ? generateShortTicket() : null;

  // Update or create player entry
  playerData = {
    ...playerData,
    name: playerName,
    lastJoined: new Date().toISOString(),
    joinCount: isNewPlayer ? 1 : (playerData.joinCount || 0) + 1,
  };

  if (useTicketLogin) {
    playerData.ticket = ticket;
  }

  await kv.set(["players", playerId], playerData);

  // Start session
  await kv.set(["sessions", playerId], {
    startTime: new Date().toISOString(),
    dimension,
    x, y, z
  });

  // Welcome message
  const welcomeMessage = isNewPlayer
    ? `Welcome ${playerName} to the server for the first time!`
    : `Welcome back, ${playerName}! This is your visit #${playerData.joinCount}.`;

  await sleep(0.1);

  await sendToMinecraft({
    type: "command",
    data: `tellraw ${playerName} {"text":"EnchantedOS 2023.1","color":"blue"}`
  });

  await sendToMinecraft({
    type: "command",
    data: `tellraw ${playerName} {"text":"Kernel: Denorite 1.0.0","color":"dark_purple"}`
  });

  // Send login information to the player
  if (useTicketLogin) {
    await sendToMinecraft({
      type: "command",
      data: `tellraw ${playerName} {"text":"Your login ticket: ","color":"green","extra":[{"text":"[HOVER TO REVEAL]","color":"yellow","obfuscated":true,"hoverEvent":{"action":"show_text","contents":[{"text":"${ticket}","color":"aqua"}]}}]}`
    });
  } else {
    await sendToMinecraft({
      type: "command",
      data: `tellraw ${playerName} {"text":"Please log in using your password.","color":"green"}`
    });
  }

  // Give a welcome gift to new players
  if (isNewPlayer) {
    await sleep(1);
    await sendToMinecraft({
      type: "command",
      data: `give ${playerName} minecraft:cookie 1`
    });
    await sendToMinecraft({
      type: "command",
      data: `execute at ${playerName} run playsound minecraft:entity.player.levelup player @a ~ ~ ~ 1 1`
    });
  }

  log(`Session started for player ${playerName} (ID: ${playerId})`);
}
