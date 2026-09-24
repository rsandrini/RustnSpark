import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
// Constructor-injected services must be value imports: emitDecoratorMetadata cannot
// reference `import type` bindings, so the worker's DI graph would see `Object`/`?`
// instead of the classes (JobsModule boot fails without this).
import { RepairService } from '../../economy/repair.service.js';
import { REPAIR_QUEUE_NAME } from '../queues.js';

export interface RepairJobData {
  readonly repairJobId: string;
}

// Worker-side adapter for S8.4: BullMQ hands the delayed job to this @Processor, which
// forwards to RepairService.complete() — the same idempotent PENDING → COMPLETED claim
// the reconciler uses for lost repair jobs.
@Processor(REPAIR_QUEUE_NAME)
@Injectable()
export class RepairProcessor extends WorkerHost {
  constructor(private readonly repairService: RepairService) {
    super();
  }

  process(job: Job<RepairJobData>): Promise<{ applied: boolean }> {
    return this.repairService.complete(job.data.repairJobId);
  }
}
