import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

export interface ThrottleHit {
  /** Requests counted in the current window, including this one. */
  readonly count: number;
  readonly resetInMs: number;
}

export interface ThrottleStore {
  hit(key: string, ttlMs: number): Promise<ThrottleHit>;
}

export const THROTTLE_STORE = 'THROTTLE_STORE';

// Bounded sweep so a long-running instance cannot leak one entry per distinct client forever.
export const SWEEP_INTERVAL_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

/** Single-instance fixed window; used by unit tests and as the fallback without Redis. */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;

  /** Live buckets (tests: proves the sweep shrinks memory). */
  get size(): number {
    return this.buckets.size;
  }

  hit(key: string, ttlMs: number): Promise<ThrottleHit> {
    const now = Date.now();
    this.sweep(now);
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + ttlMs });
      return Promise.resolve({ count: 1, resetInMs: ttlMs });
    }
    bucket.count += 1;
    return Promise.resolve({ count: bucket.count, resetInMs: bucket.resetAt - now });
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

// INCR + first-hit PEXPIRE + PTTL in one round trip, atomically, so two API instances counting
// the same client never lose an increment and a window can never be left without an expiry.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

// A request must never wait on a dead Redis (ioredis queues commands while reconnecting):
// past this the limiter gives up and lets the request through.
const HIT_TIMEOUT_MS = 250;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Redis-backed fixed window shared by every API instance. Fails OPEN: if Redis is unreachable
 * the request is let through (and logged) rather than taking the whole game down — the limiter
 * is abuse control, and Redis being down is already an incident everywhere else.
 */
@Injectable()
export class RedisThrottleStore implements ThrottleStore {
  private readonly logger = new Logger(RedisThrottleStore.name);

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'throttle:',
  ) {}

  async hit(key: string, ttlMs: number): Promise<ThrottleHit> {
    try {
      const [count, ttl] = (await withTimeout(
        this.redis.eval(HIT_SCRIPT, 1, `${this.prefix}${key}`, String(ttlMs)),
        HIT_TIMEOUT_MS,
      )) as [number, number];
      return { count, resetInMs: ttl };
    } catch (error) {
      this.logger.warn(`throttle store unavailable, failing open: ${(error as Error).message}`);
      return { count: 1, resetInMs: ttlMs };
    }
  }
}
