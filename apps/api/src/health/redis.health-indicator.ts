import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';

// Matches PrismaHealthIndicator's own default: a down dependency must be reported within a
// bounded time. ioredis queues commands while disconnected (enableOfflineQueue defaults to
// true), so an unbounded `ping()` would hang the whole health check forever instead of failing.
const PING_TIMEOUT_MS = 1000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  pingCheck<Key extends string>(key: Key) {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout(PING_TIMEOUT_MS);
  }
}
