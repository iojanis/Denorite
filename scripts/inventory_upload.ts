import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { item, amount } = args;

  try {
    // Transform item name to correct Minecraft item ID format
    const minecraftItem = transformItemName(item);

    // Remove the item from the player's inventory and get the amount cleared
    const clearResult = await api.clear(sender, minecraftItem, amount);
    const clearedNumber = extractClearedAmount(clearResult);

    if (clearedNumber === 0) {
      await api.tellraw(sender, JSON.stringify({
        text: `You don't have any ${item} in your inventory.`,
        color: "red"
      }));
      return;
    }

    // Add the cleared amount to the virtual inventory
    await kv.atomic()
      .mutate({ type: "sum", key: ["inventory", sender, minecraftItem], value: new Deno.KvU64(BigInt(clearedNumber)) })
      .commit();

    await api.tellraw(sender, JSON.stringify({
      text: `Successfully uploaded ${clearedNumber} ${item} to your virtual inventory.`,
      color: "green"
    }));
    log(`Player ${sender} uploaded ${clearedNumber} ${minecraftItem} to their virtual inventory.`);
  } catch (error) {
    log(`Error uploading item for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while uploading the item.",
      color: "red"
    }));
  }
}

function transformItemName(item: string): string {
  // Remove any 'minecraft:' prefix if it exists
  const cleanedItem = item.replace(/^minecraft:/, '');

  // Remove any 'block.minecraft.' or 'item.minecraft.' prefix if it exists
  const strippedItem = cleanedItem.replace(/^(block|item)\.minecraft\./, '');

  // Add 'minecraft:' prefix
  return `minecraft:${strippedItem}`;
}

function extractClearedAmount(clearResult: string): number {
  const match = clearResult.match(/Removed (\d+) item/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 0;
}
