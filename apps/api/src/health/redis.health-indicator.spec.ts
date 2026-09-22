import { describe, expect, it } from '@jest/globals';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { RedisHealthIndicator } from './redis.health-indicator.js';

function makeRedis(ping: () => Promise<string>): Redis {
  return { ping } as unknown as Redis;
}

describe('RedisHealthIndicator', () => {
  it('reports up when redis responds to ping', async () => {
    const indicator = new RedisHealthIndicator(
      makeRedis(() => Promise.resolve('PONG')),
      new HealthIndicatorService(),
    );

    const result = await indicator.pingCheck('redis');

    expect(result.redis).toMatchObject({ status: 'up' });
  });

  it('reports down when redis is unreachable', async () => {
    const indicator = new RedisHealthIndicator(
      makeRedis(() => Promise.reject(new Error('connection refused'))),
      new HealthIndicatorService(),
    );

    const result = await indicator.pingCheck('redis');

    expect(result.redis.status).toBe('down');
  });

  // Regression: ioredis queues commands while disconnected (enableOfflineQueue defaults to
  // true) instead of rejecting them, so an unbounded ping() would hang the whole health check.
  it('reports down instead of hanging when ping never settles', async () => {
    const indicator = new RedisHealthIndicator(
      makeRedis(() => new Promise(() => undefined)),
      new HealthIndicatorService(),
    );

    const result = await indicator.pingCheck('redis');

    expect(result.redis.status).toBe('down');
  }, 2000);
});
