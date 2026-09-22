import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis-client.js';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// Global: the health indicator uses this connection now, and S1.8's BullMQ queues reuse it too.
@Global()
@Module({
  providers: [{ provide: REDIS_CLIENT, useClass: RedisClient }],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
