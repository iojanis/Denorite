// core/rateLimiter.ts

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  costMultiplier?: number;
}

interface RateLimitTier {
  guest: RateLimitConfig;
  player: RateLimitConfig;
  operator: RateLimitConfig;
}

interface BannedIpRecord {
  bannedAt: number;
  reason: string;
}

export class RateLimiter {
  private kv: Deno.Kv;
  private cache: Map<string, { count: number; resetTime: number }>;
  private methodCosts: Map<string, number>;

  private readonly DEFAULT_TIERS: RateLimitTier = {
    guest: {
      windowMs: 60000, // 1 minute
      maxRequests: 10,
      costMultiplier: 1,
    },
    player: {
      windowMs: 60000,
      maxRequests: 100,
      costMultiplier: 1,
    },
    operator: {
      windowMs: 60000,
      maxRequests: 300,
      costMultiplier: 1,
    },
  };

  constructor(kv: Deno.Kv) {
    this.kv = kv;
    this.cache = new Map();
    this.methodCosts = new Map();
  }

  setMethodCost(methodName: string, cost: number): void {
    this.methodCosts.set(methodName, cost);
  }

  private getMethodCost(methodName: string): number {
    return this.methodCosts.get(methodName) || 1;
  }

  private getBanKey(ip: string): string[] {
    return ["banned_ips", ip];
  }

  private async isIpBanned(ip: string): Promise<boolean> {
    const result = await this.kv.get<BannedIpRecord>(this.getBanKey(ip));
    return result.value !== null;
  }

  async banIp(ip: string, reason: string): Promise<void> {
    const record: BannedIpRecord = {
      bannedAt: Date.now(),
      reason,
    };
    await this.kv.set(this.getBanKey(ip), record);
  }

  async unbanIp(ip: string): Promise<void> {
    await this.kv.delete(this.getBanKey(ip));
  }

  private getRateLimitKey(ip: string, method: string): string[] {
    return [
      "rate_limit",
      ip,
      method,
      Math.floor(Date.now() / 60000).toString(),
    ];
  }

  private async checkRateLimit(
    ip: string,
    method: string,
    tier: keyof RateLimitTier = "guest",
  ): Promise<{ allowed: boolean; resetTime: number; remaining: number }> {
    if (await this.isIpBanned(ip)) {
      return { allowed: false, resetTime: 0, remaining: 0 };
    }

    const config = this.DEFAULT_TIERS[tier];
    const methodCost = this.getMethodCost(method);
    const cacheKey = `${ip}:${method}`;
    const now = Date.now();

    let record = this.cache.get(cacheKey);

    if (!record || now >= record.resetTime) {
      record = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      this.cache.set(cacheKey, record);
    }

    const newCount = record.count + (methodCost * (config.costMultiplier || 1));
    const allowed = newCount <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - newCount);

    if (allowed) {
      record.count = newCount;
      // Update KV store with the latest count
      await this.kv.atomic()
        .set(this.getRateLimitKey(ip, method), {
          count: newCount,
          resetTime: record.resetTime,
        })
        .commit();
    }

    return {
      allowed,
      resetTime: record.resetTime,
      remaining,
    };
  }

  async handleSocketRateLimit(
    ip: string,
    method: string,
    userRole: "guest" | "player" | "operator" = "guest",
  ): Promise<{ allowed: boolean; error?: string }> {
    const result = await this.checkRateLimit(ip, method, userRole);

    if (!result.allowed) {
      const resetInSeconds = Math.ceil((result.resetTime - Date.now()) / 1000);
      return {
        allowed: false,
        error:
          `Rate limit exceeded. Please try again in ${resetInSeconds} seconds.`,
      };
    }

    return { allowed: true };
  }

  async handleMinecraftServerRateLimit(
    ip: string,
    isAuthenticated: boolean,
  ): Promise<{ allowed: boolean; error?: string }> {
    if (!isAuthenticated) {
      const result = await this.checkRateLimit(
        ip,
        "minecraft_connection",
        "guest",
      );

      if (!result.allowed) {
        const resetInSeconds = Math.ceil(
          (result.resetTime - Date.now()) / 1000,
        );
        return {
          allowed: false,
          error:
            `Too many connection attempts. Please try again in ${resetInSeconds} seconds.`,
        };
      }
    }
    return { allowed: true };
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    // Clear memory cache
    for (const [key, value] of this.cache.entries()) {
      if (now >= value.resetTime) {
        this.cache.delete(key);
      }
    }

    // Optional: Clean up old KV entries
    // This could be run periodically in a separate process
    const prefix = ["rate_limit"];
    const oldWindow = Math.floor((now - 3600000) / 60000).toString(); // 1 hour ago

    for await (const entry of this.kv.list({ prefix })) {
      if (entry.key[3] < oldWindow) {
        await this.kv.delete(entry.key);
      }
    }
  }
}
