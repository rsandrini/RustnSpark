import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemoryThrottleStore } from '../throttling/throttle-store.js';
import { ThrottleRoute } from '../decorators/throttle-route.decorator.js';
import {
  SWEEP_INTERVAL_MS,
  THROTTLE_LIMIT,
  THROTTLE_TTL_MS,
  ThrottlerGuard,
} from './throttler.guard.js';

class DefaultController {
  route(this: void): void {
    /* no-op */
  }
}

class IpPolicyController {
  @ThrottleRoute({ limit: 2, ttlMs: THROTTLE_TTL_MS, key: 'ip' })
  route(this: void): void {
    /* no-op */
  }
}

class SecondIpPolicyController {
  @ThrottleRoute({ limit: 2, ttlMs: THROTTLE_TTL_MS, key: 'ip' })
  route(this: void): void {
    /* no-op */
  }
}

class EmailPolicyController {
  @ThrottleRoute({ limit: 2, ttlMs: THROTTLE_TTL_MS, key: 'ip+email' })
  route(this: void): void {
    /* no-op */
  }
}

class ShortLivedPolicyController {
  @ThrottleRoute({ limit: 2, ttlMs: 1_000, key: 'ip' })
  route(this: void): void {
    /* no-op */
  }
}

interface RouteRef {
  controller: new (...args: never[]) => unknown;
  handler: (...args: never[]) => unknown;
}

const DEFAULT_ROUTE: RouteRef = {
  controller: DefaultController,
  handler: DefaultController.prototype.route,
};
const IP_POLICY_ROUTE: RouteRef = {
  controller: IpPolicyController,
  handler: IpPolicyController.prototype.route,
};
const SECOND_IP_POLICY_ROUTE: RouteRef = {
  controller: SecondIpPolicyController,
  handler: SecondIpPolicyController.prototype.route,
};
const EMAIL_POLICY_ROUTE: RouteRef = {
  controller: EmailPolicyController,
  handler: EmailPolicyController.prototype.route,
};
const SHORT_LIVED_POLICY_ROUTE: RouteRef = {
  controller: ShortLivedPolicyController,
  handler: ShortLivedPolicyController.prototype.route,
};

interface MockResponse {
  headers: Map<string, string>;
  setHeader(name: string, value: string): void;
}

function makeContext(options: { ip?: string; body?: unknown; route?: RouteRef } = {}): {
  context: ExecutionContext;
  response: MockResponse;
} {
  const response: MockResponse = {
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
  };
  const route = options.route ?? DEFAULT_ROUTE;
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ ip: options.ip, body: options.body }),
      getResponse: () => response,
    }),
    getHandler: () => route.handler,
    getClass: () => route.controller,
  } as unknown as ExecutionContext;
  return { context, response };
}

const stores = new WeakMap<ThrottlerGuard, MemoryThrottleStore>();
function makeGuard(): ThrottlerGuard {
  const store = new MemoryThrottleStore();
  const guard = new ThrottlerGuard(new Reflector(), store);
  stores.set(guard, store);
  return guard;
}

// Returns the 429 HttpException the guard threw, rethrowing anything else and failing the test
// when the request was allowed.
async function catchThrottle(
  guard: ThrottlerGuard,
  context: ExecutionContext,
): Promise<HttpException> {
  try {
    await guard.canActivate(context);
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('expected the request to be throttled');
}

// The bucket Map is a private implementation detail; reaching into it here is the simplest way
// to prove the sweep actually shrinks memory, without exposing a size getter from production code.
function bucketCount(guard: ThrottlerGuard): number {
  return stores.get(guard)!.size;
}

describe('ThrottlerGuard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests up to the configured default limit', async () => {
    const guard = makeGuard();
    const { context } = makeContext({ ip: '1.2.3.4' });
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) {
      expect(await guard.canActivate(context)).toBe(true);
    }
  });

  it('rejects with 429 and a Retry-After header once the default limit is exceeded', async () => {
    const guard = makeGuard();
    const { context, response } = makeContext({ ip: '1.2.3.4' });
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) await guard.canActivate(context);

    const error = await catchThrottle(guard, context);
    expect(error.getStatus()).toBe(429);
    expect(response.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('tracks separate clients independently', async () => {
    const guard = makeGuard();
    const clientA = makeContext({ ip: '1.1.1.1' });
    const clientB = makeContext({ ip: '2.2.2.2' });
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) await guard.canActivate(clientA.context);

    expect((await catchThrottle(guard, clientA.context)).getStatus()).toBe(429);
    expect(await guard.canActivate(clientB.context)).toBe(true);
  });

  describe('with fake timers', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('resets the window once the ttl elapses', async () => {
      const guard = makeGuard();
      const { context } = makeContext({ ip: '1.2.3.4' });
      for (let i = 0; i < THROTTLE_LIMIT; i += 1) await guard.canActivate(context);
      expect((await catchThrottle(guard, context)).getStatus()).toBe(429);

      jest.advanceTimersByTime(THROTTLE_TTL_MS + 1);

      expect(await guard.canActivate(context)).toBe(true);
    });

    // Regression: this is the production limiter until S12.1's Redis-backed store, so it must
    // not leak one entry per distinct IP forever for clients that never come back.
    it('sweeps expired entries instead of growing the bucket map forever', async () => {
      const guard = makeGuard();
      const clientCount = 500;
      for (let i = 0; i < clientCount; i += 1) {
        await guard.canActivate(makeContext({ ip: `client-${i}` }).context);
      }
      expect(bucketCount(guard)).toBe(clientCount);

      // None of those clients ever return; move past both their window and the sweep interval.
      jest.advanceTimersByTime(SWEEP_INTERVAL_MS + THROTTLE_TTL_MS + 1);

      // The sweep is opportunistic (runs on a request), so one request from a fresh
      // client is what triggers it.
      await guard.canActivate(makeContext({ ip: 'client-new' }).context);

      expect(bucketCount(guard)).toBe(1);
    });
  });

  describe('route policies (R20)', () => {
    it('replaces the default limit on a policy route: one limiter total', async () => {
      const guard = makeGuard();
      const { context, response } = makeContext({ ip: '1.2.3.4', route: IP_POLICY_ROUTE });
      expect(await guard.canActivate(context)).toBe(true);
      expect(await guard.canActivate(context)).toBe(true);

      // The policy allows 2: the third request is throttled even though the default limit is 60.
      expect((await catchThrottle(guard, context)).getStatus()).toBe(429);
      expect(response.headers.get('Retry-After')).toMatch(/^\d+$/);
    });

    it('does not consume the default bucket of the same client', async () => {
      const guard = makeGuard();
      const policy = makeContext({ ip: '1.2.3.4', route: IP_POLICY_ROUTE });
      await guard.canActivate(policy.context);
      await guard.canActivate(policy.context);
      expect((await catchThrottle(guard, policy.context)).getStatus()).toBe(429);

      // An unmarked route from the same IP still gets a fresh default window.
      expect(await guard.canActivate(makeContext({ ip: '1.2.3.4' }).context)).toBe(true);
    });

    it('does not share a bucket between two routes that carry the same policy', async () => {
      const guard = makeGuard();
      const first = makeContext({ ip: '1.2.3.4', route: IP_POLICY_ROUTE });
      const second = makeContext({ ip: '1.2.3.4', route: SECOND_IP_POLICY_ROUTE });
      await guard.canActivate(first.context);
      await guard.canActivate(first.context);
      expect((await catchThrottle(guard, first.context)).getStatus()).toBe(429);

      expect(await guard.canActivate(second.context)).toBe(true);
    });

    it('shares one bucket across requests that carry no client ip', async () => {
      const guard = makeGuard();
      expect(await guard.canActivate(makeContext({ route: IP_POLICY_ROUTE }).context)).toBe(true);
      expect(await guard.canActivate(makeContext({ route: IP_POLICY_ROUTE }).context)).toBe(true);
      expect(
        (await catchThrottle(guard, makeContext({ route: IP_POLICY_ROUTE }).context)).getStatus(),
      ).toBe(429);
    });

    it('uses the policy ttl for the policy window, not the default ttl', async () => {
      jest.useFakeTimers();
      const guard = makeGuard();
      const { context } = makeContext({ ip: '1.2.3.4', route: SHORT_LIVED_POLICY_ROUTE });
      await guard.canActivate(context);
      await guard.canActivate(context);
      expect((await catchThrottle(guard, context)).getStatus()).toBe(429);

      // Past the policy ttl (1s) but well inside the default ttl (60s).
      jest.advanceTimersByTime(1_001);

      expect(await guard.canActivate(context)).toBe(true);
    });

    describe('ip+email keying', () => {
      const emailContext = (body?: unknown) =>
        makeContext({ ip: '1.2.3.4', body, route: EMAIL_POLICY_ROUTE });

      it('buckets by the lowercased email', async () => {
        const guard = makeGuard();
        expect(await guard.canActivate(emailContext({ email: 'Pilot@Example.com' }).context)).toBe(
          true,
        );
        expect(await guard.canActivate(emailContext({ email: 'pilot@example.com' }).context)).toBe(
          true,
        );

        // The same mailbox in any case shares one bucket: the third attempt is throttled.
        expect(
          (
            await catchThrottle(guard, emailContext({ email: 'PILOT@EXAMPLE.COM' }).context)
          ).getStatus(),
        ).toBe(429);
      });

      it('gives a different email from the same IP its own bucket', async () => {
        const guard = makeGuard();
        await guard.canActivate(emailContext({ email: 'a@example.com' }).context);
        await guard.canActivate(emailContext({ email: 'a@example.com' }).context);
        expect(
          (
            await catchThrottle(guard, emailContext({ email: 'a@example.com' }).context)
          ).getStatus(),
        ).toBe(429);

        expect(await guard.canActivate(emailContext({ email: 'b@example.com' }).context)).toBe(
          true,
        );
      });

      it('treats a missing or non-string email as one shared bucket', async () => {
        const guard = makeGuard();
        expect(await guard.canActivate(emailContext(undefined).context)).toBe(true);
        expect(await guard.canActivate(emailContext({}).context)).toBe(true);
        expect((await catchThrottle(guard, emailContext({ email: 42 }).context)).getStatus()).toBe(
          429,
        );
        expect((await catchThrottle(guard, emailContext(null).context)).getStatus()).toBe(429);
      });
    });

    it('keys ip policies by the IP alone, ignoring the body', async () => {
      const guard = makeGuard();
      const withBody = (body: unknown) =>
        makeContext({ ip: '1.2.3.4', body, route: IP_POLICY_ROUTE });
      expect(await guard.canActivate(withBody({ email: 'a@example.com' }).context)).toBe(true);
      expect(await guard.canActivate(withBody({ email: 'b@example.com' }).context)).toBe(true);
      expect(
        (await catchThrottle(guard, withBody({ email: 'c@example.com' }).context)).getStatus(),
      ).toBe(429);
    });
  });
});
