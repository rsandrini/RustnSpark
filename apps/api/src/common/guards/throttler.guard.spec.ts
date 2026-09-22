import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { THROTTLE_LIMIT, THROTTLE_TTL_MS, ThrottlerGuard } from './throttler.guard.js';

function makeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
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
  });
});
