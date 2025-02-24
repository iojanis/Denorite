import { Module, Permission, Socket } from "../decorators.ts";
import { ScriptContext } from "../types.ts";

interface KvListOptions {
  prefix?: unknown[];
  start?: unknown[];
  end?: unknown[];
  reverse?: boolean;
  limit?: number;
}

interface KvEntry {
  key: unknown[];
  value: unknown;
  versionstamp: string;
}

@Module({
  name: "KvHelper",
  version: "1.0.1",
})
export class KvHelper {
  private serializeValue(value: unknown): unknown {
    if (value instanceof Deno.KvU64) {
      return {
        type: "KvU64",
        value: value.value.toString(),
      };
    }

    if (typeof value === "bigint") {
      return {
        type: "BigInt",
        value: value.toString(),
      };
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.serializeValue(v)]),
      );
    }

    return value;
  }

  private deserializeValue(value: unknown): unknown {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;

      if (obj.type === "KvU64" && typeof obj.value === "string") {
        return new Deno.KvU64(BigInt(obj.value));
      }

      if (obj.type === "BigInt" && typeof obj.value === "string") {
        return BigInt(obj.value);
      }

      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, this.deserializeValue(v)]),
      );
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.deserializeValue(v));
    }

    return value;
  }

  @Socket("kv_list_layer")
  @Permission("operator")
  async handleListLayer({ params, log, kv }: ScriptContext): Promise<{
    keys: string[];
    hasChildren: boolean[];
  }> {
    try {
      const { prefix = [] } = params;
      const prefixArray = Array.isArray(prefix) ? prefix : [];
      const prefixLength = prefixArray.length;

      const iterator = kv.list({ prefix: prefixArray });
      const uniqueKeys = new Map<string, boolean>();

      for await (const entry of iterator) {
        const key = entry.key as string[];
        if (key.length > prefixLength) {
          const currentKey = key[prefixLength];
          const hasMore = key.length > prefixLength + 1;
          uniqueKeys.set(currentKey, uniqueKeys.get(currentKey) || hasMore);
        }
      }

      const keys = Array.from(uniqueKeys.keys()).sort();
      const hasChildren = keys.map((key) => uniqueKeys.get(key) || false);

      log(`Listed KV layer at prefix: ${JSON.stringify(prefixArray)}`);
      return { keys, hasChildren };
    } catch (error) {
      log(`Error listing KV layer: ${error.message}`);
      throw error;
    }
  }

  @Socket("kv_get_data")
  @Permission("operator")
  async handleGetData({ params, log, kv }: ScriptContext): Promise<{
    entries: KvEntry[];
    hasMore: boolean;
  }> {
    try {
      const { prefix = [] } = params;
      const prefixArray = Array.isArray(prefix) ? prefix : [];

      // First, try to get direct value if it exists
      if (prefixArray.length > 0) {
        const directValue = await kv.get(prefixArray);
        if (directValue.value !== null) {
          return {
            entries: [{
              key: prefixArray,
              value: this.serializeValue(directValue.value),
              versionstamp: directValue.versionstamp,
            }],
            hasMore: false,
          };
        }
      }

      // If no direct value, list all entries under this prefix
      const options: Deno.KvListOptions = {
        prefix: prefixArray,
        limit: 1000,
      };

      const entries: KvEntry[] = [];
      const iterator = kv.list(options);
      let hasMore = false;

      for await (const entry of iterator) {
        const key = entry.key as string[];
        if (key.length === prefixArray.length + 1) { // Only get immediate children
          entries.push({
            key: entry.key,
            value: this.serializeValue(entry.value),
            versionstamp: entry.versionstamp,
          });
        }
      }

      log(
        `Got KV data at prefix: ${
          JSON.stringify(prefixArray)
        }, found ${entries.length} entries`,
      );
      return { entries, hasMore };
    } catch (error) {
      log(`Error getting KV data: ${error.message}`);
      throw error;
    }
  }

  @Socket("kv_set")
  @Permission("operator")
  async handleSet(
    { params, log, kv }: ScriptContext,
  ): Promise<{ ok: boolean; versionstamp?: string }> {
    try {
      const { key, value, expireIn } = params;
      const keyArray = Array.isArray(key) ? key : [key];
      const deserializedValue = this.deserializeValue(value);
      const options: Deno.KvSetOptions = {};

      if (expireIn) {
        options.expireIn = expireIn;
      }

      const result = await kv.set(keyArray, deserializedValue, options);
      log(`Set KV: ${JSON.stringify(keyArray)}`);
      return { ok: true, versionstamp: result.versionstamp };
    } catch (error) {
      log(`Error setting KV: ${error.message}`);
      throw error;
    }
  }

  @Socket("kv_get")
  @Permission("operator")
  async handleGet({ params, log, kv }: ScriptContext): Promise<{
    value: unknown;
    versionstamp: string | null;
    exists: boolean;
  }> {
    try {
      const { key } = params;
      const keyArray = Array.isArray(key) ? key : [key];
      const result = await kv.get(keyArray);

      log(`Get KV: ${JSON.stringify(keyArray)}`);
      return {
        value: this.serializeValue(result.value),
        versionstamp: result.versionstamp,
        exists: result.value !== null,
      };
    } catch (error) {
      log(`Error getting KV: ${error.message}`);
      throw error;
    }
  }

  @Socket("kv_delete")
  @Permission("operator")
  async handleDelete(
    { params, log, kv }: ScriptContext,
  ): Promise<{ ok: boolean }> {
    try {
      const { key } = params;
      const keyArray = Array.isArray(key) ? key : [key];
      await kv.delete(keyArray);
      log(`Deleted KV: ${JSON.stringify(keyArray)}`);
      return { ok: true };
    } catch (error) {
      log(`Error deleting KV: ${error.message}`);
      throw error;
    }
  }

  @Socket("kv_delete_all")
  @Permission("operator")
  async handleDeleteAll(
    { params, log, kv }: ScriptContext,
  ): Promise<{ count: number }> {
    try {
      const { prefix } = params;
      const prefixArray = Array.isArray(prefix) ? prefix : [prefix];
      let count = 0;

      const iterator = kv.list({ prefix: prefixArray });
      for await (const entry of iterator) {
        await kv.delete(entry.key);
        count++;
      }

      log(
        `Deleted ${count} KV entries with prefix: ${
          JSON.stringify(prefixArray)
        }`,
      );
      return { count };
    } catch (error) {
      log(`Error deleting KV entries: ${error.message}`);
      throw error;
    }
  }

  @Socket("kv_atomic")
  @Permission("operator")
  async handleAtomicOperation({ params, log, kv }: ScriptContext): Promise<{
    ok: boolean;
    versionstamp?: string;
  }> {
    try {
      const { operations } = params;
      let atomic = kv.atomic();

      for (const op of operations) {
        switch (op.type) {
          case "check":
            atomic = atomic.check({
              key: op.key,
              versionstamp: op.versionstamp,
            });
            break;

          case "set":
            atomic = atomic.set(op.key, this.deserializeValue(op.value));
            break;

          case "delete":
            atomic = atomic.delete(op.key);
            break;

          case "sum":
            atomic = atomic.mutate({
              type: "sum",
              key: op.key,
              value: new Deno.KvU64(BigInt(op.value)),
            });
            break;

          case "min":
            atomic = atomic.mutate({
              type: "min",
              key: op.key,
              value: new Deno.KvU64(BigInt(op.value)),
            });
            break;

          case "max":
            atomic = atomic.mutate({
              type: "max",
              key: op.key,
              value: new Deno.KvU64(BigInt(op.value)),
            });
            break;
        }
      }

      const result = await atomic.commit();
      log("Atomic transaction completed");
      return result;
    } catch (error) {
      log(`Error in atomic transaction: ${error.message}`);
      throw error;
    }
  }
}
