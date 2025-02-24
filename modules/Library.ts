import {
  Argument,
  Command,
  Description,
  Module,
  Permission,
} from "../decorators.ts";
import type { ScriptContext } from "../types.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";

interface Thread {
  id: string;
  title: string;
  content: string;
  author: string;
  categoryId: string;
  createdAt: string;
  updatedAt: string;
  copies: number;
}

interface Comment {
  id: string;
  threadId: string;
  author: string;
  content: string;
  createdAt: string;
}

interface Category {
  id: string;
  title: string;
}

@Module({
  name: "Library",
  version: "1.1.0",
})
export class Library {
  private readonly THREAD_COST = 3;

  private async getThread(
    kv: ScriptContext["kv"],
    threadId: string,
  ): Promise<Thread | null> {
    const result = await kv.get<Thread>(["library", "threads", threadId]);
    return result.value;
  }

  private async getThreadOwners(
    kv: ScriptContext["kv"],
    threadId: string,
  ): Promise<string[]> {
    const result = await kv.get<string[]>([
      "library",
      "thread_owners",
      threadId,
    ]);
    return result.value || [];
  }

  @Command(["library"])
  @Description("Library management commands")
  @Permission("player")
  async library({
    params,
    tellraw,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    const menuContent = container([
      text("=== Library Commands ===", {
        style: { color: "gold", styles: ["bold"] },
      }),
      text("\n"),
      button("List Threads", {
        variant: "default",
        onClick: {
          action: "run_command",
          value: "/library list",
        },
      }),
      text(" - View all available threads\n", { style: { color: "gray" } }),
      button("Create Thread...", {
        variant: "ghost",
        onClick: {
          action: "suggest_command",
          value: "/library create ",
        },
      }),
      text(" - Create a new thread\n", { style: { color: "gray" } }),
      button("Categories", {
        variant: "default",
        onClick: {
          action: "run_command",
          value: "/library categories",
        },
      }),
      text(" - View thread categories\n", { style: { color: "gray" } }),
      divider(),
      text(`Thread Cost: ${this.THREAD_COST} XPL`, {
        style: { color: "yellow" },
      }),
    ]);

    const messages = await tellraw(
      sender,
      menuContent.render({ platform: "minecraft", player: sender }),
    );
    return { messages };
  }

  @Command(["library", "list"])
  @Description("List all library threads")
  @Permission("player")
  async listThreads({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; threads?: Thread[] }> {
    const { sender } = params;

    try {
      const threads: Thread[] = [];
      const iterator = kv.list<Thread>({ prefix: ["library", "threads"] });
      for await (const entry of iterator) {
        threads.push(entry.value);
      }

      if (threads.length === 0) {
        const emptyMessage = alert([], {
          variant: "default",
          title: "Library",
          description: "No threads found in the library.",
        });
        const messages = await tellraw(
          sender,
          emptyMessage.render({ platform: "minecraft", player: sender }),
        );
        return { messages };
      }

      const threadsList = container([
        text("=== Library Threads ===", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("\n\n"),
        ...threads.map((thread) =>
          container([
            button(thread.title, {
              variant: "ghost",
              onClick: {
                action: "run_command",
                value: `/library view ${thread.id}`,
              },
            }),
            text(` by ${thread.author}`, { style: { color: "gray" } }),
            text(` (${thread.copies} copies)`, { style: { color: "green" } }),
            text("\n"),
          ])
        ),
      ]);

      const messages = await tellraw(
        sender,
        threadsList.render({ platform: "minecraft", player: sender }),
      );
      return { messages, threads };
    } catch (error) {
      log(`Error listing threads: ${error.message}`);
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

  @Command(["library", "view"])
  @Description("View a library thread")
  @Permission("player")
  @Argument([
    { name: "threadId", type: "string", description: "Thread ID to view" },
  ])
  async viewThread({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; thread?: Thread }> {
    const { sender, args } = params;

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) {
        throw new Error("Thread not found");
      }

      const owners = await this.getThreadOwners(kv, args.threadId);
      const comments: Comment[] = [];
      const commentIterator = kv.list<Comment>({
        prefix: ["library", "comments", thread.id],
      });
      for await (const entry of commentIterator) {
        comments.push(entry.value);
      }

      const threadContent = container([
        text(`=== ${thread.title} ===`, {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(`\nBy: ${thread.author}`, { style: { color: "yellow" } }),
        text(`\nCreated: ${new Date(thread.createdAt).toLocaleString()}`, {
          style: { color: "gray" },
        }),
        text(`\nUpdated: ${new Date(thread.updatedAt).toLocaleString()}`, {
          style: { color: "gray" },
        }),
        text("\n\n"),
        text(thread.content, { style: { color: "white" } }),
        text("\n\n"),
        ...(owners.includes(sender) ? [] : [
          button("Buy Copy", {
            variant: "success",
            onClick: {
              action: "run_command",
              value: `/library buy ${thread.id}`,
            },
          }),
        ]),
        text(" "),
        button("Comment...", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: `/library comment ${thread.id} `,
          },
        }),
        ...(thread.author === sender
          ? [
            text(" "),
            button("Edit...", {
              variant: "ghost",
              onClick: {
                action: "suggest_command",
                value: `/library edit ${thread.id} ${thread.content}`,
              },
            }),
            text(" "),
            button("Delete", {
              variant: "destructive",
              onClick: {
                action: "suggest_command",
                value: `/library delete ${thread.id}`,
              },
            }),
          ]
          : []),
        ...(comments.length > 0
          ? [
            divider(),
            text("Comments:", {
              style: { color: "yellow", styles: ["bold"] },
            }),
            text("\n"),
            ...comments.map((comment) =>
              container([
                text(`${comment.author}: `, { style: { color: "gray" } }),
                text(comment.content, { style: { color: "white" } }),
                ...(comment.author === sender
                  ? [
                    text(" "),
                    button("Delete", {
                      variant: "destructive",
                      onClick: {
                        action: "run_command",
                        value:
                          `/library deleteComment ${thread.id} ${comment.id}`,
                      },
                    }),
                  ]
                  : []),
                text("\n"),
              ])
            ),
          ]
          : []),
      ]);

      const messages = await tellraw(
        sender,
        threadContent.render({ platform: "minecraft", player: sender }),
      );
      return { messages, thread };
    } catch (error) {
      log(`Error viewing thread: ${error.message}`);
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

  @Command(["library", "edit"])
  @Description("Edit a library thread")
  @Permission("player")
  @Argument([
    { name: "threadId", type: "string", description: "Thread ID to edit" },
    { name: "content", type: "string", description: "New thread content" },
  ])
  async editThread({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; thread?: Thread }> {
    const { sender, args } = params;

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error("Thread not found");
      if (thread.author !== sender) throw new Error("Not authorized");

      const updatedThread = {
        ...thread,
        content: args.content,
        updatedAt: new Date().toISOString(),
      };

      await kv.set(["library", "threads", args.threadId], updatedThread);

      const successMessage = alert([], {
        variant: "success",
        title: "Success",
        description: "Thread updated successfully!",
      });

      const messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );
      log(`Thread updated: ${args.threadId} by ${sender}`);
      return { messages, thread: updatedThread };
    } catch (error) {
      log(`Error updating thread: ${error.message}`);
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

  @Command(["library", "buy"])
  @Description("Buy a copy of a library thread")
  @Permission("player")
  @Argument([
    { name: "threadId", type: "string", description: "Thread ID to buy" },
  ])
  async buyThread({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; thread?: Thread }> {
    const { sender, args } = params;

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error("Thread not found");

      const owners = await this.getThreadOwners(kv, args.threadId);
      if (owners.includes(sender)) {
        throw new Error("You already own this thread");
      }

      const balanceResult = await kv.get([
        "plugins",
        "economy",
        "balances",
        sender,
      ]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < this.THREAD_COST) {
        throw new Error(`Insufficient balance. Need ${this.THREAD_COST} XPL`);
      }

      const newBalance = balance - this.THREAD_COST;
      const updatedThread = {
        ...thread,
        copies: thread.copies + 1,
      };

      await kv
        .atomic()
        .set(
          ["plugins", "economy", "balances", sender],
          new Deno.KvU64(BigInt(newBalance)),
        )
        .set(["library", "thread_owners", args.threadId], [...owners, sender])
        .set(["library", "threads", args.threadId], updatedThread)
        .commit();

      const successMessage = container([
        text("Thread purchased successfully!", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("\nNew balance: ", { style: { color: "gray" } }),
        text(`${newBalance} XPL`, { style: { color: "yellow" } }),
        text("\n"),
        button("View Thread", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/library view ${args.threadId}`,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );
      log(`Thread purchased: ${args.threadId} by ${sender}`);
      return { messages, thread: updatedThread };
    } catch (error) {
      log(`Error purchasing thread: ${error.message}`);
      const errorMessage = alert([], {
        variant: "destructive",
        title: "Purchase Failed",
        description: error.message,
      });
      const messages = await tellraw(
        sender,
        errorMessage.render({ platform: "minecraft", player: sender }),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["library", "delete"])
  @Description("Delete a library thread")
  @Permission("player")
  @Argument([
    { name: "threadId", type: "string", description: "Thread ID to delete" },
  ])
  async deleteThread({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error("Thread not found");
      if (thread.author !== sender) throw new Error("Not authorized");

      await kv
        .atomic()
        .delete(["library", "threads", args.threadId])
        .delete(["library", "thread_owners", args.threadId])
        .commit();

      const commentsIterator = kv.list({
        prefix: ["library", "comments", args.threadId],
      });
      for await (const entry of commentsIterator) {
        await kv.delete(entry.key);
      }

      const successMessage = alert([], {
        variant: "success",
        title: "Success",
        description: "Thread deleted successfully!",
      });

      const messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );
      log(`Thread deleted: ${args.threadId} by ${sender}`);
      return { messages };
    } catch (error) {
      log(`Error deleting thread: ${error.message}`);
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

  @Command(["library", "comment"])
  @Description("Comment on a library thread")
  @Permission("player")
  @Argument([
    {
      name: "threadId",
      type: "string",
      description: "Thread ID to comment on",
    },
    { name: "content", type: "string", description: "Comment content" },
  ])
  async createComment({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; comment?: Comment }> {
    const { sender, args } = params;

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error("Thread not found");

      const commentId = crypto.randomUUID();
      const comment: Comment = {
        id: commentId,
        threadId: args.threadId,
        author: sender,
        content: args.content,
        createdAt: new Date().toISOString(),
      };

      await kv.set(["library", "comments", args.threadId, commentId], comment);

      const successMessage = container([
        text("Comment added successfully!", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("\n"),
        button("View Thread", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/library view ${args.threadId}`,
          },
        }),
      ]);

      let messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );

      // Notify thread author if different from commenter
      if (thread.author !== sender) {
        const notificationMessage = container([
          text("New comment on your thread ", { style: { color: "yellow" } }),
          text(thread.title, { style: { color: "gold" } }),
          text(` by ${sender}`, { style: { color: "yellow" } }),
          text("\n"),
          button("View Thread", {
            variant: "outline",
            onClick: {
              action: "run_command",
              value: `/library view ${args.threadId}`,
            },
          }),
        ]);

        const notification = await tellraw(
          thread.author,
          notificationMessage.render({
            platform: "minecraft",
            player: thread.author,
          }),
        );
        messages = messages.concat(notification);
      }

      log(
        `Comment created: ${commentId} by ${sender} on thread ${args.threadId}`,
      );
      return { messages, comment };
    } catch (error) {
      log(`Error creating comment: ${error.message}`);
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

  @Command(["library", "categories"])
  @Description("List available library categories")
  @Permission("player")
  async listCategories({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; categories?: Category[] }> {
    const { sender } = params;

    try {
      const categories: Category[] = [];
      const iterator = kv.list<Category>({ prefix: ["library", "categories"] });
      for await (const entry of iterator) {
        categories.push(entry.value);
      }

      if (categories.length === 0) {
        const emptyMessage = alert([], {
          variant: "default",
          title: "Categories",
          description: "No categories found.",
        });
        const messages = await tellraw(
          sender,
          emptyMessage.render({ platform: "minecraft", player: sender }),
        );
        return { messages, categories: [] };
      }

      const categoriesList = container([
        text("=== Library Categories ===", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("\n\n"),
        ...categories.map((category) =>
          container([
            text("• ", { style: { color: "yellow" } }),
            text(category.title, { style: { color: "white" } }),
            text("\n"),
          ])
        ),
        text("\n"),
        button("Create Thread...", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: "/library create ",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        categoriesList.render({ platform: "minecraft", player: sender }),
      );
      return { messages, categories };
    } catch (error) {
      log(`Error listing categories: ${error.message}`);
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

  @Command(["library", "create"])
  @Description("Create a new library thread")
  @Permission("player")
  @Argument([
    { name: "title", type: "string", description: "Thread title" },
    { name: "categoryId", type: "string", description: "Category ID" },
    { name: "content", type: "string", description: "Thread content" },
  ])
  async createThread({
    params,
    kv,
    tellraw,
    log,
  }: ScriptContext): Promise<{ messages: any[]; thread?: Thread }> {
    const { sender, args } = params;

    console.log(params);

    try {
      const threadId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      const thread: Thread = {
        id: threadId,
        title: args.title,
        content: args.content,
        author: sender,
        categoryId: args.categoryId,
        createdAt: timestamp,
        updatedAt: timestamp,
        copies: 0,
      };

      await kv
        .atomic()
        .set(["library", "threads", threadId], thread)
        .set(["library", "thread_owners", threadId], [sender])
        .commit();

      const successMessage = container([
        text("Thread created successfully!", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("\n"),
        button("View Thread", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/library view ${threadId}`,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMessage.render({ platform: "minecraft", player: sender }),
      );
      log(`Thread created: ${threadId} by ${sender}`);
      return { messages, thread };
    } catch (error) {
      log(`Error creating thread: ${error.message}`);
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
}
