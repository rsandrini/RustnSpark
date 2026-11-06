import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  GUEST_FREEZE_INTERVAL_MS,
  GUEST_FREEZE_JOB_NAME,
  GUEST_FREEZE_QUEUE_NAME,
  GUEST_FREEZE_SCHEDULER_ID,
} from './queues.js';

// One BullMQ job scheduler, upserted on every worker boot (restarts never stack duplicates).
@Injectable()
export class GuestFreezeScheduler implements OnModuleInit {
  private readonly logger = new Logger(GuestFreezeScheduler.name);

  constructor(@InjectQueue(GUEST_FREEZE_QUEUE_NAME) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      GUEST_FREEZE_SCHEDULER_ID,
      { every: GUEST_FREEZE_INTERVAL_MS },
      { name: GUEST_FREEZE_JOB_NAME, data: {} },
    );
    this.logger.log(`guest freeze scheduler upserted (every ${GUEST_FREEZE_INTERVAL_MS} ms)`);
  }
}
