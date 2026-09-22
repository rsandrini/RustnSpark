import { afterEach, describe, expect, it } from '@jest/globals';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, QueueEvents } from 'bullmq';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { PING_QUEUE_NAME, bullConnectionOptions } from '../../src/jobs/queues.js';
import type { PingJobData, PingJobResult } from '../../src/jobs/processors/ping.processor.js';
import { testEnv } from '../support/app-factory.js';

// testEnv() always sets this key; the throw is unreachable in practice and only satisfies
// noUncheckedIndexedAccess, which widens every Record<string, string> index to `| undefined`.
function requiredEnv(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (value === undefined) throw new Error(`test env is missing required key "${key}"`);
  return value;
}

// Targets the compose `test` profile's tmpfs Redis (D9): run
// `docker compose --profile test up -d --wait redis-test` before `pnpm --filter api test:int`.
// Deliberately deferred from S1.7 (R5): proves a delayed BullMQ job is picked up by a real worker
// application context (the same wiring worker.ts boots), and never before its delay elapses.
describe('BullMQ ping queue round trip', () => {
  const DELAY_MS = 200;
  const originalEnv = { ...process.env };

  let producerQueue: Queue<PingJobData, PingJobResult> | undefined;
  let queueEvents: QueueEvents | undefined;
  let workerContext: INestApplicationContext | undefined;

  afterEach(async () => {
    await queueEvents?.close();
    await producerQueue?.close();
    await workerContext?.close();
    queueEvents = undefined;
    producerQueue = undefined;
    workerContext = undefined;
    process.env = { ...originalEnv };
  });

  it('processes a delayed job only after the delay elapses, via a real worker context', async () => {
    const env = testEnv();
    Object.assign(process.env, env);
    const connection = bullConnectionOptions(requiredEnv(env, 'REDIS_URL'));

    producerQueue = new Queue<PingJobData, PingJobResult>(PING_QUEUE_NAME, { connection });
    queueEvents = new QueueEvents(PING_QUEUE_NAME, { connection });
    await queueEvents.waitUntilReady();

    const enqueuedAt = Date.now();
    const job = await producerQueue.add('ping', { queuedAt: enqueuedAt }, { delay: DELAY_MS });

    // Well before the delay elapses, the job must still be waiting, not already picked up -
    // proves "never processed earlier" independent of when the worker context below starts.
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS / 4));
    await expect(job.getState()).resolves.toBe('delayed');

    // Only now does a real worker application context exist (the same module worker.ts boots).
    workerContext = await NestFactory.createApplicationContext(JobsModule, { logger: false });

    const result = await job.waitUntilFinished(queueEvents, 5000);

    const elapsed = result.processedAt - enqueuedAt;
    expect(elapsed).toBeGreaterThanOrEqual(DELAY_MS);
  }, 10000);
});
