import { Module, Command, Description, Permission, Socket } from '../decorators.ts';
import { ScriptContext } from '../types.ts';
import { walk } from "https://deno.land/std@0.177.0/fs/mod.ts";
import { dirname, basename, join } from "https://deno.land/std@0.177.0/path/mod.ts";

@Module({
  name: 'FileManager',
  version: '1.0.0'
})
export class FileManager {
  private readonly ENCHANTMENTS_DIR = Deno.cwd() + '/enchantments';

  private async isDirectory(path: string): Promise<boolean> {
    try {
      const stat = await Deno.stat(path);
      return stat.isDirectory;
    } catch {
      return false;
    }
  }

  @Command(['files', 'list'])
  @Description('List all enchantment files and their status')
  @Permission('operator')
  @Socket('files_list')
  async listFiles({ api, params, log }: ScriptContext): Promise<void> {
    const { sender } = params;
    try {
      let fileList = '';

      for await (const entry of walk(this.ENCHANTMENTS_DIR, { includeDirs: false })) {
        const relativePath = entry.path.replace(this.ENCHANTMENTS_DIR + '/', '');
        const status = basename(entry.path).startsWith('_') ? '❌' : '✅';
        fileList += `\n${status} ${relativePath}`;
      }

      if (!fileList) {
        await api.tellraw(sender, JSON.stringify({
          text: "No enchantment files found.",
          color: "yellow"
        }));
        return;
      }

      await api.tellraw(sender, JSON.stringify({
        text: `Enchantment files (✅ enabled, ❌ disabled):${fileList}`,
        color: "green"
      }));
      log(`Listed files for ${sender}`);
    } catch (error) {
      log(`Error listing files: ${error.message}`);
      await api.tellraw(sender, JSON.stringify({
        text: `Error listing files: ${error.message}`,
        color: "red"
      }));
    }
  }

  @Socket('read_directory')
  @Permission('operator')
  async handleReadDirectory({ params, log }: ScriptContext): Promise<{ files: { path: string, isDirectory: boolean }[] }> {
    try {
      const path = params.path as string || '';
      const fullPath = join(this.ENCHANTMENTS_DIR, path);
      const files = [];

      for await (const entry of walk(fullPath, { maxDepth: 1 })) {
        if (entry.path === fullPath) continue;
        const relativePath = entry.path.replace(this.ENCHANTMENTS_DIR + '/', '');
        const isDirectory = await this.isDirectory(entry.path);
        files.push({
          path: relativePath,
          isDirectory
        });
      }

      log(`Read directory: ${path}`);
      return { files };
    } catch (error) {
      log(`Error reading directory: ${error.message}`);
      throw error;
    }
  }

  @Socket('read_file')
  @Permission('operator')
  async handleReadFile({ params, log }: ScriptContext): Promise<{ content: string }> {
    try {
      const path = params.path as string;
      const fullPath = join(this.ENCHANTMENTS_DIR, path);
      const content = await Deno.readTextFile(fullPath);
      log(`Read file: ${path}`);
      return { content };
    } catch (error) {
      log(`Error reading file: ${error.message}`);
      throw error;
    }
  }

  @Socket('write_file')
  @Permission('operator')
  async handleWriteFile({ params, log }: ScriptContext): Promise<void> {
    try {
      const { path, content } = params;
      const fullPath = join(this.ENCHANTMENTS_DIR, path as string);
      await Deno.writeTextFile(fullPath, content as string);
      log(`Wrote to file: ${path}`);
    } catch (error) {
      log(`Error writing file: ${error.message}`);
      throw error;
    }
  }

  @Socket('rename_file')
  @Permission('operator')
  async handleRenameFile({ params, log }: ScriptContext): Promise<void> {
    try {
      const { oldPath, newPath } = params;
      const fullOldPath = join(this.ENCHANTMENTS_DIR, oldPath as string);
      const fullNewPath = join(this.ENCHANTMENTS_DIR, newPath as string);

      // Check if source exists
      await Deno.stat(fullOldPath);

      // Create parent directory if it doesn't exist
      const parentDir = dirname(fullNewPath);
      try {
        await Deno.mkdir(parentDir, { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw error;
        }
      }

      await Deno.rename(fullOldPath, fullNewPath);
      log(`Renamed file from ${oldPath} to ${newPath}`);
    } catch (error) {
      log(`Error renaming file: ${error.message}`);
      throw error;
    }
  }

  @Socket('delete_file')
  @Permission('operator')
  async handleDeleteFile({ params, log }: ScriptContext): Promise<void> {
    try {
      const path = params.path as string;
      const fullPath = join(this.ENCHANTMENTS_DIR, path);
      const isDirectory = await this.isDirectory(fullPath);

      if (isDirectory) {
        await Deno.remove(fullPath, { recursive: true });
        log(`Deleted directory: ${path}`);
      } else {
        await Deno.remove(fullPath);
        log(`Deleted file: ${path}`);
      }
    } catch (error) {
      log(`Error deleting file/directory: ${error.message}`);
      throw error;
    }
  }

  @Socket('enable_file')
  @Permission('operator')
  async handleEnableFile({ params, log }: ScriptContext): Promise<void> {
    try {
      const path = params.path as string;
      const fullPath = join(this.ENCHANTMENTS_DIR, path);
      const isDirectory = await this.isDirectory(fullPath);

      if (isDirectory) {
        for await (const entry of walk(fullPath, { includeDirs: false })) {
          const fileName = basename(entry.path);
          if (fileName.endsWith('_')) {
            const newPath = join(dirname(entry.path), fileName.slice(0, -1));
            await Deno.rename(entry.path, newPath);
          }
        }
      } else {
        const fileName = basename(fullPath);
        if (fileName.endsWith('_')) {
          const newPath = join(dirname(fullPath), fileName.slice(0, -1));
          await Deno.rename(fullPath, newPath);
        }
      }
      log(`Enabled ${isDirectory ? 'directory' : 'file'}: ${path}`);
    } catch (error) {
      log(`Error enabling file/directory: ${error.message}`);
      throw error;
    }
  }

  @Socket('disable_file')
  @Permission('operator')
  async handleDisableFile({ params, log }: ScriptContext): Promise<void> {
    try {
      const path = params.path as string;
      const fullPath = join(this.ENCHANTMENTS_DIR, path);
      const isDirectory = await this.isDirectory(fullPath);

      if (isDirectory) {
        for await (const entry of walk(fullPath, { includeDirs: false })) {
          const fileName = basename(entry.path);
          if (!fileName.endsWith('_')) {
            const newPath = join(dirname(entry.path), `${fileName}_`);
            await Deno.rename(entry.path, newPath);
          }
        }
      } else {
        const fileName = basename(fullPath);
        if (!fileName.endsWith('_')) {
          const newPath = join(dirname(fullPath), `${fileName}_`);
          await Deno.rename(fullPath, newPath);
        }
      }
      log(`Disabled ${isDirectory ? 'directory' : 'file'}: ${path}`);
    } catch (error) {
      log(`Error disabling file/directory: ${error.message}`);
      throw error;
    }
  }
}
