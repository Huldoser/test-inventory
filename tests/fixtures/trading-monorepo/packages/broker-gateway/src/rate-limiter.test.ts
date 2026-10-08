import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RateLimiter } from './rate-limiter.ts';

describe.shuffle('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('sends the first request at once', async () => {
    const sent = vi.fn(async () => 'ok');
    await new RateLimiter(5).schedule(sent);
    expect(sent).toHaveBeenCalledOnce();
  });

  test('spaces requests 200 ms apart at 5 requests per second', async () => {
    const limiter = new RateLimiter(5);
    const times: number[] = [];
    const requests = [1, 2, 3].map(() => limiter.schedule(async () => times.push(Date.now())));
    await vi.runAllTimersAsync();
    await Promise.all(requests);
    expect(times).toEqual([0, 200, 400]);
  });
});
