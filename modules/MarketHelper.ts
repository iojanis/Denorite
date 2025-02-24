import { Event, Module, Permission, Socket } from "../decorators.ts";
import { ScriptContext } from "../types.ts";
import { StoredItem } from "./InventoryHelper.ts";
import {
  alert,
  button,
  container,
  divider,
  text,
  UIComponent,
} from "../tellraw-ui.ts";

interface ItemTag {
  Damage?: number;
  effects?: Array<{
    id: string;
    duration: number;
  }>;
  [key: string]: any;
}

interface MarketListing {
  id: string;
  values: Array<{
    seller: string;
    count: number;
    price: number;
    tag?: ItemTag;
  }>;
}

interface Transaction {
  timestamp: string;
  type: "market_buy" | "market_sell";
  amount: number;
  balance: number;
  description: string;
}

@Module({
  name: "Market",
  version: "1.0.3",
})
export class Market {
  private async getBalance(kv: any, player: string): Promise<number> {
    const record = await kv.get(["plugins", "economy", "balances", player]);
    return record.value ? Number(record.value) : 0;
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

  private renderCurrency(
    amount: number,
    showSign: boolean = true,
  ): UIComponent {
    const prefix = showSign ? (amount >= 0 ? "+" : "") : "";
    return text(`${prefix}${amount} XPL`, {
      style: { color: amount >= 0 ? "green" : "red", styles: ["bold"] },
    });
  }

  private getItemStoreKey(username: string, itemId: string): string[] {
    return ["player", username, "store", itemId];
  }

  @Socket("get_market")
  @Permission("player")
  async handleGetMarket({ kv, log }: ScriptContext): Promise<{
    success: boolean;
    data: { listings: MarketListing[] };
  }> {
    try {
      const itemMap = new Map<string, MarketListing>();
      const iterator = kv.list({ prefix: ["player"] });

      for await (const entry of iterator) {
        const key = entry.key;
        if (key[2] === "store") {
          const username = key[1];
          const itemId = key[3];
          const itemData = await kv.get<StoredItem>(key);

          if (
            itemData.value && itemData.value.price > 0 &&
            itemData.value.count > 0
          ) {
            let listing = itemMap.get(itemId);
            if (!listing) {
              listing = {
                id: itemId,
                values: [],
              };
              itemMap.set(itemId, listing);
            }

            listing.values.push({
              seller: username,
              count: itemData.value.count,
              price: itemData.value.price,
              tag: itemData.value.tag,
            });
          }
        }
      }

      const listings = Array.from(itemMap.values()).sort((a, b) =>
        a.id.localeCompare(b.id)
      );

      return {
        success: true,
        data: { listings },
      };
    } catch (error) {
      log(`Error getting market listings: ${error.message}`);
      throw error;
    }
  }

  @Socket("buy_item")
  @Permission("player")
  async handleBuyItem({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ success: boolean }> {
    try {
      const { item_id, amount, seller_username } = params;

      if (params.sender === seller_username) {
        throw new Error("You cannot buy your own items");
      }

      // Get seller's item
      const sellerItemKey = this.getItemStoreKey(seller_username, item_id);
      const sellerItem = await kv.get<StoredItem>(sellerItemKey);

      if (!sellerItem.value) {
        throw new Error("Item not found in seller's storage");
      }

      if (sellerItem.value.count < amount) {
        throw new Error("Seller does not have enough items");
      }

      if (!sellerItem.value.price || sellerItem.value.price <= 0) {
        throw new Error("Item is not for sale");
      }

      const totalCost = BigInt(Math.floor(sellerItem.value.price * amount));

      // Check buyer's balance
      const buyerBalance = await this.getBalance(kv, params.sender);
      if (BigInt(buyerBalance) < totalCost) {
        throw new Error(`Insufficient XP levels. Need ${totalCost} XPL`);
      }

      // Get buyer's item storage
      const buyerItemKey = this.getItemStoreKey(params.sender, item_id);
      const buyerItem = await kv.get<StoredItem>(buyerItemKey);

      // Prepare buyer's updated item
      const updatedBuyerItem: StoredItem = {
        count: (buyerItem.value?.count || 0) + amount,
        price: 0,
        tag: sellerItem.value.tag,
      };

      // Get seller's balance
      const sellerBalance = await this.getBalance(kv, seller_username);

      // Update everything atomically
      const result = await kv.atomic()
        // Update balances
        .set(
          ["plugins", "economy", "balances", params.sender],
          new Deno.KvU64(BigInt(buyerBalance) - totalCost),
        )
        .set(
          ["plugins", "economy", "balances", seller_username],
          new Deno.KvU64(BigInt(sellerBalance) + totalCost),
        )
        // Update buyer's storage
        .set(buyerItemKey, updatedBuyerItem)
        // Update seller's storage
        .check(sellerItemKey, sellerItem)
        .set(sellerItemKey, {
          ...sellerItem.value,
          count: sellerItem.value.count - amount,
        })
        .commit();

      if (!result.ok) {
        throw new Error("Transaction failed. Please try again");
      }

      // Record transactions
      await this.addTransaction(kv, params.sender, {
        timestamp: new Date().toISOString(),
        type: "market_buy",
        amount: -Number(totalCost),
        balance: Number(buyerBalance) - Number(totalCost),
        description: `Bought ${amount} ${item_id} from ${seller_username}`,
      });

      await this.addTransaction(kv, seller_username, {
        timestamp: new Date().toISOString(),
        type: "market_sell",
        amount: Number(totalCost),
        balance: Number(sellerBalance) + Number(totalCost),
        description: `Sold ${amount} ${item_id} to ${params.sender}`,
      });

      // Notify buyer
      const buyerMessage = container([
        text("Purchase Successful!\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Item: ", { style: { color: "gray" } }),
        text(item_id, { style: { color: "yellow" } }),
        text("\nAmount: ", { style: { color: "gray" } }),
        text(`${amount}`, { style: { color: "yellow" } }),
        text("\nCost: ", { style: { color: "gray" } }),
        this.renderCurrency(-Number(totalCost)),
        text("\nSeller: ", { style: { color: "gray" } }),
        text(seller_username, { style: { color: "yellow" } }),
        text("\nNew Balance: ", { style: { color: "gray" } }),
        this.renderCurrency(Number(buyerBalance) - Number(totalCost), false),
      ]);

      // Notify seller
      const sellerMessage = container([
        text("Sale Complete!\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Item: ", { style: { color: "gray" } }),
        text(item_id, { style: { color: "yellow" } }),
        text("\nAmount: ", { style: { color: "gray" } }),
        text(`${amount}`, { style: { color: "yellow" } }),
        text("\nReceived: ", { style: { color: "gray" } }),
        this.renderCurrency(Number(totalCost)),
        text("\nBuyer: ", { style: { color: "gray" } }),
        text(params.sender, { style: { color: "yellow" } }),
        text("\nNew Balance: ", { style: { color: "gray" } }),
        this.renderCurrency(Number(sellerBalance) + Number(totalCost), false),
      ]);

      // Send messages to both parties
      const buyerMessages = await tellraw(
        params.sender,
        buyerMessage.render({ platform: "minecraft", player: params.sender }),
      );

      const sellerMessages = await tellraw(
        seller_username,
        sellerMessage.render({
          platform: "minecraft",
          player: seller_username,
        }),
      );

      log(
        `Player ${params.sender} bought ${amount} ${item_id} from ${seller_username} for ${
          Number(totalCost)
        } XPL`,
      );
      return { success: true };
    } catch (error) {
      log(`Error buying item: ${error.message}`);
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Purchase Failed",
        description: error.message,
      });
      await tellraw(
        params.sender,
        errorMessage.render({ platform: "minecraft", player: params.sender }),
      );
      throw error;
    }
  }
}
