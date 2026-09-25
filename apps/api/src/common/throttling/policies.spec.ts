import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { TokenService } from '../../auth/token.service.js';
import { ThrottlerGuard } from '../guards/throttler.guard.js';
import {
  INTENT_POLICY,
  PREVIEW_POLICY,
  READ_POLICY,
  REGISTER_POLICY,
  defaultPolicyFor,
} from './policies.js';
import { MemoryThrottleStore } from './throttle-store.js';

class Controller {
  handler(this: void): void {
    /* no-op */
  }
}

function context(request: {
  ip: string;
  method: string;
  headers?: { authorization?: string };
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined }),
    }),
    getHandler: () => Controller.prototype.handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

// Tokens look like `acct:<id>`; anything else is invalid, like a bad signature.
const tokens = {
  verifyAccessToken: (token: string) =>
    token.startsWith('acct:')
      ? Promise.resolve({ accountId: token.slice(5), playerId: 'p', role: 'PLAYER' })
      : Promise.reject(new Error('invalid')),
} as unknown as TokenService;

const guard = () => new ThrottlerGuard(new Reflector(), new MemoryThrottleStore(), tokens);
const bearer = (account: string) => ({ authorization: `Bearer acct:${account}` });

async function exhaust(g: ThrottlerGuard, ctx: ExecutionContext, limit: number): Promise<void> {
  for (let i = 0; i < limit; i += 1) await g.canActivate(ctx);
}
async function throttled(g: ThrottlerGuard, ctx: ExecutionContext): Promise<boolean> {
  try {
    await g.canActivate(ctx);
    return false;
  } catch (error) {
    return error instanceof HttpException && error.getStatus() === 429;
  }
}

describe('rate-limit policy matrix (S12.1)', () => {
  it('orders the classes: intents are stricter than previews, previews stricter than reads', () => {
    expect(INTENT_POLICY.limit).toBeLessThan(PREVIEW_POLICY.limit);
    expect(PREVIEW_POLICY.limit).toBeLessThan(READ_POLICY.limit);
    expect(REGISTER_POLICY.limit).toBeLessThan(INTENT_POLICY.limit);
  });

  it('classifies unmarked routes by HTTP method', () => {
    expect(defaultPolicyFor('GET')).toBe(READ_POLICY);
    expect(defaultPolicyFor('get')).toBe(READ_POLICY);
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(defaultPolicyFor(verb)).toBe(INTENT_POLICY);
    }
  });

  it('counts reads and intents in separate buckets', async () => {
    const g = guard();
    const post = context({ ip: '1.1.1.1', method: 'POST', headers: bearer('a') });
    const get = context({ ip: '1.1.1.1', method: 'GET', headers: bearer('a') });
    await exhaust(g, post, INTENT_POLICY.limit);
    expect(await throttled(g, post)).toBe(true);
    expect(await throttled(g, get)).toBe(false); // polling keeps working while intents are capped
  });

  it('gives each account its own bucket even behind one shared IP (NAT)', async () => {
    const g = guard();
    const alice = context({ ip: '9.9.9.9', method: 'POST', headers: bearer('alice') });
    const bob = context({ ip: '9.9.9.9', method: 'POST', headers: bearer('bob') });
    await exhaust(g, alice, INTENT_POLICY.limit);
    expect(await throttled(g, alice)).toBe(true);
    expect(await throttled(g, bob)).toBe(false);
  });

  it('follows the account across IPs (a client cannot dodge the cap by rotating addresses)', async () => {
    const g = guard();
    await exhaust(
      g,
      context({ ip: '1.1.1.1', method: 'POST', headers: bearer('a') }),
      INTENT_POLICY.limit,
    );
    expect(
      await throttled(g, context({ ip: '2.2.2.2', method: 'POST', headers: bearer('a') })),
    ).toBe(true);
  });

  it('falls back to the IP for a missing or invalid token', async () => {
    const g = guard();
    const forged = context({
      ip: '3.3.3.3',
      method: 'POST',
      headers: { authorization: 'Bearer forged' },
    });
    await exhaust(g, forged, INTENT_POLICY.limit);
    expect(await throttled(g, forged)).toBe(true);
    // Rotating forged tokens does not mint fresh buckets: they all count against the IP.
    expect(
      await throttled(
        g,
        context({ ip: '3.3.3.3', method: 'POST', headers: { authorization: 'Bearer other' } }),
      ),
    ).toBe(true);
    expect(await throttled(g, context({ ip: '3.3.3.3', method: 'POST' }))).toBe(true);
  });
});
