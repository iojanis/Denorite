import { Module, Socket, Permission, Event } from "../decorators.ts";
import { ScriptContext } from "../types.ts";
import { StoredItem } from "./InventoryHelper.ts";

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
  name: "Market",
  version: "1.0.2",
})
export class Market {
  private readonly USER_STORE_PREFIX = "store:user:";

  private getUserStoreKey(username: string): string[] {
    return [this.USER_STORE_PREFIX + username];
  }

  @Socket("get_market")
  @Permission("player")
  async handleGetMarket({ kv }: ScriptContext): Promise<{
    success: boolean;
    data: { listings: MarketListing[] };
  }> {
    try {
      const itemMap = new Map<string, MarketListing>();

      // Iterate through all user stores
      for await (const entry of kv.list({ prefix: ["store", "user"] })) {
        const username = entry.key[2]; // ['store', 'user', 'username']
        const store = await kv.get<{ items: StoredItem[] }>(entry.key);

        if (store.value?.items) {
          // Process each item in the user's store
          for (const item of store.value.items) {
            if (item.price > 0 && item.count > 0) {
              // Get or create the market listing for this item
              let listing = itemMap.get(item.id);
              if (!listing) {
                listing = {
                  id: item.id,
                  values: [],
                };
                itemMap.set(item.id, listing);
              }

              // Add this seller's offering
              listing.values.push({
                seller: username,
                count: item.count,
                price: item.price,
                tag: item.tag,
              });
            }
          }
        }
      }

      // Convert map to array and sort by item ID
      const listings = Array.from(itemMap.values()).sort((a, b) =>
        a.id.localeCompare(b.id),
      );

      return {
        success: true,
        data: { listings },
      };
    } catch (error) {
      console.error("Market listing error:", error);
      throw error;
    }
  }

  @Socket("buy_item")
  @Permission("player")
  async handleBuyItem({
    params,
    kv,
    api,
    tellraw,
    log,
  }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_id, seller_username, amount } = params;

      if (params.sender === seller_username) {
        throw new Error("You cannot buy your own items");
      }

      // Get seller's store
      const sellerStore = await kv.get<{ items: StoredItem[] }>([
        "store",
        "user",
        seller_username,
      ]);
      const sellerItems = sellerStore.value?.items || [];

      const sellerItem = sellerItems.find((item) => item.id === item_id);
      if (!sellerItem) {
        throw new Error("Item not found in seller's storage");
      }

      if (sellerItem.count < amount) {
        throw new Error("Seller does not have enough items");
      }

      if (!sellerItem.price || sellerItem.price <= 0) {
        throw new Error("Item is not for sale");
      }

      const totalCost = BigInt(Math.floor(sellerItem.price * amount));

      // Check buyer's XP balance
      const buyerBalanceResult = await kv.get<Deno.KvU64>([
        "plugins",
        "economy",
        "balances",
        params.sender,
      ]);
      const buyerBalance = buyerBalanceResult.value?.value || BigInt(0);

      if (buyerBalance < totalCost) {
        throw new Error(`Insufficient XP levels. Need ${totalCost} XPL`);
      }

      // Get buyer's store
      const buyerStore = await kv.get<{ items: StoredItem[] }>([
        "store",
        "user",
        params.sender,
      ]);
      const buyerItems = buyerStore.value?.items || [];

      // Find or create buyer's item entry
      let buyerItem = buyerItems.find((item) => item.id === item_id);
      if (buyerItem) {
        buyerItem.count += amount;
      } else {
        buyerItem = {
          id: item_id,
          count: amount,
          price: 0,
          tag: sellerItem.tag,
        };
        buyerItems.push(buyerItem);
      }

      // Update seller's items
      const updatedSellerItems = sellerItems
        .map((item) => {
          if (item.id === item_id) {
            return { ...item, count: item.count - amount };
          }
          return item;
        })
        .filter((item) => item.count > 0);

      const sellerBalanceResult = await kv.get<Deno.KvU64>([
        "plugins",
        "economy",
        "balances",
        seller_username,
      ]);
      const sellerBalance = sellerBalanceResult.value?.value || BigInt(0);

      // Update balances and inventories atomically
      const result = await kv
        .atomic()
        // Update XP balances
        .set(
          ["plugins", "economy", "balances", params.sender],
          new Deno.KvU64(buyerBalance - totalCost),
        )
        .set(
          ["plugins", "economy", "balances", seller_username],
          new Deno.KvU64(sellerBalance + totalCost),
        )
        // Update stores
        .set(["store", "user", seller_username], { items: updatedSellerItems })
        .set(["store", "user", params.sender], { items: buyerItems })
        .commit();

      if (!result.ok) {
        throw new Error("Transaction failed. Please try again");
      }

      // Record transactions
      await this.addTransaction(kv, params.sender, {
        timestamp: new Date().toISOString(),
        type: "market_buy",
        amount: Number(-totalCost),
        balance: Number(buyerBalance - totalCost),
        description: `Bought ${amount} ${item_id} from ${seller_username}`,
      });

      await this.addTransaction(kv, seller_username, {
        timestamp: new Date().toISOString(),
        type: "market_sell",
        amount: Number(totalCost),
        balance: Number(sellerBalance + totalCost),
        description: `Sold ${amount} ${item_id} to ${params.sender}`,
      });

      // Notify both parties
      await tellraw(
        params.sender,
        JSON.stringify({
          text: `Bought ${amount} ${item_id} from ${seller_username} for ${Number(totalCost)} XPL`,
          color: "green",
        }),
      );

      await tellraw(
        seller_username,
        JSON.stringify({
          text: `${params.sender} bought ${amount} ${item_id} for ${Number(totalCost)} XPL`,
          color: "green",
        }),
      );

      log(
        `Player ${params.sender} bought ${amount} ${item_id} from ${seller_username} for ${Number(totalCost)} XPL`,
      );
      return { success: true };
    } catch (error) {
      log(`Error buying item: ${error.message}`);
      throw error;
    }
  }

  private async addTransaction(
    kv: any,
    player: string,
    transaction: Transaction,
  ): Promise<void> {
    const key = ["plugins", "economy", "transactions", player];
    const existing = await kv.get(key);
    const transactions = existing.value || [];
    transactions.unshift(transaction);
    if (transactions.length > 50) transactions.length = 50;
    await kv.set(key, transactions);
  }
}
