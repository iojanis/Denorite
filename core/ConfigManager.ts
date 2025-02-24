// deno-lint-ignore-file
import { KvManager } from "./kvManager.ts";
import { Logger } from "./logger.ts";

export class ConfigManager {
  private kv: KvManager;
  private logger: Logger;
  private cache: Map<string, any> = new Map();
  private watchers: Map<string, Set<(value: any) => void>> = new Map();

  constructor(kv: KvManager, logger: Logger) {
    this.kv = kv;
    this.logger = logger;
  }

  async init(defaultConfig: Record<string, any> = {}) {
    // Load default configuration
    for (const [key, value] of Object.entries(defaultConfig)) {
      if (!(await this.get(key))) {
        await this.set(key, value);
      }
    }

    // Load configuration from environment variables
    for (const [key, value] of Object.entries(Deno.env.toObject())) {
      if (key.startsWith("DENORITE_")) {
        const configKey = key.replace("DENORITE_", "");
        await this.set(configKey, value);
      }
    }

    this.logger.debug("Configuration initialized");
  }

  async get(key: string): Promise<any> {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const value = this.kv.get(["config", key]);
    if (value !== null) {
      this.cache.set(key, value);
    }
    return value;
  }

  async set(key: string, value: any): Promise<void> {
    await this.kv.set(["config", key], value);
    this.cache.set(key, value);
    this.notifyWatchers(key, value);
    this.logger.debug(`Configuration updated: ${key} = ${value}`);
  }

  watch(key: string, callback: (value: any) => void): void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key)?.add(callback);
  }

  unwatch(key: string, callback: (value: any) => void): void {
    this.watchers.get(key)?.delete(callback);
  }

  private notifyWatchers(key: string, value: any): void {
    this.watchers.get(key)?.forEach((callback) => callback(value));
  }

  async getMultiple(keys: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async setMultiple(config: Record<string, any>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      await this.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(["config", key]);
    this.cache.delete(key);
    this.notifyWatchers(key, undefined);
    this.logger.info(`Configuration deleted: ${key}`);
  }

  async list(prefix: string = ""): Promise<string[]> {
    const keys: string[] = [];
    for await (const entry of this.kv.list(["config"])) {
      const key = entry.key[1] as string;
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }
}
