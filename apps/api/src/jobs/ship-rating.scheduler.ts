import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
// Value imports, as in the reconcile scheduler: emitDecoratorMetadata cannot reference `import type`.
import { EnvService } from '../common/env/env.module.js';
import type { Queue } from 'bullmq';
import {
  SHIP_RATING_JOB_NAME,
  SHIP_RATING_QUEUE_NAME,
  SHIP_RATING_SCHEDULER_ID,
} from './queues.js';

// One BullMQ job scheduler, upserted on every worker boot (restarts never stack duplicates), fires the
// ship rating refresh every SHIP_RATING_INTERVAL_MS.
@Injectable()
export class ShipRatingScheduler implements OnModuleInit {
  private readonly logger = new Logger(ShipRatingScheduler.name);

  constructor(
    private readonly env: EnvService,
    @InjectQueue(SHIP_RATING_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const every = this.env.get('SHIP_RATING_INTERVAL_MS');
    await this.queue.upsertJobScheduler(
      SHIP_RATING_SCHEDULER_ID,
      { every },
      { name: SHIP_RATING_JOB_NAME, data: {} },
    );
    this.logger.log(`ship rating scheduler upserted (every ${every} ms)`);
  }
}
