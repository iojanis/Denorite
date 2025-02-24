import {
  Argument,
  Command,
  Description,
  Module,
  Permission,
  Socket,
} from "../decorators.ts";
import { ScriptContext } from "../types.ts";
import { ensureDir, ensureFile } from "https://deno.land/std/fs/mod.ts";
import { extname, join } from "https://deno.land/std/path/mod.ts";

interface EnchantmentModule {
  title: string;
  author: string;
  content: string;
  createdAt: string;
}

export async function getEntityData(
  api: ScriptContext["api"],
  target: string,
  path?: string,
): Promise<Record<string, unknown> | null> {
  const command = path
    ? `data get entity ${target} ${path}`
    : `data get entity ${target}`;

  const result = await api.executeCommand(command);
  console.log("Raw result:", result);

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
          parsed.pages = pagesMatch[1].split(", ").map((page) =>
            page.replace(/^'|'$/g, "").replace(/^"|"$/g, "")
          );
        }
      }

      console.log("Parsed entity data:", JSON.stringify(parsed, null, 2));
      return parsed;
    } catch (error) {
      console.error("Failed to parse entity data:", error);
      return null;
    }
  }
  return null;
}

@Module({
  name: "EnchantmentModuleManager",
  version: "1.0.0",
  servers: "all",
})
export class EnchantmentModuleManager {
  private readonly ENCHANTMENTS_DIR = Deno.cwd() + "/enchantments";

  private async getEnchantmentModules(): Promise<EnchantmentModule[]> {
    const modules: EnchantmentModule[] = [];
    for await (const entry of Deno.readDir(this.ENCHANTMENTS_DIR)) {
      if (entry.isFile && extname(entry.name) === ".ts") {
        const content = await Deno.readTextFile(
          join(this.ENCHANTMENTS_DIR, entry.name),
        );
        const title = entry.name.replace(".ts", "");
        modules.push({
          title,
          author: "Unknown", // We can't reliably get the author from the file
          content,
          createdAt:
            (await Deno.stat(join(this.ENCHANTMENTS_DIR, entry.name))).birthtime
              ?.toISOString() || new Date().toISOString(),
        });
      }
    }
    return modules;
  }

  private async getHeldBook(
    api: ScriptContext["api"],
    player: string,
  ): Promise<EnchantmentModule | null> {
    try {
      const entityData = await this.getEntityData(api, player, "SelectedItem");
      console.log("Parsed entity data:", JSON.stringify(entityData, null, 2));

      if (entityData && entityData.id === "minecraft:writable_book") {
        const module: EnchantmentModule = {
          title: entityData.title || "Untitled",
          author: entityData.author || "Unknown",
          content: Array.isArray(entityData.pages)
            ? entityData.pages.join(" ")
            : "",
          createdAt: new Date().toISOString(),
        };

        console.log("Held book:", JSON.stringify(module, null, 2));
        return module;
      }
      return null;
    } catch (error) {
      console.error(`Error getting held book:`, error);
      return null;
    }
  }

  @Command(["enchantments", "upload"])
  @Description(
    "Upload the writable book you are holding as an enchantment module",
  )
  @Permission("player")
  @Socket()
  async uploadEnchantmentModule({ params, api, log }: ScriptContext) {
    const { sender } = params;

    try {
      const heldBook = await this.getHeldBook(api, sender);
      console.log("Held book:", JSON.stringify(heldBook, null, 2));

      if (!heldBook) {
        await api.tellraw(
          sender,
          JSON.stringify({
            text:
              "You must be holding a writable book to upload it as an enchantment module.",
            color: "red",
          }),
        );
        return { success: false, error: "Not holding a writable book" };
      }

      // Save the enchantment module as a TypeScript file
      await ensureDir(this.ENCHANTMENTS_DIR);
      const filePath = join(this.ENCHANTMENTS_DIR, `${heldBook.title}.ts`);
      await ensureFile(filePath);
      await Deno.writeTextFile(filePath, heldBook.content);

      await api.tellraw(
        sender,
        JSON.stringify({
          text:
            `Successfully uploaded "${heldBook.title}" as an enchantment module.`,
          color: "green",
        }),
      );
      log(`${sender} uploaded enchantment module "${heldBook.title}"`);
      return { success: true, module: heldBook };
    } catch (error) {
      console.error(`Error uploading enchantment module for ${sender}:`, error);
      await api.tellraw(
        sender,
        JSON.stringify({
          text: "An error occurred while uploading the enchantment module.",
          color: "red",
        }),
      );
      return { success: false, error: `${error}` };
    }
  }

  @Command(["enchantments", "list"])
  @Description("List all available enchantment modules")
  @Permission("player")
  @Socket()
  async listEnchantmentModules({ params, api, log }: ScriptContext) {
    const { sender } = params;

    try {
      const modules = await this.getEnchantmentModules();

      if (modules.length === 0) {
        await api.tellraw(
          sender,
          JSON.stringify({
            text: "There are no enchantment modules available.",
            color: "yellow",
          }),
        );
        return { success: true, modules: [] };
      }

      await api.tellraw(
        sender,
        JSON.stringify({
          text: "Available enchantment modules:",
          color: "gold",
        }),
      );

      for (const module of modules) {
        await api.tellraw(
          sender,
          JSON.stringify({
            text: `- "${module.title}"`,
            color: "white",
          }),
        );
      }

      return { success: true, modules };
    } catch (error) {
      log(`Error listing enchantment modules for ${sender}: ${error}`);
      await api.tellraw(
        sender,
        JSON.stringify({
          text: "An error occurred while listing the enchantment modules.",
          color: "red",
        }),
      );
      return { success: false, error: `${error}` };
    }
  }

  @Command(["enchantments", "read"])
  @Description("Read an enchantment module")
  @Permission("player")
  @Socket()
  @Argument([
    {
      name: "title",
      type: "string",
      description: "The title of the enchantment module to read",
    },
  ])
  async readEnchantmentModule({ params, api, log }: ScriptContext) {
    const { sender, args } = params;
    const title = args.title;

    try {
      const filePath = join(this.ENCHANTMENTS_DIR, `${title}.ts`);
      const content = await Deno.readTextFile(filePath);

      await api.tellraw(
        sender,
        JSON.stringify({
          text: `Reading enchantment module "${title}":`,
          color: "gold",
        }),
      );

      // Split content into pages (max 256 characters per page)
      const pages = content.match(/.{1,256}/g) || [];
      for (const page of pages) {
        await api.tellraw(
          sender,
          JSON.stringify({
            text: page,
            color: "white",
          }),
        );
      }

      return { success: true, module: { title, content } };
    } catch (error) {
      log(
        `Error reading enchantment module "${title}" for ${sender}: ${error}`,
      );
      await api.tellraw(
        sender,
        JSON.stringify({
          text: "An error occurred while reading the enchantment module.",
          color: "red",
        }),
      );
      return { success: false, error: `${error}` };
    }
  }

  @Command(["enchantments", "download"])
  @Description(
    "Download an enchantment module to your inventory as a written book",
  )
  @Permission("player")
  @Socket()
  @Argument([
    {
      name: "title",
      type: "string",
      description: "The title of the enchantment module to download",
    },
  ])
  async downloadEnchantmentModule({ params, api, log }: ScriptContext) {
    const { sender, args } = params;
    const title = args.title;

    try {
      const filePath = join(this.ENCHANTMENTS_DIR, `${title}.ts`);
      const content = await Deno.readTextFile(filePath);

      // Create a written book item
      const bookNbt = JSON.stringify({
        title: title,
        author: "EnchantmentModuleManager",
        pages: [JSON.stringify(content)],
      });

      // Give the book to the player
      await api.give(sender, `minecraft:written_book${bookNbt}`);

      await api.tellraw(
        sender,
        JSON.stringify({
          text:
            `Successfully downloaded "${title}" to your inventory as a written book.`,
          color: "green",
        }),
      );
      log(`${sender} downloaded enchantment module "${title}"`);
      return { success: true, module: { title, content } };
    } catch (error) {
      log(
        `Error downloading enchantment module "${title}" for ${sender}: ${error}`,
      );
      await api.tellraw(
        sender,
        JSON.stringify({
          text: "An error occurred while downloading the enchantment module.",
          color: "red",
        }),
      );
      return { success: false, error: `${error}` };
    }
  }
}
