import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Online,
  Permission,
  Socket,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";

interface EconomyConfig {
  minDepositAmount: number;
  welcomeBonus: number;
  transferFee: number;
}

interface Transaction {
  timestamp: string;
  type: "deposit" | "withdraw" | "transfer" | "bonus";
  amount: number;
  balance: number;
  description: string;
}

@Module({
  name: "Economy",
  version: "1.1.1",
})
export class Economy {
  private readonly DEFAULT_CONFIG: EconomyConfig = {
    minDepositAmount: 5,
    welcomeBonus: 10,
    transferFee: 0.1,
  };

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async getConfig(kv: any): Promise<EconomyConfig> {
    const config = await kv.get(["plugins", "economy", "config"]);
    return config.value || this.DEFAULT_CONFIG;
  }

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

  @Event("player_joined")
  async handlePlayerSync(
    { params, kv, api }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { playerName } = params;

    await this.delay(1000);

    const balance = await this.getBalance(kv, playerName);
    const config = await this.getConfig(kv);

    // Set title times first (fade in, stay, fade out in ticks)
    await api.executeCommand(`title ${playerName} times 10 150 10`);

    // Show balance in actionbar
    const messages = await api.title(
      playerName,
      "actionbar",
      JSON.stringify({
        text: `Welcome back! Balance: ${balance} XPL`,
        color: "green",
      }),
    );

    if (balance === 0 && config.welcomeBonus > 0) {
      await kv.set(
        ["plugins", "economy", "balances", playerName],
        new Deno.KvU64(BigInt(config.welcomeBonus)),
      );
      await this.addTransaction(kv, playerName, {
        timestamp: new Date().toISOString(),
        type: "bonus",
        amount: config.welcomeBonus,
        balance: config.welcomeBonus,
        description: "Welcome bonus",
      });

      // Show welcome bonus message after a short delay
      await this.delay(2000);
      await api.title(
        playerName,
        "actionbar",
        JSON.stringify({
          text: `You received a welcome bonus of ${config.welcomeBonus} XPL!`,
          color: "green",
        }),
      );
    }

    return { messages };
  }

  @Command(["bank"])
  @Description("Bank management commands")
  @Permission("player")
  async bank(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const balance = await this.getBalance(kv, sender);
      const config = await this.getConfig(kv);

      const menuContent = container([
        text("=== XP Bank Commands ===", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("\nCurrent Balance: ", { style: { color: "yellow" } }),
        this.renderCurrency(balance, false),
        divider(),
        button("Check Balance", {
          variant: "default",
          onClick: {
            action: "run_command",
            value: "/bank balance",
          },
        }),
        text("\n"),
        button("View History", {
          variant: "default",
          onClick: {
            action: "run_command",
            value: "/bank history",
          },
        }),
        text("\n"),
        text(`\nDeposit/Withdraw Commands:`, { style: { color: "yellow" } }),
        button(`Quick Deposit ${config.minDepositAmount} XPL`, {
          variant: "success",
          onClick: {
            action: "run_command",
            value: `/bank deposit ${config.minDepositAmount}`,
          },
        }),
        text("\n"),
        button("Deposit...", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/bank deposit ",
          },
        }),
        text(` - Deposit XP (min: ${config.minDepositAmount} XPL)\n`, {
          style: { color: "gray" },
        }),
        button("Withdraw...", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/bank withdraw ",
          },
        }),
        text(` - Withdraw XP\n`, { style: { color: "gray" } }),
        button("Send...", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/bank send ",
          },
        }),
        text(` - Send XPL (fee: ${config.transferFee} XPL)`, {
          style: { color: "gray" },
        }),
      ]);

      const messages = await tellraw(
        sender,
        menuContent.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["bank", "balance"])
  @Description("Check your bank balance")
  @Permission("player")
  async checkBalance(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[]; balance?: number }> {
    const { sender } = params;

    try {
      const balance = await this.getBalance(kv, sender);

      const balanceDisplay = container([
        text("=== Bank Balance ===", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("\nCurrent Balance: ", { style: { color: "yellow" } }),
        this.renderCurrency(balance, false),
        text("\n"),
        button("View History", {
          variant: "outline",
          style: { styles: ["obfuscated"] },
          onClick: {
            action: "run_command",
            value: "/bank history",
          },
        }),
        text("\n"),
        button("Return to Menu", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/bank",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        balanceDisplay.render({ platform: "minecraft", player: sender }),
      );
      return { messages, balance };
    } catch (error) {
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["bank", "history"])
  @Description("View transaction history")
  @Permission("player")
  async viewHistory(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[]; transactions?: Transaction[] }> {
    const { sender } = params;

    try {
      const transactions = await kv.get([
        "plugins",
        "economy",
        "transactions",
        sender,
      ]);
      const recentTransactions = (transactions.value || []).slice(0, 10);

      const historyContent = container([
        text("=== Transaction History ===", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("\n\n"),
        ...recentTransactions.map((tx) =>
          container([
            this.renderCurrency(tx.amount),
            text(` - ${tx.description}\n`, { style: { color: "gray" } }),
            text(`${new Date(tx.timestamp).toLocaleString()}\n`, {
              style: { color: "dark_gray" },
            }),
          ])
        ),
        text("\n"),
        button("Return to Menu", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/bank",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        historyContent.render({ platform: "minecraft", player: sender }),
      );
      return { messages, transactions: recentTransactions };
    } catch (error) {
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Online()
  @Command(["bank", "deposit"])
  @Description("Deposit XP levels into your bank account")
  @Permission("player")
  @Argument([
    {
      name: "amount",
      type: "integer",
      description: "The amount of XP levels to deposit",
    },
  ])
  async deposit(
    { params, kv, tellraw, api, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean; newBalance?: number }> {
    const { sender, args } = params;
    const amount = args.amount;

    try {
      const config = await this.getConfig(kv);

      if (amount < config.minDepositAmount) {
        throw new Error(
          `Minimum deposit amount is ${config.minDepositAmount} XPL`,
        );
      }

      const xpLevels = await api.xpQuery(sender, "levels");
      if (xpLevels < amount) {
        throw new Error(
          `You don't have enough XP levels (${xpLevels}/${amount})`,
        );
      }

      await api.xp("remove", sender, amount, "levels");

      const currentBalance = await this.getBalance(kv, sender);
      const newBalance = currentBalance + parseInt(amount);

      await kv.atomic()
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(newBalance)),
        )
        .commit();

      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: "deposit",
        amount,
        balance: newBalance,
        description: "XP level deposit",
      });

      const successMessage = container([
        text("Deposit Successful!\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Amount: ", { style: { color: "gray" } }),
        this.renderCurrency(amount),
        text("\nNew Balance: ", { style: { color: "gray" } }),
        this.renderCurrency(newBalance, false),
        text("\n"),
        button("View History", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/bank history",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );
      log(`${sender} deposited ${amount} XPL. New balance: ${newBalance}`);

      return { messages, success: true, newBalance };
    } catch (error) {
      log(`Error in deposit: ${error.message}`);
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Deposit Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Online()
  @Command(["bank", "withdraw"])
  @Description("Withdraw XP levels from your bank account")
  @Permission("player")
  @Argument([
    {
      name: "amount",
      type: "integer",
      description: "The amount of XP levels to withdraw",
    },
  ])
  async withdraw(
    { params, kv, tellraw, api, log }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean; newBalance?: number }> {
    const { sender, args } = params;
    const amount = args.amount;

    try {
      if (amount <= 0) {
        throw new Error("Withdrawal amount must be greater than 0");
      }

      const currentBalance = await this.getBalance(kv, sender);
      if (currentBalance < amount) {
        throw new Error(
          `Insufficient balance. You only have ${currentBalance} XPL`,
        );
      }

      const newBalance = currentBalance - parseInt(amount);

      const result = await kv.atomic()
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(newBalance)),
        )
        .commit();

      if (!result.ok) {
        throw new Error("Withdrawal failed. Please try again");
      }

      await api.xp("add", sender, amount, "levels");

      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: "withdraw",
        amount: -amount,
        balance: newBalance,
        description: "XP level withdrawal",
      });

      const successMessage = container([
        text("Withdrawal Successful!\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Amount: ", { style: { color: "gray" } }),
        this.renderCurrency(-amount),
        text("\nNew Balance: ", { style: { color: "gray" } }),
        this.renderCurrency(newBalance, false),
        text("\n"),
        button("View History", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/bank history",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );
      log(`${sender} withdrew ${amount} XPL. New balance: ${newBalance}`);

      return { messages, success: true, newBalance };
    } catch (error) {
      log(`Error in withdrawal: ${error.message}`);
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Withdrawal Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["bank", "send"])
  @Description("Send XP levels to another player")
  @Permission("player")
  @Argument([
    {
      name: "player",
      type: "player",
      description: "The player to send XPL to",
    },
    {
      name: "amount",
      type: "integer",
      description: "The amount of XPL to send",
    },
  ])
  async send({ params, kv, tellraw, log }: ScriptContext): Promise<{
    messages: any[];
    success?: boolean;
    senderNewBalance?: number;
    receiverNewBalance?: number;
  }> {
    const { sender, args } = params;
    const { player: receiver, amount } = args;

    try {
      if (sender === receiver) {
        throw new Error("You cannot send XPL to yourself");
      }

      const config = await this.getConfig(kv);
      const totalAmount = amount + config.transferFee;

      const senderBalance = await this.getBalance(kv, sender);
      if (senderBalance < totalAmount) {
        throw new Error(
          `Insufficient balance. Need ${totalAmount} XPL (including ${config.transferFee} XPL transfer fee)`,
        );
      }

      const receiverBalance = await this.getBalance(kv, receiver);

      const result = await kv.atomic()
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(senderBalance - totalAmount)),
        )
        .set(
          ["plugins", "economy", "balances", receiver],
          new Deno.KvU64(BigInt(receiverBalance + amount)),
        )
        .commit();

      if (!result.ok) {
        throw new Error("Transfer failed. Please try again");
      }

      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: "transfer",
        amount: -totalAmount,
        balance: senderBalance - totalAmount,
        description:
          `Transfer to ${receiver} (including ${config.transferFee} XPL fee)`,
      });

      await this.addTransaction(kv, receiver, {
        timestamp: new Date().toISOString(),
        type: "transfer",
        amount,
        balance: receiverBalance + amount,
        description: `Transfer from ${sender}`,
      });

      // Notify sender
      const senderMessage = container([
        text("Transfer Successful!\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Sent to: ", { style: { color: "gray" } }),
        text(receiver, { style: { color: "yellow" } }),
        text("\nAmount: ", { style: { color: "gray" } }),
        this.renderCurrency(amount),
        text(`\nFee: ${config.transferFee} XPL\n`, {
          style: { color: "gray" },
        }),
        text("New Balance: ", { style: { color: "gray" } }),
        this.renderCurrency(senderBalance - totalAmount, false),
      ]);

      // Notify receiver
      const receiverMessage = container([
        text("Transfer Received!\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("From: ", { style: { color: "gray" } }),
        text(sender, { style: { color: "yellow" } }),
        text("\nAmount: ", { style: { color: "gray" } }),
        this.renderCurrency(amount),
        text("\nNew Balance: ", { style: { color: "gray" } }),
        this.renderCurrency(receiverBalance + amount, false),
      ]);

      const messages = [
        await tellraw(
          sender,
          senderMessage.render({ platform: "minecraft", player: sender }),
        ),
        await tellraw(
          receiver,
          receiverMessage.render({ platform: "minecraft", player: receiver }),
        ),
      ];

      log(
        `${sender} sent ${amount} XPL to ${receiver} (fee: ${config.transferFee})`,
      );

      return {
        messages: messages.flat(),
        success: true,
        senderNewBalance: senderBalance - totalAmount,
        receiverNewBalance: receiverBalance + amount,
      };
    } catch (error) {
      log(`Error in transfer: ${error.message}`);
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Transfer Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Socket("socket_bank_balance")
  @Permission("player")
  async getSocketBalance({ params, kv }: ScriptContext): Promise<any> {
    try {
      const balance = await this.getBalance(kv, params.playerName);
      return {
        success: true,
        balance,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("socket_bank_history")
  @Permission("player")
  async getHistory({ params, kv }: ScriptContext): Promise<any> {
    try {
      const transactions = await kv.get([
        "plugins",
        "economy",
        "transactions",
        params.playerName,
      ]);
      return {
        success: true,
        transactions: transactions.value || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
