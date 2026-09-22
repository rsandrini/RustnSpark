import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis-client.js';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// Global: the health indicator uses this connection. BullMQ (S1.8, apps/api/src/jobs) does NOT
// reuse this instance - it derives its connection details from the same EnvService.get('REDIS_URL')
// source of truth but opens its own dedicated connection (apps/api/src/jobs/queues.ts), because
// bullmq requires maxRetriesPerRequest: null on any connection it drives itself, which this
// instance doesn't set and shouldn't (it would change retry behaviour for the health check too).
@Global()
@Module({
  providers: [{ provide: REDIS_CLIENT, useClass: RedisClient }],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
