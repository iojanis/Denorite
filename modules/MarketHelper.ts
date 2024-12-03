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

interface StoreItem {
  id: string;
  values: Array<{
    username: string;
    count: number;
    price: number;
    tag?: ItemTag;
  }>;
}

@Module({
  name: 'Market',
  version: '1.0.1'
})
export class Market {
  private readonly STORE_KEY = ['store', 'items'];

  @Socket('set_price')
  @Permission('player')
  async handleSetPrice({ params, kv, api, log }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_id, price, min = 0.1 } = params;

      if (price < 0) {
        throw new Error('Price cannot be negative');
      }

      if (price > 0 && price < min) {
        throw new Error(`Minimum price is ${min}`);
      }

      // Update store
      const store = await kv.get<{ items: StoreItem[] }>(this.STORE_KEY);
      const storeItems = store.value?.items || [];

      const storeItem = storeItems.find(item => item.id === item_id);
      const userValue = storeItem?.values.find(v => v.username === params.sender);

      if (!storeItem || !userValue) {
        throw new Error('Item not found in your storage');
      }

      userValue.price = price;
      await kv.set(this.STORE_KEY, { items: storeItems });

      await api.tellraw(params.sender, JSON.stringify({
        text: price > 0
          ? `Listed ${item_id} for ${price} coins`
          : `Unlisted ${item_id} from market`,
        color: "green"
      }));

      log(`Player ${params.sender} set price of ${item_id} to ${price}`);
      return { success: true };

    } catch (error) {
      log(`Error setting price: ${error.message}`);
      throw error;
    }
  }

  @Socket('buy_item')
  @Permission('player')
  async handleBuyItem({ params, kv, api, log }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_id, seller_username, amount } = params;

      // Check store for item
      const store = await kv.get<{ items: StoreItem[] }>(this.STORE_KEY);
      const storeItems = store.value?.items || [];

      const storeItem = storeItems.find(item => item.id === item_id);
      const sellerValue = storeItem?.values.find(v => v.username === seller_username);

      if (!storeItem || !sellerValue) {
        throw new Error('Item not found in seller\'s storage');
      }

      if (sellerValue.count < amount) {
        throw new Error('Seller does not have enough items');
      }

      if (!sellerValue.price || sellerValue.price <= 0) {
        throw new Error('Item is not for sale');
      }

      const totalCost = sellerValue.price * amount;

      // Check buyer's XP balance
      const balanceResponse = await api.executeCommand(`xp query ${params.sender} levels`);
      const balance = parseInt(balanceResponse.match(/\d+/)?.[0] || '0');

      if (balance < totalCost) {
        throw new Error('Insufficient funds');
      }

      // Transfer XP
      await api.executeCommand(`xp add ${params.sender} -${totalCost} levels`);
      await api.executeCommand(`xp add ${seller_username} ${totalCost} levels`);

      // Update store
      sellerValue.count -= amount;

      // Give item to buyer
      const buyerValue = storeItem.values.find(v => v.username === params.sender);
      if (buyerValue) {
        buyerValue.count += amount;
      } else {
        storeItem.values.push({
          username: params.sender,
          count: amount,
          price: 0
        });
      }

      // Clean up if seller has no more items
      if (sellerValue.count === 0) {
        storeItem.values = storeItem.values.filter(v => v.username !== seller_username);
        if (storeItem.values.length === 0) {
          storeItems.splice(storeItems.indexOf(storeItem), 1);
        }
      }

      await kv.set(this.STORE_KEY, { items: storeItems });

      // Notify both parties
      await api.tellraw(params.sender, JSON.stringify({
        text: `Bought ${amount} ${item_id} from ${seller_username} for ${totalCost} coins`,
        color: "green"
      }));

      await api.tellraw(seller_username, JSON.stringify({
        text: `${params.sender} bought ${amount} ${item_id} for ${totalCost} coins`,
        color: "green"
      }));

      log(`Player ${params.sender} bought ${amount} ${item_id} from ${seller_username} for ${totalCost}`);
      return { success: true };

    } catch (error) {
      log(`Error buying item: ${error.message}`);
      throw error;
    }
  }

  // Get market listings (items with price > 0)
  @Socket('get_market')
  async handleGetMarket({ kv, params }: ScriptContext): Promise<{ success: boolean; data: { items: StoreItem[] } }> {
    const store = await kv.get<{ items: StoreItem[] }>(this.STORE_KEY);

    console.dir(store)
    const marketItems = store.value?.items.map(item => ({
      ...item,
      values: item.values.filter(v => v.price > 0 && v.count > 0)
    })).filter(item => item.values.length > 0) || [];
    console.dir(marketItems)

    return {
      success: true,
      data: {
        items: marketItems
      }
    };
  }

  // Get all seller listings
  @Socket('get_my_listings')
  @Permission('player')
  async handleGetMyListings({ kv, params }: ScriptContext): Promise<{ success: boolean; data: { items: StoreItem[] } }> {
    const store = await kv.get<{ items: StoreItem[] }>(this.STORE_KEY);
    const myItems = store.value?.items.map(item => ({
      ...item,
      values: item.values.filter(v => v.username === params.sender)
    })).filter(item => item.values.length > 0) || [];

    return {
      success: true,
      data: {
        items: myItems
      }
    };
  }
}
