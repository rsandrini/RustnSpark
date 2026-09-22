import type { ConnectionOptions } from 'bullmq';

// Removed once real processors/queues exist (plan S1.8); the name stays distinct from any future
// domain queue so this throwaway proof-of-life wiring is easy to spot and delete.
export const PING_QUEUE_NAME = 'ping';

// BullMQ opens its own dedicated connection per Queue/Worker: a Worker's blocking commands cannot
// share a connection with anything else, so bullmq requires `maxRetriesPerRequest: null` on any
// connection it drives itself. Passing the shared REDIS_CLIENT ioredis instance (S1.5) straight to
// a Worker throws ("Your redis options maxRetriesPerRequest must be null") because that instance
// doesn't set it, and setting it globally on REDIS_CLIENT would change retry behaviour for the
// health check and anything else that reuses it. Handing bullmq a plain options object instead
// sidesteps that: bullmq sets `maxRetriesPerRequest` itself once it opens the connection. This
// still derives from the one EnvService.get('REDIS_URL') source of truth (R4), never a second
// parse of process.env.
export function bullConnectionOptions(redisUrl: string): ConnectionOptions {
  return { url: redisUrl };
}
