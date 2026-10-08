/** Spaces requests to the broker so they stay under its limit of requests per second. */
export class RateLimiter {
  private next = 0;

  constructor(private readonly perSecond: number) {}

  async schedule<T>(request: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const start = Math.max(now, this.next);
    this.next = start + 1_000 / this.perSecond;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
    return request();
  }
}
