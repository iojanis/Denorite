// core/kvManager.ts

import { Logger } from "./logger.ts";

type KvKey = string | number | Uint8Array | KvKey[];

export class KvManager {
  private kv: Deno.Kv | null = null;
  private logger: Logger;
  private watchers: Map<string, Set<(value: unknown) => void>> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async init() {
    try {
      this.kv = await Deno.openKv();
      this.logger.info("KV store initialized successfully");
    } catch (error) {
      this.logger.error(`Failed to initialize KV store: ${error.message}`);
      throw error;
    }
  }

  private assertKvInitialized() {
    if (!this.kv) {
      throw new Error("KV store not initialized. Call init() first.");
    }
  }

  async get(key: KvKey): Promise<unknown> {
    this.assertKvInitialized();
    const result = await this.kv!.get(key);
    return result.value;
  }

  async set(key: KvKey, value: unknown): Promise<void> {
    this.assertKvInitialized();
    await this.kv!.set(key, value);
    this.notifyWatchers(key, value);
  }

  async delete(key: KvKey): Promise<void> {
    this.assertKvInitialized();
    await this.kv!.delete(key);
    this.notifyWatchers(key, undefined);
  }

  list(prefix: KvKey, options?: Deno.KvListOptions): Deno.KvListIterator<unknown> {
    this.assertKvInitialized();
    return this.kv!.list({ prefix }, options);
  }

  watch(key: KvKey, callback: (value: unknown) => void): void {
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
    this.watchers.get(keyString)?.forEach(callback => callback(value));
  }

  async atomic(): Promise<Deno.AtomicOperation> {
    this.assertKvInitialized();
    return this.kv!.atomic();
  }

  async getWithLock<T>(
    key: KvKey,
    callback: (value: T | null) => Promise<T>
  ): Promise<T> {
    this.assertKvInitialized();
    while (true) {
      const result = await this.kv!.get<T>(key);
      if (!result.versionstamp) {
        // Key doesn't exist, create it
        const newValue = await callback(null);
        const ok = await this.kv!.atomic()
          .check({ key, versionstamp: null })
          .set(key, newValue)
          .commit();
        if (ok) return newValue;
      } else {
        // Key exists, try to update it
        const newValue = await callback(result.value);
        const ok = await this.kv!.atomic()
          .check(result)
          .set(key, newValue)
          .commit();
        if (ok) return newValue;
      }
      // If we're here, the atomic operation failed. Try again.
    }
  }

  async close(): Promise<void> {
    if (this.kv) {
      await this.kv.close();
      this.kv = null;
      this.logger.info("KV store closed");
    }
  }
}
