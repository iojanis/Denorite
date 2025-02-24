import {
  Argument,
  Command,
  Description,
  Module,
  Permission,
} from "../decorators.ts";
import { ScriptContext } from "../types.ts";
import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from "https://deno.land/std@0.177.0/path/mod.ts";
import { alert, button, container, divider, text } from "../tellraw-ui.ts";

interface SenderState {
  cwd: string;
  lastAccessed: number;
}

@Module({
  name: "Files",
  version: "1.0.6",
  description: "Unix-like file system commands with interactive UI",
})
export class FileSystem {
  private readonly BASE_DIR = Deno.cwd() + "/";

  private async getCurrentDir(kv: Deno.Kv, sender: string): Promise<string> {
    const state = await kv.get<SenderState>(["fs_state", sender]);
    if (!state.value) {
      const defaultState: SenderState = {
        cwd: "/",
        lastAccessed: Date.now(),
      };
      await kv.set(["fs_state", sender], defaultState);
      return defaultState.cwd;
    }
    return state.value.cwd;
  }

  private async updateCurrentDir(
    kv: Deno.Kv,
    sender: string,
    newPath: string,
  ): Promise<void> {
    const state: SenderState = {
      cwd: newPath,
      lastAccessed: Date.now(),
    };
    await kv.set(["fs_state", sender], state);
  }

  private resolvePath(currentDir: string, path: string): string {
    if (path.startsWith("/")) {
      return normalize(path);
    }
    return normalize(join(currentDir, path));
  }

  private getFullPath(virtualPath: string): string {
    return join(this.BASE_DIR, virtualPath.replace(/^\//, ""));
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      const stat = await Deno.stat(path);
      return stat.isDirectory;
    } catch {
      return false;
    }
  }

  private formatPermissions(mode: number): string {
    const typeLetter = "d";
    const userBits = this.formatModeBits((mode >> 6) & 7);
    const groupBits = this.formatModeBits((mode >> 3) & 7);
    const otherBits = this.formatModeBits(mode & 7);
    return `${typeLetter}${userBits}${groupBits}${otherBits}`;
  }

  private formatModeBits(bits: number): string {
    return [
      (bits & 4) ? "r" : "-",
      (bits & 2) ? "w" : "-",
      (bits & 1) ? "x" : "-",
    ].join("");
  }

  private formatSize(size: number): string {
    return size.toString().padStart(8, " ");
  }

  private formatDate(date: Date): string {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[date.getMonth()]} ${
      date.getDate().toString().padStart(2)
    } ${date.getHours()}:${date.getMinutes()}`;
  }

  @Command(["cd"])
  @Description("Change current directory")
  @Permission("operator")
  @Argument([
    {
      name: "path",
      type: "string",
      description: "Target directory path",
      optional: true,
    },
  ])
  async cd(
    context: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { params, tellraw, log, kv } = context;
    const { sender, args } = params;
    const targetPath = args.path || "/";
    const currentDir = await this.getCurrentDir(kv, sender);
    const newPath = this.resolvePath(currentDir, targetPath);

    try {
      const fullPath = this.getFullPath(newPath);
      const isDir = await this.isDirectory(fullPath);

      if (!isDir) {
        throw new Error("Not a directory");
      }

      await this.updateCurrentDir(kv, sender, newPath);

      const dirInfo = container([
        text("📂 Current Directory\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(newPath + "\n", {
          style: { color: "green" },
        }),
        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("List Contents", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/ls",
          },
        }),
        text(" "),
        button("Parent Directory", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: `/cd "${dirname(newPath)}"`,
          },
        }),
      ]);

      const messages = await tellraw(sender, dirInfo.render());

      // Automatically list directory contents
      await this.ls(context);

      log(`Changed directory to ${newPath}`);
      return { messages, success: true };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Directory Change Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["ls"])
  @Description("List directory contents")
  @Permission("operator")
  @Argument([
    {
      name: "path",
      type: "string",
      description: "Directory path",
      optional: true,
    },
  ])
  async ls(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; entries?: any[] }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.path || ".");

    try {
      const fullPath = this.getFullPath(targetPath);
      const entries = [];

      for await (const entry of walk(fullPath, { maxDepth: 1 })) {
        if (entry.path === fullPath) continue;

        const stat = await Deno.stat(entry.path);
        const relativePath = relative(fullPath, entry.path);

        entries.push({
          name: relativePath,
          isDirectory: stat.isDirectory,
          size: stat.size,
          modified: stat.mtime || new Date(),
          mode: 0o755,
        });
      }

      entries.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });

      const fileList = container([
        text("📂 Directory Contents\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(targetPath + "\n", {
          style: { color: "green" },
        }),
        text(`Total: ${entries.length} items\n`, {
          style: { color: "gray" },
        }),
        divider(),

        // Parent directory option if not at root
        ...(targetPath !== "/"
          ? [
            button("📁 ..", {
              variant: "ghost",
              onClick: {
                action: "run_command",
                value: `/cd "${dirname(targetPath)}"`,
              },
            }),
            text("\n"),
          ]
          : []),

        // List all entries with appropriate icons and actions
        ...entries.flatMap((entry) => [
          text(this.formatDate(entry.modified) + " ", {
            style: { color: "gray" },
          }),
          text(this.formatSize(entry.size) + " ", {
            style: { color: "gray" },
          }),
          button(
            `${entry.isDirectory ? "📁" : "📄"} ${entry.name}${
              entry.isDirectory ? "/" : ""
            }`,
            {
              variant: "ghost",
              onClick: {
                action: "run_command",
                value: entry.isDirectory
                  ? `/cd "${join(targetPath, entry.name)}"`
                  : `/cat "${join(targetPath, entry.name)}"`,
              },
            },
          ),
          text(" "),
          button("✂️", {
            variant: "ghost",
            onClick: {
              action: "suggest_command",
              value: `/mv "${join(targetPath, entry.name)}" `,
            },
          }),
          text(" "),
          button("🗑️", {
            variant: "destructive",
            onClick: {
              action: "run_command",
              value: `/rm "${join(targetPath, entry.name)}"`,
            },
          }),
          text("\n"),
        ]),

        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("Parent Directory", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/cd "${dirname(targetPath)}"`,
          },
        }),
        text(" "),
        button("Print Location", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: "/pwd",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        fileList.render(),
      );

      log(`Listed directory ${targetPath}`);
      return { messages, entries };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Directory Listing Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["cat"])
  @Description("Display file contents")
  @Permission("operator")
  @Argument([
    { name: "file", type: "string", description: "File path" },
  ])
  async cat(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; content?: string }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.file);

    try {
      const fullPath = this.getFullPath(targetPath);
      const content = await Deno.readTextFile(fullPath);

      const fileView = container([
        text("📄 File Contents\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text(targetPath + "\n", {
          style: { color: "green" },
        }),
        divider(),
        text(content + "\n", {
          style: { color: "white" },
        }),
        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("Back to Directory", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/ls",
          },
        }),
        text(" "),
        button("Edit File", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: `/append "${targetPath}" `,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        fileView.render(),
      );

      log(`Displayed contents of ${targetPath}`);
      return { messages, content };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "File Read Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, error: error.message };
    }
  }

  @Command(["append"])
  @Description("Append text to file")
  @Permission("operator")
  @Argument([
    { name: "file", type: "string", description: "File path" },
    { name: "content", type: "string", description: "Text to append" },
  ])
  async append(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.file);

    try {
      const fullPath = this.getFullPath(targetPath);
      await Deno.writeTextFile(fullPath, args.content, { append: true });

      const successMsg = container([
        text("✅ File Updated\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Path: ", { style: { color: "gray" } }),
        text(targetPath + "\n", { style: { color: "green" } }),
        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("View Contents", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/cat "${targetPath}"`,
          },
        }),
        text(" "),
        button("Append More", {
          variant: "ghost",
          onClick: {
            action: "suggest_command",
            value: `/append "${targetPath}" `,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render(),
      );

      log(`Appended to file ${targetPath}`);
      return { messages, success: true };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "File Append Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["mv"])
  @Description("Move/rename file or directory")
  @Permission("operator")
  @Argument([
    { name: "source", type: "string", description: "Source path" },
    { name: "destination", type: "string", description: "Destination path" },
  ])
  async mv(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const sourcePath = this.resolvePath(currentDir, args.source);
    const destPath = this.resolvePath(currentDir, args.destination);

    try {
      const fullSourcePath = this.getFullPath(sourcePath);
      const fullDestPath = this.getFullPath(destPath);

      await Deno.rename(fullSourcePath, fullDestPath);

      const successMsg = container([
        text("✅ File Moved Successfully\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("From: ", { style: { color: "gray" } }),
        text(sourcePath + "\n", { style: { color: "yellow" } }),
        text("To: ", { style: { color: "gray" } }),
        text(destPath + "\n", { style: { color: "green" } }),
        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("View Destination", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/ls "${dirname(destPath)}"`,
          },
        }),
        text(" "),
        button("View Source Dir", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: `/ls "${dirname(sourcePath)}"`,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render(),
      );

      log(`Moved ${sourcePath} to ${destPath}`);
      return { messages, success: true };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Move Operation Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["cp"])
  @Description("Copy file or directory")
  @Permission("operator")
  @Argument([
    { name: "source", type: "string", description: "Source path" },
    { name: "destination", type: "string", description: "Destination path" },
  ])
  async cp(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const sourcePath = this.resolvePath(currentDir, args.source);
    const destPath = this.resolvePath(currentDir, args.destination);

    try {
      const fullSourcePath = this.getFullPath(sourcePath);
      const fullDestPath = this.getFullPath(destPath);

      await Deno.copyFile(fullSourcePath, fullDestPath);

      const successMsg = container([
        text("✅ File Copied Successfully\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Source: ", { style: { color: "gray" } }),
        text(sourcePath + "\n", { style: { color: "yellow" } }),
        text("Destination: ", { style: { color: "gray" } }),
        text(destPath + "\n", { style: { color: "green" } }),
        divider(),
        text("Quick Actions:\n", { style: { color: "yellow" } }),
        button("View File", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/cat "${destPath}"`,
          },
        }),
        text(" "),
        button("List Directory", {
          variant: "ghost",
          onClick: {
            action: "run_command",
            value: `/ls "${dirname(destPath)}"`,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render(),
      );

      log(`Copied ${sourcePath} to ${destPath}`);
      return { messages, success: true };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Copy Operation Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["rm"])
  @Description("Remove file or directory")
  @Permission("operator")
  @Argument([
    { name: "path", type: "string", description: "Path to remove" },
  ])
  async rm(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.path);

    try {
      const fullPath = this.getFullPath(targetPath);
      const isDir = await this.isDirectory(fullPath);

      // Confirmation message
      const confirmMsg = container([
        text("⚠️ Confirm Deletion\n", {
          style: { color: "gold", styles: ["bold"] },
        }),
        text("Are you sure you want to delete this ", {
          style: { color: "gray" },
        }),
        text(isDir ? "directory" : "file", { style: { color: "yellow" } }),
        text("?\n", { style: { color: "gray" } }),
        text("Path: ", { style: { color: "gray" } }),
        text(targetPath + "\n", { style: { color: "red" } }),
        divider(),
        button("Yes, Delete", {
          variant: "destructive",
          onClick: {
            action: "run_command",
            value: `/rm_confirm "${targetPath}"`,
          },
        }),
        text(" "),
        button("Cancel", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: "/ls",
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        confirmMsg.render(),
      );

      return { messages, success: true };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Remove Operation Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["rm_confirm"])
  @Description("Confirm and execute remove operation")
  @Permission("operator")
  @Argument([
    { name: "path", type: "string", description: "Path to remove" },
  ])
  async rmConfirm(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[]; success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.path);

    try {
      const fullPath = this.getFullPath(targetPath);
      const isDir = await this.isDirectory(fullPath);

      await Deno.remove(fullPath, { recursive: true });

      const successMsg = container([
        text("✅ Deleted Successfully\n", {
          style: { color: "green", styles: ["bold"] },
        }),
        text("Removed ", { style: { color: "gray" } }),
        text(isDir ? "directory" : "file", { style: { color: "yellow" } }),
        text(": ", { style: { color: "gray" } }),
        text(targetPath + "\n", { style: { color: "red" } }),
        divider(),
        button("View Directory", {
          variant: "outline",
          onClick: {
            action: "run_command",
            value: `/ls "${dirname(targetPath)}"`,
          },
        }),
      ]);

      const messages = await tellraw(
        sender,
        successMsg.render(),
      );

      log(`Removed ${targetPath}`);
      return { messages, success: true };
    } catch (error) {
      const errorMsg = alert([], {
        variant: "destructive",
        title: "Remove Operation Failed",
        description: error.message,
      });

      const messages = await tellraw(
        sender,
        errorMsg.render(),
      );
      return { messages, success: false, error: error.message };
    }
  }

  @Command(["pwd"])
  @Description("Print working directory")
  @Permission("operator")
  async pwd(
    { params, tellraw, log, kv }: ScriptContext,
  ): Promise<{ messages: any[] }> {
    const { sender } = params;
    const currentDir = await this.getCurrentDir(kv, sender);

    const dirInfo = container([
      text("📂 Current Working Directory\n", {
        style: { color: "gold", styles: ["bold"] },
      }),
      text(currentDir + "\n", {
        style: { color: "green" },
      }),
      divider(),
      text("Quick Actions:\n", { style: { color: "yellow" } }),
      button("List Contents", {
        variant: "outline",
        onClick: {
          action: "run_command",
          value: "/ls",
        },
      }),
      text(" "),
      button("Parent Directory", {
        variant: "ghost",
        onClick: {
          action: "run_command",
          value: `/cd "${dirname(currentDir)}"`,
        },
      }),
    ]);

    const messages = await tellraw(
      sender,
      dirInfo.render(),
    );

    log(`Printed working directory: ${currentDir}`);
    return { messages };
  }
}
