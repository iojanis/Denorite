import { generateShortTicket } from "../utils.ts";
import type { ScriptContext } from "./types.d.ts";
import { encodeBase64 } from "jsr:@std/encoding";

export default async function({ params, sendToPlayer, sendToMinecraft, log, kv, auth }: ScriptContext) {
  const { data } = params;
  const { playerId } = data;

  log(`Attempting to reset password for player ${playerId}`);

  try {
    // Retrieve player data
    const playerData = await kv.get(["players", playerId]);
    if (!playerData.value) {
      throw new Error("Player not found");
    }

    // Generate a new ticket
    const newTicket = generateShortTicket();

    // Update player data to enable ticket login and store new ticket
    await kv.set(["players", playerId], {
      ...playerData.value,
      hashedPassword: null,
      useTicketLogin: true,
      ticket: newTicket
    });

    log(`Password reset successfully for player ${playerId}`);
    sendToPlayer(playerId, {
      type: "reset_password_response",
      success: true,
      message: "Password has been reset. Ticket-based login has been re-enabled."
    });

    // Send the new ticket to the player in-game
    const obfuscatedTicket = encodeBase64(new TextEncoder().encode(newTicket));
    await sendToMinecraft({
      type: "command",
      data: `tellraw ${playerData.value.name} {"text":"Your new login ticket: ","color":"green","extra":[{"text":"[HOVER TO REVEAL]","color":"yellow","obfuscated":true,"hoverEvent":{"action":"show_text","contents":[{"text":"${obfuscatedTicket}","color":"aqua"}]}}]}`
    });

  } catch (error) {
    log(`Error resetting password for player ${playerId}: ${error.message}`);
    sendToPlayer(playerId, {
      type: "reset_password_response",
      success: false,
      message: "Failed to reset password. Please try again."
    });
  }
}
