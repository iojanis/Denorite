// team_create.ts
import type { ScriptContext } from "../types.d.ts";
import { slugify } from "../utils.ts";

export default async function({ params, kv, sendToMinecraft, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { name } = args;

  try {
    const teamId = slugify(name);
    const existingTeam = await kv.get(["teams", teamId]);

    if (existingTeam.value) {
      await api.tellraw(sender, JSON.stringify({
        text: `A team with the name "${name}" already exists.`,
        color: "red"
      }));
      return;
    }

    const playerTeam = await kv.get(["playerTeams", sender]);
    if (playerTeam.value) {
      await api.tellraw(sender, JSON.stringify({
        text: "You are already in a team. Leave your current team first.",
        color: "red"
      }));
      return;
    }

    // Create the team in Minecraft
    try {
      await api.team('add', teamId, JSON.stringify(name));
    } catch (error) {
      log(`Error creating Minecraft team for player ${sender}: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while creating the team in Minecraft.",
        color: "red"
      }));
      return;
    }

    // Add the player to the team in Minecraft
    try {
      await api.team('join', teamId, sender);
    } catch (error) {
      log(`Error adding player ${sender} to Minecraft team: ${error.message}`);
      // Attempt to remove the team if we failed to add the player
      await api.team('remove', teamId);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while adding you to the team in Minecraft.",
        color: "red"
      }));
      return;
    }

    const newTeam = {
      id: teamId,
      name: name,
      leader: sender,
      members: [sender],
      color: "white"
    };

    await kv.atomic()
      .set(["teams", teamId], newTeam)
      .set(["playerTeams", sender], teamId)
      .commit();

    await api.tellraw(sender, JSON.stringify({
      text: `Team "${name}" has been created successfully.`,
      color: "green"
    }));
    log(`Player ${sender} created team "${name}"`);
  } catch (error) {
    log(`Error creating team for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while creating the team.",
      color: "red"
    }));
  }
}
