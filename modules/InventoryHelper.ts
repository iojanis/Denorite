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

interface StoredItem {
  id: string;
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
  version: '1.0.2'
})
export class Storage {
  private readonly USER_STORE_PREFIX = 'store:user:';
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

  private getUserStoreKey(username: string): string[] {
    return [this.USER_STORE_PREFIX + username];
  }

  @Socket('get_inventory')
  @Permission('player')
  async handleGetInventory({ params, api, log }: ScriptContext): Promise<{ success: boolean; data: { items: InventoryItem[] } }> {
    try {
      const response = await api.executeCommand(`data get entity ${params.sender} Inventory`);
      console.log("Raw response:", response);
      const items = this.parseInventory(response);
      console.log("Parsed items:", items);

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
  async handleGetStore({ params, kv }: ScriptContext): Promise<{ success: boolean; data: { items: StoredItem[] } }> {
    try {
      const userStore = await kv.get<{ items: StoredItem[] }>(this.getUserStoreKey(params.sender));
      return {
        success: true,
        data: {
          items: userStore.value?.items || []
        }
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

      // Check if player has the item
      const response = await api.executeCommand(`data get entity ${params.sender} Inventory`);
      const inventory = this.parseInventory(response);
      const itemToTransfer = inventory.find(item => item.id === item_id);

      if (!itemToTransfer || itemToTransfer.count < count) {
        throw new Error('You do not have enough items');
      }

      // Remove items from player's inventory
      await api.executeCommand(`clear ${params.sender} ${item_id} ${count}`);

      // Update user's store
      const userStoreKey = this.getUserStoreKey(params.sender);
      const userStore = await kv.get<{ items: StoredItem[] }>(userStoreKey);
      const items = userStore.value?.items || [];

      const existingItem = items.find(item => item.id === item_id);
      if (existingItem) {
        existingItem.count += count;
      } else {
        items.push({
          id: item_id,
          count,
          price: 0,
          tag: itemToTransfer.tag
        });
      }

      await kv.set(userStoreKey, { items });

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

      const userStoreKey = this.getUserStoreKey(params.sender);
      const userStore = await kv.get<{ items: StoredItem[] }>(userStoreKey);
      const items = userStore.value?.items || [];

      const item = items.find(item => item.id === item_name);
      if (!item) {
        throw new Error('Item not found in your storage');
      }

      item.price = price;
      await kv.set(userStoreKey, { items });

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

      // Check user's store for item
      const userStoreKey = this.getUserStoreKey(params.sender);
      const userStore = await kv.get<{ items: StoredItem[] }>(userStoreKey);
      const items = userStore.value?.items || [];

      const storedItem = items.find(item => item.id === item_id);
      if (!storedItem || storedItem.count < count) {
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
      storedItem.count -= count;
      if (storedItem.count === 0) {
        items.splice(items.indexOf(storedItem), 1);
      }

      await kv.set(userStoreKey, { items });

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

  @Socket('get_market')
  @Permission('player')
  async handleGetMarket({ kv }: ScriptContext): Promise<{ success: boolean; data: { listings: Array<StoredItem & { seller: string }> } }> {
    try {
      // List all keys with our prefix
      const keys = await kv.list(this.USER_STORE_PREFIX);

      // Fetch all user stores in parallel
      const stores = await Promise.all(
        keys.map(async key => {
          const username = key[0].slice(this.USER_STORE_PREFIX.length);
          const store = await kv.get<{ items: StoredItem[] }>(key);
          return { username, items: store.value?.items || [] };
        })
      );

      // Collect all items with prices > 0
      const listings = stores.flatMap(store =>
        store.items
          .filter(item => item.price > 0)
          .map(item => ({
            ...item,
            seller: store.username
          }))
      );

      return {
        success: true,
        data: { listings }
      };
    } catch (error) {
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
