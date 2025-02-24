import { relative } from "https://deno.land/std@0.177.0/path/mod.ts";
import { encodeHex } from "jsr:@std/encoding/hex";
import type { ScriptManager } from "./ScriptManager.ts";
import type { Logger } from "./logger.ts";
import { ModuleDocumentGenerator } from "./ModuleDocumentGenerator.ts";

interface AppMetadata {
  title: string;
  name: string;
  icon: string;
  description: string;
  version: string;
  permission: string;
  singleWindow: boolean;
  height: number;
  width: number;
  isClosable: boolean;
}

interface AppRegistration extends AppMetadata {
  checksum: string;
  updatedAt: number;
  path: string;
}

export class ModuleWatcher {
  private scriptManager: ScriptManager;
  private logger: Logger;
  private watchDir: string;
  private recentlyLoaded: Map<string, number> = new Map();
  private debounceTime = 1000; // 1 second debounce
  private docGenerator: ModuleDocumentGenerator;

  constructor(scriptManager: ScriptManager, logger: Logger, watchDir: string) {
    this.scriptManager = scriptManager;
    this.logger = logger;
    this.watchDir = watchDir;
    this.docGenerator = new ModuleDocumentGenerator(watchDir);
  }

  private isRecentlyLoaded(path: string): boolean {
    const lastLoaded = this.recentlyLoaded.get(path);
    if (!lastLoaded) return false;

    const now = Date.now();
    if (now - lastLoaded > this.debounceTime) {
      this.recentlyLoaded.delete(path);
      return false;
    }
    return true;
  }

  private markAsLoaded(path: string): void {
    this.recentlyLoaded.set(path, Date.now());
  }

  private async extractAppMetadata(
    content: string,
  ): Promise<AppMetadata | null> {
    const metadataMatch = content.match(/@app\s*({[\s\S]*?})/);
    if (!metadataMatch) return null;

    try {
      return JSON.parse(metadataMatch[1]);
    } catch (error) {
      this.logger.error(`Failed to parse app metadata: ${error}`);
      return null;
    }
  }

  private async calculateChecksum(content: string): Promise<string> {
    const messageBuffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", messageBuffer);
    return encodeHex(hashBuffer);
  }

  private async verifyApps() {
    try {
      // Get current apps from KV
      const apps = await this.scriptManager.kv.get(["server", "apps"]) || [];
      const validApps: AppRegistration[] = [];

      return apps;
    } catch (error) {
      this.logger.error(`Error verifying apps: ${error}`);
      return null;
    }
  }

  private async registerVueApp(path: string, content: string) {
    const metadata = await this.extractAppMetadata(content);
    if (!metadata) return;

    const checksum = await this.calculateChecksum(content);
    const registration: AppRegistration = {
      ...metadata,
      checksum,
      updatedAt: Date.now(),
      path,
    };

    // Get existing apps and verify them first
    await this.verifyApps();
    const apps = await this.scriptManager.kv.get(["server", "apps"]) || [];

    // Find if app already exists
    const existingIndex = apps.findIndex((app: AppRegistration) =>
      app.name === metadata.name
    );
    const isNew = existingIndex === -1;

    if (isNew) {
      apps.push(registration);
    } else {
      apps[existingIndex] = registration;
    }

    // Update apps in KV store
    await this.scriptManager.kv.set(["server", "apps"], apps);

    // Broadcast update to all connected players
    const broadcastData = {
      type: "app_update",
      app: registration,
      isNew,
      code: isNew ? content : undefined,
    };

    this.scriptManager.broadcastPlayers(broadcastData);
    this.logger.info(
      `${isNew ? "Registered" : "Updated"} App: ${metadata.name}`,
    );
  }

  private async generateAndSaveDocumentation(): Promise<void> {
    try {
      const documentation = await this.docGenerator.generateDocumentation();
      const docsPath = `${this.watchDir}/documentation.md`;
      await Deno.writeTextFile(docsPath, documentation);
      this.logger.info(`Generated module documentation at ${docsPath}`);
    } catch (error) {
      this.logger.error(`Failed to generate documentation: ${error}`);
    }
  }

  async watch() {
    try {
      // Initial verification and documentation generation
      await this.verifyApps();
      // await this.generateAndSaveDocumentation();

      const watcher = Deno.watchFs(this.watchDir, { recursive: true });

      for await (const event of watcher) {
        if (event.kind === "modify" || event.kind === "remove") {
          let shouldRegenerateDocumentation = false;

          for (const path of event.paths) {
            if (path.endsWith(".ts")) {
              // Clean the path
              const cleanPath = path.replace(/^\/app\//, "");

              // Skip if recently loaded
              if (this.isRecentlyLoaded(cleanPath)) {
                continue;
              }

              // Add small delay to ensure file write is complete
              await new Promise((resolve) => setTimeout(resolve, 100));

              try {
                this.markAsLoaded(cleanPath);
                await this.scriptManager.loadModule(cleanPath);
                this.logger.info(`Reloaded module: ${cleanPath}`);
                shouldRegenerateDocumentation = true;
              } catch (error) {
                this.logger.error(
                  `Failed to reload module ${cleanPath}: ${error}`,
                );
              }
            }
          }

          // Regenerate documentation if any TypeScript files were modified
          if (shouldRegenerateDocumentation) {
            // await this.generateAndSaveDocumentation();
          }
        }
      }
    } catch (error) {
      this.logger.error(`Watch error: ${error}`);
    }
  }

  async handleAppListRequest(
    permission: "guest" | "player" | "operator",
  ): Promise<AppRegistration[]> {
    // Verify apps before returning list
    const validApps = await this.verifyApps();
    if (!validApps) return [];

    return validApps
      .filter((app: AppRegistration) => {
        switch (permission) {
          case "operator":
            return true;
          case "player":
            return app.permission === "player" || app.permission === "guest";
          case "guest":
            return app.permission === "guest";
          default:
            return false;
        }
      })
      .map((app: AppRegistration) => ({
        title: app.title,
        name: app.name,
        icon: app.icon,
        description: app.description,
        version: app.version,
        permission: app.permission,
        checksum: app.checksum,
        updatedAt: app.updatedAt,
        path: app.path,
        singleWindow: app.singleWindow,
        height: app.height,
        width: app.width,
        isClosable: app.isClosable,
      }));
  }

  async handleAppCodeRequest(
    appNames: string[],
    permission: "guest" | "player" | "operator",
  ): Promise<{
    result: any;
    names: string[];
  }> {
    // Verify apps before handling request
    await this.verifyApps();
    const apps = await this.scriptManager.kv.get(["server", "apps"]) || [];
    const result: Record<string, string> = {};

    for (const appName of appNames) {
      const app = apps.find((a: AppRegistration) => a.name === appName);
      if (app) {
        if (!this.hasPermission(permission, app.permission)) {
          continue;
        }

        try {
          const content = await Deno.readTextFile(app.path);
          result[appName] = { app, content };
        } catch (error) {
          // this.logger.error(`Failed to read app code for ${appName}: ${error}`); // or it's an inbuilt app
        }
      }
    }

    return result;
  }

  private hasPermission(
    userPermission: string,
    requiredPermission: string,
  ): boolean {
    const permissionLevels = {
      "guest": 0,
      "player": 1,
      "operator": 2,
    };

    return permissionLevels[userPermission] >=
      permissionLevels[requiredPermission];
  }
}
