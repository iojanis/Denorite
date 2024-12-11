import { Module, Command, Description, Permission, Argument } from '../decorators.ts';
import { ScriptContext } from '../types.ts';
import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import { dirname, basename, join, relative, normalize, isAbsolute } from "https://deno.land/std@0.177.0/path/mod.ts";

interface SenderState {
  cwd: string;
  lastAccessed: number;
}

@Module({
  name: 'FileSystem',
  version: '1.0.1',
  description: 'Unix-like file system commands'
})
export class FileSystem {
  private readonly BASE_DIR = Deno.cwd() + '/';

  private async getCurrentDir(kv: Deno.Kv, sender: string): Promise<string> {
    const state = await kv.get<SenderState>(['fs_state', sender]);
    if (!state.value) {
      const defaultState: SenderState = {
        cwd: '/',
        lastAccessed: Date.now()
      };
      await kv.set(['fs_state', sender], defaultState);
      return defaultState.cwd;
    }
    return state.value.cwd;
  }

  private async updateCurrentDir(kv: Deno.Kv, sender: string, newPath: string): Promise<void> {
    const state: SenderState = {
      cwd: newPath,
      lastAccessed: Date.now()
    };
    await kv.set(['fs_state', sender], state);
  }

  private resolvePath(currentDir: string, path: string): string {
    if (path.startsWith('/')) {
      return normalize(path);
    }
    return normalize(join(currentDir, path));
  }

  private getFullPath(virtualPath: string): string {
    return join(this.BASE_DIR, virtualPath.replace(/^\//, ''));
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
    const typeLetter = 'd';
    const userBits = this.formatModeBits((mode >> 6) & 7);
    const groupBits = this.formatModeBits((mode >> 3) & 7);
    const otherBits = this.formatModeBits(mode & 7);
    return `${typeLetter}${userBits}${groupBits}${otherBits}`;
  }

  private formatModeBits(bits: number): string {
    return [
      (bits & 4) ? 'r' : '-',
      (bits & 2) ? 'w' : '-',
      (bits & 1) ? 'x' : '-'
    ].join('');
  }

  private formatSize(size: number): string {
    return size.toString().padStart(8, ' ');
  }

  private formatDate(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate().toString().padStart(2)} ${date.getHours()}:${date.getMinutes()}`;
  }

  @Command(['cd'])
  @Description('Change current directory')
  @Permission('operator')
  @Argument([
    { name: 'path', type: 'string', description: 'Target directory path', optional: true }
  ])
  async cd({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const targetPath = args.path || '/';
    const currentDir = await this.getCurrentDir(kv, sender);
    const newPath = this.resolvePath(currentDir, targetPath);
    let messages = [];

    try {
      const fullPath = this.getFullPath(newPath);
      const isDir = await this.isDirectory(fullPath);

      if (!isDir) {
        throw new Error('Not a directory');
      }

      await this.updateCurrentDir(kv, sender, newPath);

      messages = await tellraw(sender, JSON.stringify({
        text: newPath,
        color: "green"
      }));

      log(`Changed directory to ${newPath}`);
      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `cd: ${targetPath}: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['ls'])
  @Description('List directory contents')
  @Permission('operator')
  @Argument([
    { name: 'path', type: 'string', description: 'Directory path', optional: true }
  ])
  async ls({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], entries?: any[] }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.path || '.');
    let messages = [];

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
          mode: 0o755
        });
      }

      entries.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });

      messages = await tellraw(sender, JSON.stringify({
        text: `total ${entries.length}`,
        color: "yellow"
      }));

      for (const entry of entries) {
        const permissions = entry.isDirectory ? 'drwxr-xr-x' : '-rw-r--r--';
        const size = this.formatSize(entry.size);
        const date = this.formatDate(entry.modified);
        const name = entry.name + (entry.isDirectory ? '/' : '');

        messages = await tellraw(sender, JSON.stringify({
          text: `${date} ${size} `,
          color: "gray",
          extra: [{
            text: name,
            color: entry.isDirectory ? "aqua" : "white"
          }]
        }));
      }

      log(`Listed directory ${targetPath}`);
      return { messages, entries };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `ls: ${args.path || '.'}: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['cat'])
  @Description('Display file contents')
  @Permission('operator')
  @Argument([
    { name: 'file', type: 'string', description: 'File path' }
  ])
  async cat({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], content?: string }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.file);
    let messages = [];

    try {
      const fullPath = this.getFullPath(targetPath);
      const content = await Deno.readTextFile(fullPath);

      messages = [{
        text: JSON.stringify(content),
        color: "white"
      }]

      log(`Displayed contents of ${targetPath}`);
      return { messages, content };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `cat: ${args.file}: ${error.message}`,
        color: "red"
      }));
      return { messages, error: error.message };
    }
  }

  @Command(['append'])
  @Description('Append text to file')
  @Permission('operator')
  @Argument([
    { name: 'file', type: 'string', description: 'File path' },
    { name: 'content', type: 'string', description: 'Text to append' }
  ])
  async append({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.file);
    let messages = [];

    try {
      const fullPath = this.getFullPath(targetPath);
      await Deno.writeTextFile(fullPath, args.content, { append: true });

      messages = await tellraw(sender, JSON.stringify({
        text: `Appended to ${targetPath}`,
        color: "green"
      }));

      log(`Appended to file ${targetPath}`);
      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `append: ${args.file}: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['mv'])
  @Description('Move/rename file or directory')
  @Permission('operator')
  @Argument([
    { name: 'source', type: 'string', description: 'Source path' },
    { name: 'destination', type: 'string', description: 'Destination path' }
  ])
  async mv({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const sourcePath = this.resolvePath(currentDir, args.source);
    const destPath = this.resolvePath(currentDir, args.destination);
    let messages = [];

    try {
      const fullSourcePath = this.getFullPath(sourcePath);
      const fullDestPath = this.getFullPath(destPath);

      await Deno.rename(fullSourcePath, fullDestPath);

      messages = await tellraw(sender, JSON.stringify({
        text: `Moved ${sourcePath} to ${destPath}`,
        color: "green"
      }));

      log(`Moved ${sourcePath} to ${destPath}`);
      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `mv: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['cp'])
  @Description('Copy file or directory')
  @Permission('operator')
  @Argument([
    { name: 'source', type: 'string', description: 'Source path' },
    { name: 'destination', type: 'string', description: 'Destination path' }
  ])
  async cp({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const sourcePath = this.resolvePath(currentDir, args.source);
    const destPath = this.resolvePath(currentDir, args.destination);
    let messages = [];

    try {
      const fullSourcePath = this.getFullPath(sourcePath);
      const fullDestPath = this.getFullPath(destPath);

      await Deno.copyFile(fullSourcePath, fullDestPath);

      messages = await tellraw(sender, JSON.stringify({
        text: `Copied ${sourcePath} to ${destPath}`,
        color: "green"
      }));

      log(`Copied ${sourcePath} to ${destPath}`);
      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `cp: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['rm'])
  @Description('Remove file or directory')
  @Permission('operator')
  @Argument([
    { name: 'path', type: 'string', description: 'Path to remove' }
  ])
  async rm({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    const targetPath = this.resolvePath(currentDir, args.path);
    let messages = [];

    try {
      const fullPath = this.getFullPath(targetPath);
      const isDir = await this.isDirectory(fullPath);

      await Deno.remove(fullPath, { recursive: true });

      messages = await tellraw(sender, JSON.stringify({
        text: `Removed ${isDir ? 'directory' : 'file'} ${targetPath}`,
        color: "green"
      }));

      log(`Removed ${targetPath}`);
      return { messages, success: true };
    } catch (error) {
      messages = await tellraw(sender, JSON.stringify({
        text: `rm: ${args.path}: ${error.message}`,
        color: "red"
      }));
      return { messages, success: false, error: error.message };
    }
  }

  @Command(['pwd'])
  @Description('Print working directory')
  @Permission('operator')
  async pwd({ params, tellraw, log, kv }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;
    const currentDir = await this.getCurrentDir(kv, sender);
    let messages = [];

    messages = await tellraw(sender, JSON.stringify({
      text: currentDir,
      color: "yellow"
    }));

    log(`Printed working directory: ${currentDir}`);
    return { messages };
  }
}
