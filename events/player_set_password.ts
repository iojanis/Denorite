import type { ScriptContext } from "../types.d.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

export default async function({ params, sendToPlayer, log, kv, auth }: ScriptContext) {
  const { data } = params;
  const { playerId, password } = data;

  log(`Attempting to set password for player ${playerId}`);

  try {
    // Retrieve player data
    const playerData = await kv.get(["players", playerId]);
    if (!playerData.value) {
      throw new Error("Player not found");
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password);

    // Update player data with hashed password and disable ticket login
    await kv.set(["players", playerId], {
      ...playerData.value,
      hashedPassword,
      useTicketLogin: false
    });

    log(`Password set successfully for player ${playerId}`);
    sendToPlayer(playerId, {
      type: "set_password_response",
      success: true,
      message: "Password set successfully. Ticket-based login has been disabled."
    });

    // Remove any existing ticket
    if (playerData.value.ticket) {
      await kv.set(["players", playerId], {
        ...playerData.value,
        ticket: null
      });
      log(`Removed existing ticket for player ${playerId}`);
    }

  } catch (error) {
    log(`Error setting password for player ${playerId}: ${error.message}`);
    sendToPlayer(playerId, {
      type: "set_password_response",
      success: false,
      message: "Failed to set password. Please try again."
    });
  }
}
