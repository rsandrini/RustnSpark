import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  SWEEP_INTERVAL_MS,
  THROTTLE_LIMIT,
  THROTTLE_TTL_MS,
  ThrottlerGuard,
} from './throttler.guard.js';

function makeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

// The bucket Map is a private implementation detail; reaching into it here is the simplest way
// to prove the sweep actually shrinks memory, without exposing a size getter from production code.
function bucketCount(guard: ThrottlerGuard): number {
  return (guard as unknown as { buckets: Map<string, unknown> }).buckets.size;
}

describe('ThrottlerGuard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests up to the configured limit', () => {
    const guard = new ThrottlerGuard();
    const context = makeContext('1.2.3.4');
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('rejects with 429 once the limit is exceeded', () => {
    const guard = new ThrottlerGuard();
    const context = makeContext('1.2.3.4');
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) guard.canActivate(context);

    expect(() => guard.canActivate(context)).toThrow(HttpException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('tracks separate clients independently', () => {
    const guard = new ThrottlerGuard();
    const clientA = makeContext('1.1.1.1');
    const clientB = makeContext('2.2.2.2');
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) guard.canActivate(clientA);

    expect(() => guard.canActivate(clientA)).toThrow(HttpException);
    expect(guard.canActivate(clientB)).toBe(true);
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('resets the window once the ttl elapses', () => {
      const guard = new ThrottlerGuard();
      const context = makeContext('1.2.3.4');
      for (let i = 0; i < THROTTLE_LIMIT; i += 1) guard.canActivate(context);
      expect(() => guard.canActivate(context)).toThrow(HttpException);

      jest.advanceTimersByTime(THROTTLE_TTL_MS + 1);

      expect(guard.canActivate(context)).toBe(true);
    });

    // Regression: this is the production limiter until S12.1's Redis-backed store, so it must
    // not leak one entry per distinct IP forever for clients that never come back.
    it('sweeps expired entries instead of growing the bucket map forever', () => {
      const guard = new ThrottlerGuard();
      const clientCount = 500;
      for (let i = 0; i < clientCount; i += 1) {
        guard.canActivate(makeContext(`client-${i}`));
      }
      expect(bucketCount(guard)).toBe(clientCount);

      // None of those clients ever return; move past both their window and the sweep interval.
      jest.advanceTimersByTime(SWEEP_INTERVAL_MS + THROTTLE_TTL_MS + 1);

      // The sweep is opportunistic (runs on a request), so one more request from a fresh
      // client is what triggers it.
      guard.canActivate(makeContext('client-new'));

      expect(bucketCount(guard)).toBe(1);
    });
  });
});
