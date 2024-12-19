import { Module, Socket, Permission, Event } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

interface ItemTag {
  Damage?: number;
  effects?: Array<{
    id: string;
    duration: number;
  }>;
  [key: string]: any;
}

export interface StoredItem {
  count: number;
  price: number;
  tag?: ItemTag;
}

interface InventoryItem {
  id: string;
  count: number;
  slot: number;
  tag?: ItemTag;
}

@Module({
  name: 'Storage',
  version: '1.0.3'
})
export class Storage {
  private readonly FORBIDDEN_ITEMS = [
    'enchanted_book',
    'lingering_potion',
    'potion',
    'splash_potion',
    'tipped_arrow',
    'painting',
    'filled_map',
    'firework_rocket',
    'firework_star',
    'written_book',
    'player_head',
    'banner_pattern',
    'suspicious_stew'
  ];

  private getItemStoreKey(username: string, itemId: string): string[] {
    return ['player', username, 'store', itemId];
  }

  @Socket('get_inventory')
  @Permission('player')
  async handleGetInventory({ params, api, log }: ScriptContext): Promise<{ success: boolean; data: { items: InventoryItem[] } }> {
    try {
      const response = await api.executeCommand(`data get entity ${params.sender} Inventory`);
      const items = this.parseInventory(response);

      log(`Retrieved inventory for player ${params.sender}`);
      return {
        success: true,
        data: {
          items: items.filter(item => !this.FORBIDDEN_ITEMS.includes(item.id))
        }
      };
    } catch (error) {
      log(`Error getting inventory: ${error.message}`);
      throw error;
    }
  }

  @Socket('get_store')
  @Permission('player')
  async handleGetStore({ params, kv }: ScriptContext): Promise<{ success: boolean; data: { items: Array<StoredItem & { id: string }> } }> {
    try {
      const allItems = await kv.list(['player', params.sender, 'store']);
      const items: Array<StoredItem & { id: string }> = [];

      for (const key of allItems.keys) {
        const itemId = key[key.length - 1];
        const itemData = await kv.get<StoredItem>(key);
        if (itemData.value) {
          items.push({
            ...itemData.value,
            id: itemId
          });
        }
      }

      return {
        success: true,
        data: { items }
      };
    } catch (error) {
      throw error;
    }
  }

  @Socket('upload_item')
  @Permission('player')
  async handleUploadItem({ params, api, kv, log }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_id, count } = params;

      if (this.FORBIDDEN_ITEMS.includes(item_id)) {
        throw new Error('This item cannot be stored');
      }

      // Verify item removal using clear command
      const clearResult = await api.clear(params.sender, item_id, count);
      const clearedMatch = clearResult.match(/(\w+): -(\d+)/);
      if (!clearedMatch || parseInt(clearedMatch[2]) !== count) {
        throw new Error('Failed to remove items from inventory');
      }

      // Get current stored item data
      const itemKey = this.getItemStoreKey(params.sender, item_id);
      const storedItem = await kv.get<StoredItem>(itemKey);

      // Update or create item entry
      const updatedItem: StoredItem = {
        count: (storedItem.value?.count || 0) + count,
        price: storedItem.value?.price || 0,
        tag: storedItem.value?.tag
      };

      await kv.set(itemKey, updatedItem);

      await api.tellraw(params.sender, JSON.stringify({
        text: `Successfully stored ${count} ${item_id}`,
        color: "green"
      }));

      log(`Player ${params.sender} uploaded ${count} ${item_id}`);
      return { success: true };
    } catch (error) {
      log(`Error uploading item: ${error.message}`);
      throw error;
    }
  }

  @Socket('change_item')
  @Permission('player')
  async handleChangeItem({ params, kv, api, log }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_name, price } = params;

      if (price < 0) {
        throw new Error('Price cannot be negative');
      }

      const itemKey = this.getItemStoreKey(params.sender, item_name);
      const storedItem = await kv.get<StoredItem>(itemKey);

      if (!storedItem.value) {
        throw new Error('Item not found in your storage');
      }

      await kv.set(itemKey, {
        ...storedItem.value,
        price
      });

      await api.tellraw(params.sender, JSON.stringify({
        text: price > 0
          ? `Listed ${item_name} for ${price} coins`
          : `Unlisted ${item_name} from market`,
        color: "green"
      }));

      log(`Player ${params.sender} changed price of ${item_name} to ${price}`);
      return { success: true };
    } catch (error) {
      log(`Error changing item price: ${error.message}`);
      throw error;
    }
  }

  @Socket('download_item')
  @Permission('player')
  async handleDownloadItem({ params, api, kv, log }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_id, count } = params;

      const itemKey = this.getItemStoreKey(params.sender, item_id);
      const storedItem = await kv.get<StoredItem>(itemKey);

      if (!storedItem.value || storedItem.value.count < count) {
        throw new Error('Not enough items in storage');
      }

      // Check inventory space
      const response = await api.executeCommand(`data get entity ${params.sender} Inventory`);
      const inventory = this.parseInventory(response);
      const availableSlots = this.calculateAvailableSpace(inventory, item_id);

      if (availableSlots < count) {
        throw new Error('Not enough inventory space');
      }

      // Give item to player
      await api.executeCommand(`give ${params.sender} ${item_id} ${count}`);

      // Update store
      const newCount = storedItem.value.count - count;
      if (newCount === 0) {
        await kv.delete(itemKey);
      } else {
        await kv.set(itemKey, {
          ...storedItem.value,
          count: newCount
        });
      }

      await api.tellraw(params.sender, JSON.stringify({
        text: `Retrieved ${count} ${item_id} from storage`,
        color: "green"
      }));

      log(`Player ${params.sender} downloaded ${count} ${item_id}`);
      return { success: true };
    } catch (error) {
      log(`Error downloading item: ${error.message}`);
      throw error;
    }
  }

  private parseInventory(response: unknown): InventoryItem[] {
    if (!response || typeof response !== 'string') return [];

    try {
      const items = [];
      const regex = /{(?:count: (\d+), )?(?:Slot: (\d+)b, )?id: "minecraft:([^"]+)"(?:, tag: ({[^}]+))?}/g;
      let match;

      while ((match = regex.exec(response)) !== null) {
        items.push({
          count: parseInt(match[1] || '1'),
          slot: parseInt(match[2] || '0'),
          id: match[3],
          tag: match[4] ? JSON.parse(match[4]) : undefined
        });
      }

      return items;

    } catch (error) {
      console.error('Failed to parse inventory:', error);
      return [];
    }
  }

  private calculateAvailableSpace(inventory: InventoryItem[], itemId: string): number {
    const maxStackSize = this.getMaxStackSize(itemId);
    let availableSpace = 0;

    // Check existing stacks
    const existingStacks = inventory.filter(item => item.id === itemId);
    for (const stack of existingStacks) {
      availableSpace += maxStackSize - stack.count;
    }

    // Check empty slots (slots 0-35 are main inventory and hotbar)
    const usedSlots = new Set(inventory.map(item => item.slot));
    const emptySlots = 36 - usedSlots.size;
    availableSpace += emptySlots * maxStackSize;

    return availableSpace;
  }

  private getMaxStackSize(itemId: string): number {
    const stackSizes: Record<string, number> = {
      'ender_pearl': 16,
      'snowball': 16,
      'egg': 16,
      'bucket': 16,
      'sign': 16,
      'bed': 1,
      'saddle': 1,
      'elytra': 1,
      'shield': 1,
      'totem_of_undying': 1
    };

    return stackSizes[itemId] || 64;
  }
}
