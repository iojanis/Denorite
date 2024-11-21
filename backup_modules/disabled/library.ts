import { Module, Command, Description, Permission, Socket, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';

interface Book {
  title: string;
  author: string;
  content: string;
  createdAt: string;
}

@Module({
  name: 'Library',
  version: '1.0.0',
  servers: 'all'
})
export class Library {

  private async getBooks(kv: ScriptContext['kv']): Promise<Book[]> {
    const books: Book[] = [];
    const iterator = kv.list<Book>({ prefix: ['library', 'books'] });
    for await (const entry of iterator) {
      books.push(entry.value);
    }
    return books;
  }

  private async getEntityData(api: ScriptContext['api'], target: string, path?: string): Promise<Record<string, unknown> | null> {
    const command = path
      ? `data get entity ${target} ${path}`
      : `data get entity ${target}`;

    const result = await api.executeCommand(command);
    console.log('Raw result:', result);

    const dataRegex = /following entity data: ({.+})$/;
    const match = result.match(dataRegex);

    if (match) {
      try {
        const nbtString = match[1];
        const parsed: Record<string, any> = {};

        // Extract id
        const idMatch = nbtString.match(/id: "([^"]+)"/);
        if (idMatch) parsed.id = idMatch[1];

        // Extract tag content
        const tagMatch = nbtString.match(/tag: ({.+})/);
        if (tagMatch) {
          const tagContent = tagMatch[1];

          // Extract title
          const titleMatch = tagContent.match(/title: "([^"]+)"/);
          if (titleMatch) parsed.title = titleMatch[1];

          // Extract author
          const authorMatch = tagContent.match(/author: "([^"]+)"/);
          if (authorMatch) parsed.author = authorMatch[1];

          // Extract pages
          const pagesMatch = tagContent.match(/pages: \[([^\]]+)\]/);
          if (pagesMatch) {
            parsed.pages = pagesMatch[1].split(', ').map(page =>
              page.replace(/^'|'$/g, '').replace(/^"|"$/g, '')
            );
          }
        }

        console.log('Parsed entity data:', JSON.stringify(parsed, null, 2));
        return parsed;
      } catch (error) {
        console.error('Failed to parse entity data:', error);
        return null;
      }
    }
    return null;
  }

  private async getHeldBook(api: ScriptContext['api'], player: string): Promise<Book | null> {
    try {
      const entityData = await this.getEntityData(api, player, 'SelectedItem');
      console.log('Parsed entity data:', JSON.stringify(entityData, null, 2));

      if (entityData && entityData.id === 'minecraft:written_book') {
        const book: Book = {
          title: entityData.title || 'Untitled',
          author: entityData.author || 'Unknown',
          content: Array.isArray(entityData.pages) ? entityData.pages.join('\n') : '',
          createdAt: new Date().toISOString()
        };

        console.log('Held book:', JSON.stringify(book, null, 2));
        return book;
      }
      return null;
    } catch (error) {
      console.error(`Error getting held book:`, error);
      return null;
    }
  }

  @Command(['library', 'upload'])
  @Description('Upload the book you are holding to the library')
  @Permission('player')
  @Socket()
  async uploadBook({ params, kv, api, log }: ScriptContext) {
    const { sender } = params;

    try {
      const heldBook = await this.getHeldBook(api, sender);
      console.log('Held book:', JSON.stringify(heldBook, null, 2)); // Add this line for debugging

      if (!heldBook) {
        await api.tellraw(sender, JSON.stringify({
          text: "You must be holding a written book to upload it to the library.",
          color: "red"
        }));
        return { success: false, error: "Not holding a written book" };
      }

      // Save the book to the library
      await kv.set(['library', 'books', heldBook.title], heldBook);

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully uploaded "${heldBook.title}" to the library.`,
        color: "green"
      }));
      log(`${sender} uploaded book "${heldBook.title}" to the library`);
      return { success: true, book: heldBook };
    } catch (error) {
      console.error(`Error uploading book for ${sender}:`, error);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while uploading the book.",
        color: "red"
      }));
      return { success: false, error: `${error}` };
    }
  }

  @Command(['library', 'list'])
  @Description('List all books available in the library')
  @Permission('player')
  @Socket()
  async listBooks({ params, kv, api, log }: ScriptContext) {
    const { sender } = params;

    try {
      const books = await this.getBooks(kv);

      if (books.length === 0) {
        await api.tellraw(sender, JSON.stringify({
          text: "The library is currently empty.",
          color: "yellow"
        }));
        return { success: true, books: [] };
      }

      await api.tellraw(sender, JSON.stringify({
        text: "Available books in the library:",
        color: "gold"
      }));

      for (const book of books) {
        await api.tellraw(sender, JSON.stringify({
          text: `- "${book.title}" by ${book.author}`,
          color: "white"
        }));
      }

      return { success: true, books };
    } catch (error) {
      log(`Error listing books for ${sender}: ${error}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while listing the books.",
        color: "red"
      }));
      return { success: false, error: `${error}` };
    }
  }

  @Command(['library', 'read'])
  @Description('Read a book from the library')
  @Permission('player')
  @Socket()
  @Argument([
    { name: 'title', type: 'string', description: 'The title of the book to read' }
  ])
  async readBook({ params, kv, api, log }: ScriptContext) {
    const { sender, args } = params;
    const title = args.title;

    try {
      const bookResult = await kv.get<Book>(['library', 'books', title]);
      if (!bookResult.value) {
        await api.tellraw(sender, JSON.stringify({
          text: `Book "${title}" not found in the library.`,
          color: "red"
        }));
        return { success: false, error: "Book not found" };
      }

      const book = bookResult.value;

      await api.tellraw(sender, JSON.stringify({
        text: `Reading "${book.title}" by ${book.author}:`,
        color: "gold"
      }));

      // Split content into pages (max 256 characters per page)
      const pages = book.content.match(/.{1,256}/g) || [];
      for (const page of pages) {
        await api.tellraw(sender, JSON.stringify({
          text: page,
          color: "white"
        }));
      }

      return { success: true, book };
    } catch (error) {
      log(`Error reading book "${title}" for ${sender}: ${error}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while reading the book.",
        color: "red"
      }));
      return { success: false, error: `${error}` };
    }
  }

  @Command(['library', 'download'])
  @Description('Download a book from the library to your inventory')
  @Permission('player')
  @Socket()
  @Argument([
    { name: 'title', type: 'string', description: 'The title of the book to download' }
  ])
  async downloadBook({ params, kv, api, log }: ScriptContext) {
    const { sender, args } = params;
    const title = args.title;

    try {
      const bookResult = await kv.get<Book>(['library', 'books', title]);
      if (!bookResult.value) {
        await api.tellraw(sender, JSON.stringify({
          text: `Book "${title}" not found in the library.`,
          color: "red"
        }));
        return { success: false, error: "Book not found" };
      }

      const book = bookResult.value;

      // Create a written book item
      const bookNbt = JSON.stringify({
        title: book.title,
        author: book.author,
        pages: [JSON.stringify(book.content)]
      });

      // Give the book to the player
      await api.give(sender, `minecraft:written_book${bookNbt}`);

      await api.tellraw(sender, JSON.stringify({
        text: `Successfully downloaded "${book.title}" to your inventory.`,
        color: "green"
      }));
      log(`${sender} downloaded book "${book.title}" from the library`);
      return { success: true, book };
    } catch (error) {
      log(`Error downloading book "${title}" for ${sender}: ${error}`);
      await api.tellraw(sender, JSON.stringify({
        text: "An error occurred while downloading the book.",
        color: "red"
      }));
      return { success: false, error: `${error}` };
    }
  }
}
