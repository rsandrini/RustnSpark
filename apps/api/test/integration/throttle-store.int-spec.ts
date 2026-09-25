import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Redis } from 'ioredis';
import { RedisThrottleStore } from '../../src/common/throttling/throttle-store.js';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

describe('RedisThrottleStore (S12.1)', () => {
  let redisA: Redis;
  let redisB: Redis;
  const prefix = `throttle-test:${randomUUID()}:`;

  beforeAll(() => {
    redisA = new Redis(REDIS_URL);
    redisB = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    const keys = await redisA.keys(`${prefix}*`);
    if (keys.length > 0) await redisA.del(...keys);
    await redisA.quit();
    await redisB.quit();
  });

  it('shares one window across API instances (two stores, one Redis)', async () => {
    const instanceA = new RedisThrottleStore(redisA, prefix);
    const instanceB = new RedisThrottleStore(redisB, prefix);
    const first = await instanceA.hit('client', 60_000);
    const second = await instanceB.hit('client', 60_000);
    const third = await instanceA.hit('client', 60_000);
    expect([first.count, second.count, third.count]).toEqual([1, 2, 3]);
    expect(third.resetInMs).toBeGreaterThan(0);
    expect(third.resetInMs).toBeLessThanOrEqual(60_000);
  });

  it('counts concurrent hits without losing increments', async () => {
    const store = new RedisThrottleStore(redisA, prefix);
    const hits = await Promise.all(Array.from({ length: 50 }, () => store.hit('burst', 60_000)));
    expect(Math.max(...hits.map((hit) => hit.count))).toBe(50);
    expect(new Set(hits.map((hit) => hit.count)).size).toBe(50);
  });

  it('starts a new window once the ttl passes', async () => {
    const store = new RedisThrottleStore(redisA, prefix);
    await store.hit('short', 150);
    await store.hit('short', 150);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await store.hit('short', 150)).count).toBe(1);
  });

  it('keeps clients apart', async () => {
    const store = new RedisThrottleStore(redisA, prefix);
    await store.hit('one', 60_000);
    expect((await store.hit('two', 60_000)).count).toBe(1);
  });

  it('fails open when Redis is unreachable', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    const store = new RedisThrottleStore(dead, prefix);
    expect((await store.hit('x', 60_000)).count).toBe(1);
    dead.disconnect();
  });
});
