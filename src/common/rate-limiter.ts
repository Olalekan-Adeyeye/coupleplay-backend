/** Token-bucket limiter; keys are dropped by the caller (e.g. on disconnect). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  tryTake(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };
    const elapsedSeconds = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSeconds * this.refillPerSecond,
    );
    bucket.updatedAt = now;

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  drop(key: string): void {
    this.buckets.delete(key);
  }
}
