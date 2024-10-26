import { Module, Command, Description, Permission, Socket, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

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
  name: 'Forum',
  version: '1.0.0',
  servers: 'all'
})
export class Forum {
  private readonly THREAD_COST = 3; // Cost in XPL to buy a thread

  private async getThread(kv: ScriptContext['kv'], threadId: string): Promise<Thread | null> {
    const result = await kv.get<Thread>(['forum', 'threads', threadId]);
    return result.value;
  }

  private async getThreadOwners(kv: ScriptContext['kv'], threadId: string): Promise<string[]> {
    const result = await kv.get<string[]>(['forum', 'thread_owners', threadId]);
    return result.value || [];
  }

  @Socket('create_thread')
  async handleCreateThread({ params, kv, log }: ScriptContext) {
    const { title, categoryId, content } = params;
    const author = params.sender;

    try {
      const threadId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      const thread: Thread = {
        id: threadId,
        title,
        content,
        author,
        categoryId,
        createdAt: timestamp,
        updatedAt: timestamp,
        copies: 0
      };

      await kv.atomic()
        .set(['forum', 'threads', threadId], thread)
        .set(['forum', 'thread_owners', threadId], [author])
        .commit();

      log(`Thread created: ${threadId} by ${author}`);
      return { success: true, thread };
    } catch (error) {
      log(`Error creating thread: ${error}`);
      throw error;
    }
  }

  @Socket('update_thread')
  async handleUpdateThread({ params, kv, log }: ScriptContext) {
    const { threadId, content } = params;
    const author = params.sender;

    try {
      const thread = await this.getThread(kv, threadId);
      if (!thread) throw new Error('Thread not found');
      if (thread.author !== author) throw new Error('Not authorized');

      const updatedThread = {
        ...thread,
        content,
        updatedAt: new Date().toISOString()
      };

      await kv.set(['forum', 'threads', threadId], updatedThread);
      log(`Thread updated: ${threadId} by ${author}`);
      return { success: true, thread: updatedThread };
    } catch (error) {
      log(`Error updating thread: ${error}`);
      throw error;
    }
  }

  @Socket('delete_thread')
  async handleDeleteThread({ params, kv, log }: ScriptContext) {
    const { threadId } = params;
    const author = params.sender;

    try {
      const thread = await this.getThread(kv, threadId);
      if (!thread) throw new Error('Thread not found');
      if (thread.author !== author) throw new Error('Not authorized');

      // Delete thread and its owners
      await kv.atomic()
        .delete(['forum', 'threads', threadId])
        .delete(['forum', 'thread_owners', threadId])
        .commit();

      // Delete all comments for this thread
      const commentsIterator = kv.list({ prefix: ['forum', 'comments', threadId] });
      for await (const entry of commentsIterator) {
        await kv.delete(entry.key);
      }

      log(`Thread deleted: ${threadId} by ${author}`);
      return { success: true };
    } catch (error) {
      log(`Error deleting thread: ${error}`);
      throw error;
    }
  }

  @Socket('buy_thread')
  async handleBuyThread({ params, kv, api, log }: ScriptContext) {
    const { threadId } = params;
    const buyer = params.sender;

    try {
      // Check if thread exists
      const thread = await this.getThread(kv, threadId);
      if (!thread) throw new Error('Thread not found');

      // Check if already owned
      const owners = await this.getThreadOwners(kv, threadId);
      if (owners.includes(buyer)) throw new Error('Already owned');

      // Check balance
      const balanceResult = await kv.get(['plugins', 'bank', 'balances', buyer]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;
      if (balance < this.THREAD_COST) throw new Error('Insufficient balance');

      // Process payment
      const newBalance = balance - this.THREAD_COST;
      await kv.atomic()
        .set(['plugins', 'bank', 'balances', buyer], new Deno.KvU64(BigInt(newBalance)))
        .set(['forum', 'thread_owners', threadId], [...owners, buyer])
        .commit();

      // Update thread copies count
      const updatedThread = {
        ...thread,
        copies: thread.copies + 1
      };
      await kv.set(['forum', 'threads', threadId], updatedThread);

      // Give the book to the player
      const bookNbt = JSON.stringify({
        title: thread.title,
        author: thread.author,
        pages: [JSON.stringify(thread.content)]
      });
      await api.give(buyer, `minecraft:written_book${bookNbt}`);

      log(`Thread purchased: ${threadId} by ${buyer}`);
      return { success: true, thread: updatedThread };
    } catch (error) {
      log(`Error purchasing thread: ${error}`);
      throw error;
    }
  }

  @Socket('create_comment')
  async handleCreateComment({ params, kv, log }: ScriptContext) {
    const { threadId, content } = params;
    const author = params.sender;

    try {
      const commentId = crypto.randomUUID();
      const comment: Comment = {
        id: commentId,
        threadId,
        author,
        content,
        createdAt: new Date().toISOString()
      };

      await kv.set(['forum', 'comments', threadId, commentId], comment);
      log(`Comment created: ${commentId} by ${author}`);
      return { success: true, comment };
    } catch (error) {
      log(`Error creating comment: ${error}`);
      throw error;
    }
  }

  @Socket('delete_comment')
  async handleDeleteComment({ params, kv, log }: ScriptContext) {
    const { commentId, threadId } = params;
    const author = params.sender;

    try {
      const comment = await kv.get<Comment>(['forum', 'comments', threadId, commentId]);
      if (!comment.value) throw new Error('Comment not found');
      if (comment.value.author !== author) throw new Error('Not authorized');

      await kv.delete(['forum', 'comments', threadId, commentId]);
      log(`Comment deleted: ${commentId} by ${author}`);
      return { success: true };
    } catch (error) {
      log(`Error deleting comment: ${error}`);
      throw error;
    }
  }

  @Socket('get_threads')
  async handleGetThreads({ kv, log }: ScriptContext) {
    try {
      const threads: Thread[] = [];
      const iterator = kv.list<Thread>({ prefix: ['forum', 'threads'] });
      for await (const entry of iterator) {
        threads.push(entry.value);
      }
      return { success: true, threads };
    } catch (error) {
      log(`Error fetching threads: ${error}`);
      throw error;
    }
  }

  @Socket('get_thread')
  async handleGetThread({ params, kv, log }: ScriptContext) {
    const { threadId } = params;
    try {
      const thread = await this.getThread(kv, threadId);
      if (!thread) throw new Error('Thread not found');
      return { success: true, thread };
    } catch (error) {
      log(`Error fetching thread: ${error}`);
      throw error;
    }
  }

  @Command(['forum', 'list'])
  @Description('List all forum threads')
  @Permission('player')
  async listThreads({ params, kv, api, log }: ScriptContext) {
    const { sender } = params;
    try {
      const threads = await this.handleGetThreads({ params, kv, api, log });
      if (!threads.threads?.length) {
        await api.tellraw(sender, JSON.stringify({
          text: "No threads found in the forum.",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: "Forum Threads:",
        color: "gold"
      }));

      for (const thread of threads.threads) {
        await api.tellraw(sender, JSON.stringify({
          text: `- "${thread.title}" by ${thread.author} (${thread.copies} copies)`,
          color: "white"
        }));
      }
    } catch (error) {
      log(`Error listing threads for ${sender}: ${error}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while listing threads.",
        color: "red"
      }));
    }
  }
}
