import { relative } from "https://deno.land/std@0.177.0/path/mod.ts";
import type { ScriptManager } from "./ScriptManager.ts";
import type { Logger } from "./logger.ts";

// ModuleWatcher.ts
export class ModuleWatcher {
  private scriptManager: ScriptManager;
  private logger: Logger;
  private watchDir: string;

  constructor(scriptManager: ScriptManager, logger: Logger, watchDir: string) {
    this.scriptManager = scriptManager;
    this.logger = logger;
    this.watchDir = watchDir;
  }

  async watch() {
    try {
      const watcher = Deno.watchFs(this.watchDir);

      for await (const event of watcher) {
        if (event.kind === "modify") {
          for (const path of event.paths) {
            if (path.endsWith('.ts')) {
              // Wait for a small delay to ensure file write is complete
              await new Promise(resolve => setTimeout(resolve, 100));

              try {
                // Normalize the path for consistency
                const normalizedPath = path.replace(/\/+/g, '/');
                await this.scriptManager.loadModule(normalizedPath);
                this.logger.info(`Reloaded module: ${normalizedPath}`);
              } catch (error) {
                this.logger.error(`Failed to reload module ${path}: ${error}`);
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Watch error: ${error}`);
    }
  }
}
