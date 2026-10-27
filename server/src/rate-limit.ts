/** Token buckets per key (client address, account): `capacity` requests, refilled over `windowMs`. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes one token; returns 0 when allowed, else the seconds to wait. */
  take(key: string): number {
    const now = this.now();
    const rate = this.capacity / this.windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) * rate);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      if (this.buckets.size > 50_000) this.prune(now);
      return 0;
    }
    return Math.max(1, Math.ceil((1 - bucket.tokens) / rate / 1000));
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) if (now - bucket.at > this.windowMs) this.buckets.delete(key);
  }
}
