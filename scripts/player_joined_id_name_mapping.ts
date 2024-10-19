import type { ScriptContext } from "../types.d.ts";

export default async function({ params, log, kv }: ScriptContext) {
  const { data } = params;
  const { playerId, playerName } = data;

  log(`Mapping playerId to playerName for ${playerName} (ID: ${playerId})`);

  try {
    // Store the mapping in both directions
    await kv.set(["playerIdToName", playerId], playerName);
    await kv.set(["playerNameToId", playerName], playerId);

    // Get all current mappings for logging purposes
    const playerIdToNameEntries = kv.list({ prefix: ["playerIdToName"] });
    const playerNameToIdEntries = kv.list({ prefix: ["playerNameToId"] });

    const idToNameMap = new Map();
    const nameToIdMap = new Map();

    for await (const entry of playerIdToNameEntries) {
      idToNameMap.set(entry.key[1], entry.value);
    }

    for await (const entry of playerNameToIdEntries) {
      nameToIdMap.set(entry.key[1], entry.value);
    }

    log("Current player ID to Name mappings:");
    log(JSON.stringify(Object.fromEntries(idToNameMap), null, 2));

    log("Current player Name to ID mappings:");
    log(JSON.stringify(Object.fromEntries(nameToIdMap), null, 2));

  } catch (error) {
    log(`Error mapping playerId to playerName for ${playerName}: ${error.message}`);
  }
}
