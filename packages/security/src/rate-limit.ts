export type RateLimitDecision = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}>;

export type SharedRateLimitIncrement = Readonly<{
  key: string;
  now: Date;
  resetAt: Date;
}>;

export type SharedRateLimitBucket = Readonly<{
  count: number;
  resetAt: Date;
}>;

export interface SharedRateLimitStore {
  increment(input: SharedRateLimitIncrement): Promise<SharedRateLimitBucket>;
}

function validateConfiguration(limit: number, windowMs: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Rate limit must be a positive integer");
  }
  if (!Number.isInteger(windowMs) || windowMs < 1_000) {
    throw new Error("Rate-limit window must be at least one second");
  }
}

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    validateConfiguration(limit, windowMs);
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    this.operations += 1;
    if (this.operations % 100 === 0) {
      this.prune(now);
    }

    const current = this.buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + this.windowMs }
        : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    return {
      allowed: bucket.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

export class SharedRateLimiter {
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly store: SharedRateLimitStore,
  ) {
    validateConfiguration(limit, windowMs);
  }

  async consume(key: string, now = Date.now()): Promise<RateLimitDecision> {
    if (!key) {
      throw new Error("Rate-limit key is required");
    }
    const bucket = await this.store.increment({
      key,
      now: new Date(now),
      resetAt: new Date(now + this.windowMs),
    });
    const resetAt = bucket.resetAt.getTime();
    if (
      !Number.isInteger(bucket.count) ||
      bucket.count < 1 ||
      !Number.isFinite(resetAt) ||
      resetAt <= now
    ) {
      throw new Error("Shared rate-limit store returned an invalid bucket");
    }
    return {
      allowed: bucket.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAt,
    };
  }
}
