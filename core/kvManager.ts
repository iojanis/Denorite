// deno-lint-ignore-file
// core/kvManager.ts

import { Logger } from "./logger.ts";

type KvKey = string | number | Uint8Array | KvKey[];

export class KvManager {
  public kv: Deno.Kv | null = null;
  private logger: Logger;
  private watchers: Map<string, Set<(value: unknown) => void>> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
    this.logger.debug("KvManager instance created");
  }

  async init() {
    try {
      const url = Deno.env.get("DENO_KV_URL");
      this.logger.debug(
        `Initializing KV store${
          url ? ` with URL: ${url}` : " with default path"
        }`,
      );
      this.kv = await Deno.openKv(url);
      this.logger.debug("KV store initialized successfully");
    } catch (error: any) {
      this.logger.error(`Failed to initialize KV store: ${error.message}`);
      throw error;
    }
  }

  private assertKvInitialized() {
    if (!this.kv) {
      this.logger.error("Attempted to use KV store before initialization");
      throw new Error("KV store not initialized. Call init() first.");
    }
  }

  async get<T = unknown>(key: Deno.KvKey): Promise<T | null> {
    this.assertKvInitialized();
    const result = await this.kv!.get<T>(key);
    return result.value;
  }

  async set(key: Deno.KvKey, value: unknown): Promise<void> {
    this.assertKvInitialized();
    await this.kv!.set(key, value);
    this.notifyWatchers(key as KvKey, value);
  }

  async delete(key: Deno.KvKey): Promise<void> {
    this.assertKvInitialized();
    await this.kv!.delete(key);
    this.notifyWatchers(key as KvKey, undefined);
  }

  list(
    prefix: Deno.KvKey,
    options?: Deno.KvListOptions,
  ): Deno.KvListIterator<unknown> {
    this.assertKvInitialized();
    return this.kv!.list({ prefix }, options);
  }

  watch(key: Deno.KvKey, callback: (value: unknown) => void): void {
    const keyString = JSON.stringify(key);
    if (!this.watchers.has(keyString)) {
      this.watchers.set(keyString, new Set());
    }
    this.watchers.get(keyString)!.add(callback);
  }

  unwatch(key: KvKey, callback: (value: unknown) => void): void {
    const keyString = JSON.stringify(key);
    this.watchers.get(keyString)?.delete(callback);
  }

  private notifyWatchers(key: KvKey, value: unknown): void {
    const keyString = JSON.stringify(key);
    const watcherCount = this.watchers.get(keyString)?.size || 0;
    this.watchers.get(keyString)?.forEach((callback) => callback(value));
  }

  atomic(): Deno.AtomicOperation {
    this.assertKvInitialized();
    return this.kv!.atomic();
  }

  async getWithLock<T>(
    key: Deno.KvKey,
    callback: (value: T | null) => Promise<T>,
  ): Promise<T> {
    this.assertKvInitialized();

    while (true) {
      const result = await this.kv!.get<T>(key);
      const newValue = await callback(result.value);

      const atomic = this.kv!.atomic();
      if (!result.versionstamp) {
        atomic.check({ key, versionstamp: null });
      } else {
        atomic.check(result);
      }

      const commitResult = await atomic
        .set(key, newValue)
        .commit();

      if (commitResult) {
        return newValue;
      }
    }
  }

  async close(): Promise<void> {
    if (this.kv) {
      await this.kv.close();
      this.kv = null;
      this.logger.debug("KV store closed successfully");
    } else {
      this.logger.debug("KV store was already closed");
    }
  }
}
