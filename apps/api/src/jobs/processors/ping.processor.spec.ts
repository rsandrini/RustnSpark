import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PingProcessor, type PingJobData } from './ping.processor.js';

function makeJob(data: PingJobData): Job<PingJobData> {
  // process() only reads job.id/name/data; a real Job needs a live queue connection to construct.
  return { id: '1', name: 'ping', data } as unknown as Job<PingJobData>;
}

describe('PingProcessor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('resolves with a processedAt timestamp when no work duration is requested', async () => {
    const processor = new PingProcessor();
    const before = Date.now();

    const result = await processor.process(makeJob({ queuedAt: before }));

    expect(result.processedAt).toBeGreaterThanOrEqual(before);
  });

  it('waits at least workMs before resolving, so shutdown tests can catch it mid-job', async () => {
    const processor = new PingProcessor();
    const workMs = 30;
    const before = Date.now();

    await processor.process(makeJob({ queuedAt: before, workMs }));

    // setTimeout may fire a millisecond before Date.now() has advanced by the full delay
    // (it failed CI at 29 vs 30); the guarantee under test is "waits ~workMs", not "never early".
    expect(Date.now() - before).toBeGreaterThanOrEqual(workMs - 2);
  });
});
