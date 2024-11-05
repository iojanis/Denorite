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
              await new Promise(resolve => setTimeout(resolve, 100));

              try {
                // Remove /app/ prefix if present and clean the path
                const cleanPath = path.replace(/^\/app\//, '');
                await this.scriptManager.loadModule(cleanPath);
                this.logger.info(`Reloaded module: ${cleanPath}`);
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
