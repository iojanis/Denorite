// inventory_download.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender, args } = params;
  const { item, amount } = args;
  const itemName = transformItemName(item)

  try {
    // Check if the player has enough of the item in their virtual inventory
    const inventoryRecord = await kv.get(["inventory", sender, itemName]);
    const inventoryAmount = inventoryRecord.value ? Number(inventoryRecord.value) : 0;

    if (inventoryAmount < amount) {
      await api.tellraw(sender, JSON.stringify({
        text: `You don't have ${amount} ${itemName} in your virtual inventory.`,
        color: "red"
      }));
      return;
    }

    // Remove the item from the virtual inventory
    const newAmount = Math.max(0, inventoryAmount - amount);
    const result = await kv.atomic()
      .check(inventoryRecord)
      .mutate({
        type: "set",
        key: ["inventory", sender, itemName],
        value: new Deno.KvU64(BigInt(newAmount))
      })
      .commit();

    if (!result.ok) {
      throw new Error("Transaction failed");
    }

    // Add the item to the player's inventory
    await api.give(sender, itemName, amount);

    await api.tellraw(sender, JSON.stringify({
      text: `Successfully downloaded ${amount} ${itemName} from your virtual inventory.`,
      color: "green"
    }));
    log(`Player ${sender} downloaded ${amount} ${itemName} from their virtual inventory.`);
  } catch (error) {
    log(`Error downloading item for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while downloading the item.",
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
