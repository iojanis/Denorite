import { relative } from "https://deno.land/std@0.177.0/path/mod.ts";

export class ModuleWatcher {
  private scriptManager: any;
  private logger: any;
  private modulesPath: string;
  private lastReload: { [key: string]: number } = {};

  constructor(scriptManager: any, logger: any, modulesPath: string) {
    this.scriptManager = scriptManager;
    this.logger = logger;
    this.modulesPath = modulesPath;
  }

  watch() {
    try {
      const watcher = Deno.watchFs(this.modulesPath);
      this.logger.info(`Started watching for changes in: ${this.modulesPath}`);

      (async () => {
        for await (const event of watcher) {
          if (event.kind === "modify") {
            const path = event.paths[0];
            if (path.endsWith('.ts')) {
              const relativePath = relative(Deno.cwd(), path);
              const now = Date.now();

              // Only reload if more than 100ms has passed since last reload
              if (!this.lastReload[relativePath] || (now - this.lastReload[relativePath]) > 100) {
                this.lastReload[relativePath] = now;
                await this.scriptManager.loadModule(relativePath);
              }
            }
          }
        }
      })();
    } catch (error) {
      this.logger.error(`Watch error: ${error}`);
    }
  }
}
