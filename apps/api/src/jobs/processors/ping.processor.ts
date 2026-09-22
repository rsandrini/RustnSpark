import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PING_QUEUE_NAME } from '../queues.js';

// Throwaway proof-of-life job payload: `workMs` lets tests simulate an in-flight job long enough
// to exercise graceful-shutdown behaviour (SIGTERM must wait for it, not cut it off).
export interface PingJobData {
  queuedAt: number;
  workMs?: number;
}

export interface PingJobResult {
  processedAt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Proof-of-life processor for the worker entrypoint (S1.8). Remove once a real processor exists
// (plan S1.8) — this has no domain meaning of its own.
@Injectable()
@Processor(PING_QUEUE_NAME)
export class PingProcessor extends WorkerHost {
  private readonly logger = new Logger(PingProcessor.name);

  async process(job: Job<PingJobData>): Promise<PingJobResult> {
    this.logger.log(`processing ${job.name} #${job.id}`);
    if (job.data.workMs) {
      await sleep(job.data.workMs);
    }
    return { processedAt: Date.now() };
  }
}
