import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { DispatchJobData } from '../../missions/dispatch.service.js';
import { MISSION_QUEUE_NAME, RESOLVE_JOB_NAME } from '../queues.js';

// Producer side of the resolve pipeline (plan S7.3): DispatchService enqueues AFTER its
// transaction commits, with jobId = missionId so a re-dispatch of the same mission can never
// double-enqueue while the first job is still pending. Retry/backoff defaults come from the
// MissionsModule registerQueue options, not from call sites.
@Injectable()
export class MissionProducer {
  constructor(
    @InjectQueue(MISSION_QUEUE_NAME) private readonly queue: Queue<DispatchJobData>,
  ) {}

  enqueueResolve(data: DispatchJobData, delayMs: number): Promise<Job<DispatchJobData>> {
    return this.queue.add(RESOLVE_JOB_NAME, data, {
      delay: Math.max(0, delayMs),
      jobId: data.missionId,
    });
  }
}
