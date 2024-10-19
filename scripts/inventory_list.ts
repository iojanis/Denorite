// inventory_list.ts
import type { ScriptContext } from "../types.d.ts";

export default async function({ params, kv, api, log }: ScriptContext) {
  const { sender } = params;

  try {
    const inventoryItems = await kv.list({ prefix: ["inventory", sender] });
    const itemList = [];

    for await (const item of inventoryItems) {
      const [, , itemId] = item.key;
      const amount = Number(item.value);
      itemList.push(`${itemId}: ${amount}`);
    }

    if (itemList.length === 0) {
      await api.tellraw(sender, JSON.stringify({
        text: "Your virtual inventory is empty.",
        color: "yellow"
      }));
    } else {
      await api.tellraw(sender, JSON.stringify({
        text: "Your virtual inventory:",
        color: "green"
      }));
      for (const item of itemList) {
        await api.tellraw(sender, JSON.stringify({
          text: item,
          color: "white"
        }));
      }
    }

    log(`Player ${sender} listed their virtual inventory.`);
  } catch (error) {
    log(`Error listing inventory for player ${sender}: ${error.message}`);
    await api.tellraw(sender, JSON.stringify({
      text: "An error occurred while listing your inventory.",
      color: "red"
    }));
  }
}
