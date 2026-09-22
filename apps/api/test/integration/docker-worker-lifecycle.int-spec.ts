import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue, QueueEvents, type Job } from 'bullmq';
import { PING_QUEUE_NAME, bullConnectionOptions } from '../../src/jobs/queues.js';
import type { PingJobData, PingJobResult } from '../../src/jobs/processors/ping.processor.js';

// Opt-in only (R9): needs the compose `dev` profile's volume-backed AOF Redis (port 6379) and its
// `worker` service actually running - not the hermetic tmpfs `test` profile every other
// integration spec targets, and not something this suite brings up itself (building the dev image
// belongs to a setup step, not a test body). Before running with DOCKER_TESTS=1:
//   docker compose --profile dev up -d --wait
// Wired as an opt-in step in .github/workflows/ci.yml; skipped by default so the ordinary
// `test:int` run (no DOCKER_TESTS) stays hermetic and fast.
const describeDocker = process.env.DOCKER_TESTS === '1' ? describe : describe.skip;

const DEV_REDIS_URL = 'redis://127.0.0.1:6379';
const connection = bullConnectionOptions(DEV_REDIS_URL);

// This file lives at apps/api/test/integration/; the compose file is 4 levels up, at the repo root.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '--profile', 'dev', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// bullmq types job.id as string | undefined (only unset before it's persisted); add() always
// persists before returning, so this is always defined in practice.
function requireJobId(job: Job): string {
  if (!job.id) throw new Error('unreachable: job has no id right after add()');
  return job.id;
}

describeDocker('worker lifecycle against the dev compose profile', () => {
  let producerQueue: Queue<PingJobData, PingJobResult>;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    producerQueue = new Queue<PingJobData, PingJobResult>(PING_QUEUE_NAME, { connection });
    queueEvents = new QueueEvents(PING_QUEUE_NAME, { connection });
    await queueEvents.waitUntilReady();
  });

  afterAll(async () => {
    await queueEvents.close();
    await producerQueue.close();
    // Leave the dev stack healthy for whoever brought it up, whatever state the tests above left
    // the worker service in.
    compose('up', '-d', '--wait', 'worker');
  }, 60000);

  it('finishes an in-flight job on SIGTERM and exits 0', async () => {
    const job = await producerQueue.add('ping', { queuedAt: Date.now(), workMs: 3000 });

    await waitFor(async () => (await job.getState()) === 'active', 10000);

    const containerId = compose('ps', '-q', 'worker');
    expect(containerId).not.toBe('');

    compose('kill', '-s', 'SIGTERM', 'worker');
    const exitCode = execFileSync('docker', ['wait', containerId], { encoding: 'utf8' }).trim();

    expect(exitCode).toBe('0');
    await expect(job.getState()).resolves.toBe('completed');
    // Deliberately left stopped: the next test needs no worker attached while Redis restarts.
  }, 60000);

  it('keeps a job durable across a Redis container restart (AOF), processed once a worker returns', async () => {
    const job = await producerQueue.add('ping', { queuedAt: Date.now() });
    const jobId = requireJobId(job);

    compose('restart', 'redis');
    compose('up', '-d', '--wait', 'redis'); // waits for the healthcheck, i.e. AOF reload finished

    const survived = await producerQueue.getJob(jobId);
    expect(survived?.data).toMatchObject({ queuedAt: job.data.queuedAt });

    compose('up', '-d', '--wait', 'worker');
    const result = await job.waitUntilFinished(queueEvents, 15000);

    expect(result.processedAt).toBeGreaterThan(job.data.queuedAt);
  }, 60000);
});
