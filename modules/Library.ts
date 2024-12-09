import { Module, Command, Description, Permission, Argument } from '../decorators.ts';
import type { ScriptContext } from '../types.ts';

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
  name: 'Library',
  version: '1.1.0',
})
export class Forum {
  private readonly THREAD_COST = 3; // Cost in XPL to buy a thread

  private async getThread(kv: ScriptContext['kv'], threadId: string): Promise<Thread | null> {
    const result = await kv.get<Thread>(['library', 'threads', threadId]);
    return result.value;
  }

  private async getThreadOwners(kv: ScriptContext['kv'], threadId: string): Promise<string[]> {
    const result = await kv.get<string[]>(['library', 'thread_owners', threadId]);
    return result.value || [];
  }

  @Command(['library'])
  @Description('Forum management commands')
  @Permission('player')
  async forum({ params, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    let messages = [];

    messages = await tellraw(sender, JSON.stringify([
      { text: "=== Forum Commands ===\n", color: "gold", bold: true },
      { text: "/library list", color: "yellow", clickEvent: { action: "run_command", value: "/library list" } },
      { text: " - List all forum threads\n", color: "gray" },
      { text: "/library create <title> <category> <content>", color: "yellow" },
      { text: " - Create a new thread\n", color: "gray" },
      { text: "/library view <threadId>", color: "yellow" },
      { text: " - View a thread's content\n", color: "gray" },
      { text: "/library edit <threadId> <content>", color: "yellow" },
      { text: " - Edit your thread\n", color: "gray" },
      { text: "/library delete <threadId>", color: "yellow" },
      { text: " - Delete your thread\n", color: "gray" },
      { text: "/library buy <threadId>", color: "yellow" },
      { text: ` - Buy a thread copy (${this.THREAD_COST} XPL)\n`, color: "gray" },
      { text: "/library comment <threadId> <content>", color: "yellow" },
      { text: " - Comment on a thread\n", color: "gray" },
      { text: "\n", color: "white" },
      {
        text: "[Suggest Command]",
        color: "green",
        clickEvent: {
          action: "suggest_command",
          value: "/library "
        }
      }
    ]));

    return { messages };
  }

  @Command(['library', 'list'])
  @Description('List all forum threads')
  @Permission('player')
  async listThreads({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], threads?: Thread[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const threads: Thread[] = [];
      const iterator = kv.list<Thread>({ prefix: ['library', 'threads'] });
      for await (const entry of iterator) {
        threads.push(entry.value);
      }

      if (threads.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No threads found in the forum.",
          color: "yellow"
        }));
        return { messages };
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "=== Forum Threads ===",
        color: "gold",
        bold: true
      }));

      for (const thread of threads) {
        messages = await tellraw(sender, JSON.stringify([
          { text: `${thread.title}`, color: "yellow", clickEvent: {
              action: "run_command",
              value: `/library view ${thread.id}`
            }},
          { text: ` by ${thread.author}`, color: "gray" },
          { text: ` (${thread.copies} copies)`, color: "green" }
        ]));
      }

      return { messages, threads };
    } catch (error) {
      log(`Error listing threads: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'create'])
  @Description('Create a new forum thread')
  @Permission('player')
  @Argument([
    { name: 'title', type: 'string', description: 'Thread title' },
    { name: 'categoryId', type: 'string', description: 'Category ID' },
    { name: 'content', type: 'string', description: 'Thread content' }
  ])
  async createThread({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], thread?: Thread }> {
    const { sender, args } = params;
    let messages = [];

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
        copies: 0
      };

      await kv.atomic()
        .set(['library', 'threads', threadId], thread)
        .set(['library', 'thread_owners', threadId], [sender])
        .commit();

      messages = await tellraw(sender, JSON.stringify({
        text: `Thread "${args.title}" created successfully!`,
        color: "green"
      }));

      log(`Thread created: ${threadId} by ${sender}`);
      return { messages, thread };
    } catch (error) {
      log(`Error creating thread: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'view'])
  @Description('View a forum thread')
  @Permission('player')
  @Argument([
    { name: 'threadId', type: 'string', description: 'Thread ID to view' }
  ])
  async viewThread({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], thread?: Thread }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }

      messages = await tellraw(sender, JSON.stringify([
        { text: `=== ${thread.title} ===\n`, color: "gold", bold: true },
        { text: `By: ${thread.author}\n`, color: "yellow" },
        { text: `Created: ${new Date(thread.createdAt).toLocaleString()}\n`, color: "gray" },
        { text: `Updated: ${new Date(thread.updatedAt).toLocaleString()}\n\n`, color: "gray" },
        { text: thread.content, color: "white" },
        { text: "\n\n" },
        {
          text: "[Buy Copy]",
          color: "green",
          clickEvent: {
            action: "run_command",
            value: `/library buy ${thread.id}`
          }
        }
      ]));

      // Display comments
      const comments: Comment[] = [];
      const commentIterator = kv.list<Comment>({ prefix: ['library', 'comments', thread.id] });
      for await (const entry of commentIterator) {
        comments.push(entry.value);
      }

      if (comments.length > 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "\nComments:",
          color: "yellow",
          bold: true
        }));

        for (const comment of comments) {
          messages = await tellraw(sender, JSON.stringify([
            { text: `${comment.author}: `, color: "gray" },
            { text: comment.content, color: "white" }
          ]));
        }
      }

      return { messages, thread };
    } catch (error) {
      log(`Error viewing thread: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'edit'])
  @Description('Edit a forum thread')
  @Permission('player')
  @Argument([
    { name: 'threadId', type: 'string', description: 'Thread ID to edit' },
    { name: 'content', type: 'string', description: 'New thread content' }
  ])
  async editThread({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], thread?: Thread }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error('Thread not found');
      if (thread.author !== sender) throw new Error('Not authorized');

      const updatedThread = {
        ...thread,
        content: args.content,
        updatedAt: new Date().toISOString()
      };

      await kv.set(['library', 'threads', args.threadId], updatedThread);

      messages = await tellraw(sender, JSON.stringify({
        text: "Thread updated successfully!",
        color: "green"
      }));

      log(`Thread updated: ${args.threadId} by ${sender}`);
      return { messages, thread: updatedThread };
    } catch (error) {
      log(`Error updating thread: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'buy'])
  @Description('Buy a copy of a forum thread')
  @Permission('player')
  @Argument([
    { name: 'threadId', type: 'string', description: 'Thread ID to buy' }
  ])
  async buyThread({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], thread?: Thread }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error('Thread not found');

      const owners = await this.getThreadOwners(kv, args.threadId);
      if (owners.includes(sender)) throw new Error('You already own this thread');

      const balanceResult = await kv.get(['plugins', 'bank', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < this.THREAD_COST) {
        throw new Error(`Insufficient balance. Need ${this.THREAD_COST} XPL`);
      }

      const newBalance = balance - this.THREAD_COST;
      const updatedThread = {
        ...thread,
        copies: thread.copies + 1
      };

      await kv.atomic()
        .set(['plugins', 'bank', 'balances', sender], new Deno.KvU64(BigInt(newBalance)))
        .set(['library', 'thread_owners', args.threadId], [...owners, sender])
        .set(['library', 'threads', args.threadId], updatedThread)
        .commit();

      messages = await tellraw(sender, JSON.stringify([
        { text: "Thread purchased successfully!\n", color: "green" },
        { text: `New balance: ${newBalance} XPL`, color: "yellow" }
      ]));

      log(`Thread purchased: ${args.threadId} by ${sender}`);
      return { messages, thread: updatedThread };
    } catch (error) {
      log(`Error purchasing thread: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'delete'])
  @Description('Delete a forum thread')
  @Permission('player')
  @Argument([
    { name: 'threadId', type: 'string', description: 'Thread ID to delete' }
  ])
  async deleteThread({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error('Thread not found');
      if (thread.author !== sender) throw new Error('Not authorized');

      await kv.atomic()
        .delete(['library', 'threads', args.threadId])
        .delete(['library', 'thread_owners', args.threadId])
        .commit();

      const commentsIterator = kv.list({ prefix: ['library', 'comments', args.threadId] });
      for await (const entry of commentsIterator) {
        await kv.delete(entry.key);
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "Thread deleted successfully!",
        color: "green"
      }));

      log(`Thread deleted: ${args.threadId} by ${sender}`);
      return { messages };
    } catch (error) {
      log(`Error deleting thread: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'comment'])
  @Description('Comment on a forum thread')
  @Permission('player')
  @Argument([
    { name: 'threadId', type: 'string', description: 'Thread ID to comment on' },
    { name: 'content', type: 'string', description: 'Comment content' }
  ])
  async createComment({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], comment?: Comment }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const thread = await this.getThread(kv, args.threadId);
      if (!thread) throw new Error('Thread not found');

      const commentId = crypto.randomUUID();
      const comment: Comment = {
        id: commentId,
        threadId: args.threadId,
        author: sender,
        content: args.content,
        createdAt: new Date().toISOString()
      };

      await kv.set(['library', 'comments', args.threadId, commentId], comment);

      messages = await tellraw(sender, JSON.stringify({
        text: "Comment added successfully!",
        color: "green"
      }));

      // Notify thread author if different from commenter
      if (thread.author !== sender) {
        messages = await tellraw(thread.author, JSON.stringify([
          { text: "New comment on your thread ", color: "yellow" },
          { text: thread.title, color: "gold" },
          { text: ` by ${sender}`, color: "yellow" }
        ]));
      }

      log(`Comment created: ${commentId} by ${sender} on thread ${args.threadId}`);
      return { messages, comment };
    } catch (error) {
      log(`Error creating comment: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'deleteComment'])
  @Description('Delete a comment from a forum thread')
  @Permission('player')
  @Argument([
    { name: 'threadId', type: 'string', description: 'Thread ID containing the comment' },
    { name: 'commentId', type: 'string', description: 'Comment ID to delete' }
  ])
  async deleteComment({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    let messages = [];

    try {
      const comment = await kv.get<Comment>(['library', 'comments', args.threadId, args.commentId]);
      if (!comment.value) throw new Error('Comment not found');
      if (comment.value.author !== sender) throw new Error('Not authorized');

      await kv.delete(['library', 'comments', args.threadId, args.commentId]);

      messages = await tellraw(sender, JSON.stringify({
        text: "Comment deleted successfully!",
        color: "green"
      }));

      log(`Comment deleted: ${args.commentId} by ${sender}`);
      return { messages };
    } catch (error) {
      log(`Error deleting comment: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['library', 'categories'])
  @Description('List available forum categories')
  @Permission('player')
  async listCategories({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], categories?: Category[] }> {
    const { sender } = params;
    let messages = [];

    try {
      const categories: Category[] = [];
      const iterator = kv.list<Category>({ prefix: ['library', 'categories'] });
      for await (const entry of iterator) {
        categories.push(entry.value);
      }

      if (categories.length === 0) {
        messages = await tellraw(sender, JSON.stringify({
          text: "No categories found.",
          color: "yellow"
        }));
        return { messages, categories: [] };
      }

      messages = await tellraw(sender, JSON.stringify({
        text: "=== Forum Categories ===",
        color: "gold",
        bold: true
      }));

      for (const category of categories) {
        messages = await tellraw(sender, JSON.stringify({
          text: `- ${category.title}`,
          color: "yellow"
        }));
      }

      return { messages, categories };
    } catch (error) {
      log(`Error listing categories: ${error.message}`);
      messages = await tellraw(sender, JSON.stringify({
        text: `Error: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }
}
