import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
// Constructor-injected services must be value imports: emitDecoratorMetadata cannot
// reference `import type` bindings, so the DI graph would see `Object`/`?` instead of
// the class (JobsModule boot fails without this).
import { EnvService } from '../common/env/env.module.js';
import type { Queue } from 'bullmq';
import { RECONCILE_QUEUE_NAME, RECONCILE_SCHEDULER_ID, RECONCILE_TICK_JOB_NAME } from './queues.js';

// S7.4 / D4: one BullMQ job scheduler, upserted idempotently on every worker boot, fires
// RECONCILE_TICK_JOB_NAME every RECONCILE_INTERVAL_MS (default 30 s). A server that was
// down at arrivalAt therefore gets its first reconcile within one interval of the next
// boot; upsertJobScheduler's override semantics keep restarts from stacking duplicates.
@Injectable()
export class ReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReconcileScheduler.name);

  constructor(
    private readonly env: EnvService,
    @InjectQueue(RECONCILE_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const every = this.env.get('RECONCILE_INTERVAL_MS');
    await this.queue.upsertJobScheduler(
      RECONCILE_SCHEDULER_ID,
      { every },
      { name: RECONCILE_TICK_JOB_NAME, data: {} },
    );
    this.logger.log(`reconcile scheduler upserted (every ${every} ms)`);
  }
}
