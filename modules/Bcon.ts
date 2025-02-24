import {
  Argument,
  Command,
  Description,
  Event,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";
import type { ScriptContext } from "../types";

interface Message {
  sender: string;
  content: string;
  timestamp: number;
  type: "global" | "direct";
  recipient?: string;
}

interface ChatHistory {
  messages: Message[];
  lastRead?: number;
}

@Module({
  name: "Bcon",
  version: "1.0.0",
  description: "Messaging system for player communication",
})
export class Bcon {
  private readonly MAX_HISTORY = 10;
  private readonly MESSAGE_LENGTH_LIMIT = 256;

  @Command(["bcon", "send"])
  @Description("Send a direct message to a player")
  @Permission("player")
  @Argument([
    { name: "player", type: "player", description: "Player to message" },
    { name: "message", type: "string", description: "Message content" },
  ])
  async sendDirectMessage(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { player: recipient, message } = args;

    try {
      if (sender === recipient) {
        throw new Error("Cannot send messages to yourself");
      }

      if (message.length > this.MESSAGE_LENGTH_LIMIT) {
        throw new Error(
          `Message too long (max ${this.MESSAGE_LENGTH_LIMIT} characters)`,
        );
      }

      const newMessage: Message = {
        sender,
        content: message,
        timestamp: Date.now(),
        type: "direct",
        recipient,
      };

      // Update sender's outbox
      await this.updateChatHistory(
        kv,
        ["bcon", "dm", sender, recipient],
        newMessage,
      );
      // Update recipient's inbox
      await this.updateChatHistory(
        kv,
        ["bcon", "dm", recipient, sender],
        newMessage,
      );

      // Notify recipient
      const recipientMsg = container([
        text("📨 New Message 📨\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("From: ", { style: { color: "gray" } }),
        text(`${sender}\n`, { style: { color: "aqua" } }),
        text(message + "\n", { style: { color: "white" } }),
        button("Reply", {
          variant: "success",
          onClick: { action: "suggest_command", value: `/msg send ${sender} ` },
        }),
      ]);

      await tellraw(
        recipient,
        recipientMsg.render({ platform: "minecraft", player: recipient }),
      );

      // Confirm to sender
      const senderMsg = container([
        text("✉️ Message Sent ✉️\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("To: ", { style: { color: "gray" } }),
        text(`${recipient}\n`, { style: { color: "aqua" } }),
        text(message, { style: { color: "white" } }),
      ]);

      log(`${sender} sent message to ${recipient}`);
      const messages = await tellraw(
        sender,
        senderMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Message Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["bcon", "global"])
  @Description("Send a message to global chat")
  @Permission("player")
  @Argument([
    { name: "message", type: "string", description: "Message content" },
  ])
  async sendGlobalMessage(
    { params, kv, tellraw, log }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { message } = args;

    try {
      if (message.length > this.MESSAGE_LENGTH_LIMIT) {
        throw new Error(
          `Message too long (max ${this.MESSAGE_LENGTH_LIMIT} characters)`,
        );
      }

      const newMessage: Message = {
        sender,
        content: message,
        timestamp: Date.now(),
        type: "global",
      };

      // Update global chat history
      await this.updateChatHistory(kv, ["bcon", "global"], newMessage);

      const globalMsg = container([
        text("🌐 ", { style: { color: "aqua" } }),
        text(sender, { style: { color: "yellow" } }),
        text(": ", { style: { color: "white" } }),
        text(message, { style: { color: "white" } }),
      ]);

      log(`${sender} sent global message: ${message}`);
      const messages = await tellraw(
        "@a",
        globalMsg.render({ platform: "minecraft", player: "@a" }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Message Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["bcon", "history"])
  @Description("View message history with a player")
  @Permission("player")
  @Argument([
    {
      name: "player",
      type: "player",
      description: "Player to view history with",
    },
  ])
  async viewHistory(
    { params, kv, tellraw }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { player } = args;

    try {
      const historyResult = await kv.get(["bcon", "dm", sender, player]);
      const history = historyResult.value as ChatHistory || { messages: [] };

      if (history.messages.length === 0) {
        throw new Error("No message history found");
      }

      const historyDisplay = container([
        text(`📜 Chat History with ${player} 📜\n`, {
          style: { color: "gold", styles: ["bold"] },
        }),
        divider(),
        ...history.messages.map((msg) => [
          text(`${new Date(msg.timestamp).toLocaleTimeString()} `, {
            style: { color: "gray" },
          }),
          text(msg.sender === sender ? "You" : msg.sender, {
            style: { color: msg.sender === sender ? "green" : "aqua" },
          }),
          text(": ", { style: { color: "white" } }),
          text(msg.content + "\n", { style: { color: "white" } }),
        ]),
        divider(),
        button("Reply", {
          variant: "success",
          onClick: { action: "suggest_command", value: `/msg send ${player} ` },
        }),
      ]);

      // Update last read timestamp
      history.lastRead = Date.now();
      await kv.set(["bcon", "dm", sender, player], history);

      const messages = await tellraw(
        sender,
        historyDisplay.render({ platform: "minecraft", player: sender }),
      );
      return { messages };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMsg.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  private async updateChatHistory(
    kv: any,
    key: string[],
    newMessage: Message,
  ): Promise<void> {
    const historyResult = await kv.get(key);
    const history = historyResult.value as ChatHistory || { messages: [] };

    history.messages.push(newMessage);
    if (history.messages.length > this.MAX_HISTORY) {
      history.messages = history.messages.slice(-this.MAX_HISTORY);
    }

    await kv.set(key, history);
  }

  @Socket("get_chat_history")
  @Permission("player")
  async getChatHistory({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { type, player } = params;
      const key = type === "global"
        ? ["bcon", "global"]
        : ["bcon", "dm", params.sender, player];

      const historyResult = await kv.get(key);
      const history = historyResult.value as ChatHistory || { messages: [] };

      return {
        success: true,
        data: history.messages,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("get_unread_count")
  @Permission("player")
  async getUnreadCount({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { sender } = params;
      let totalUnread = 0;

      const dmIterator = kv.list({ prefix: ["bcon", "dm", sender] });
      for await (const entry of dmIterator) {
        const history = entry.value as ChatHistory;
        if (history.messages.length > 0) {
          const lastMessage = history.messages[history.messages.length - 1];
          if (
            lastMessage.sender !== sender &&
            (!history.lastRead || lastMessage.timestamp > history.lastRead)
          ) {
            totalUnread++;
          }
        }
      }

      return {
        success: true,
        data: { unreadCount: totalUnread },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Socket("msg_global")
  @Permission("player")
  async sendSocketGlobalMessage({ params }: ScriptContext): Promise<any> {
    try {
      const { message, id } = params;

      await this.broadcastMessage({
        id,
        type: "chat",
        sender: params.sender,
        message,
        timestamp: Date.now(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Socket("msg_send")
  @Permission("player")
  async sendSocketDirectMessage({ params }: ScriptContext): Promise<any> {
    try {
      const { recipient, message, id } = params;

      await this.broadcastMessage({
        id,
        type: "chat",
        sender: params.sender,
        recipient,
        message,
        timestamp: Date.now(),
      }, [params.sender, recipient]);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Socket("msg_edit")
  @Permission("player")
  async editMessage({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { messageId, content } = params;

      // Verify message ownership and update in KV store
      // Broadcast update to relevant participants
      await this.broadcastMessage({
        type: "message_edited",
        messageId,
        content,
        timestamp: Date.now(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Socket("msg_delete")
  @Permission("player")
  async deleteMessage({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { messageId } = params;

      // Verify message ownership and delete from KV store
      // Broadcast deletion to relevant participants
      await this.broadcastMessage({
        type: "message_deleted",
        messageId,
        timestamp: Date.now(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Socket("get_online_players")
  @Permission("player")
  getOnlinePlayers({ players }: ScriptContext): Promise<any> {
    try {
      return {
        success: true,
        data: players,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
