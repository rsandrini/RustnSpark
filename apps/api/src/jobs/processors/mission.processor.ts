import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { DispatchJobData } from '../../missions/dispatch.service.js';
// Constructor-injected services must be value imports: emitDecoratorMetadata cannot
// reference `import type` bindings, so the worker's DI graph would see `Object`/`?`
// instead of the classes (JobsModule boot fails without this).
import { MissionResolveService } from '../../missions/resolve.service.js';
import type { ResolveJobResult } from '../../missions/resolve.service.js';
import { MISSION_QUEUE_NAME } from '../queues.js';

// Worker-side adapter for the shared resolve pipeline (plan S7.3): BullMQ hands the job
// to this @Processor, which forwards job.data to MissionResolveService.resolve() — the
// same entry the reconciler and resolve-on-read use, so all three paths claim, snapshot,
// and write effects identically.
@Processor(MISSION_QUEUE_NAME)
@Injectable()
export class MissionProcessor extends WorkerHost {
  constructor(private readonly resolveService: MissionResolveService) {
    super();
  }

  process(job: Job<DispatchJobData>): Promise<ResolveJobResult> {
    return this.resolveService.resolve(job.data);
  }
}
