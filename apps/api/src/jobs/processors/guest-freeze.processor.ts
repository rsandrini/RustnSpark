import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { captureJobFailure } from '../../common/observability/sentry.js';
// Constructor-injected services must be value imports (emitDecoratorMetadata), like the other processors.
import { GuestFreezeService } from '../../auth/guest-freeze.service.js';
import { GUEST_FREEZE_QUEUE_NAME } from '../queues.js';

// Freezes the guests nobody claimed and nobody plays (nothing is deleted).
@Processor(GUEST_FREEZE_QUEUE_NAME)
@Injectable()
export class GuestFreezeProcessor extends WorkerHost {
  @OnWorkerEvent('failed')
  onFailed(job: { id?: string | undefined } | undefined, error: Error): void {
    captureJobFailure(GUEST_FREEZE_QUEUE_NAME, job?.id, error);
  }

  private readonly logger = new Logger(GuestFreezeProcessor.name);

  constructor(private readonly guests: GuestFreezeService) {
    super();
  }

  async process(): Promise<{ frozen: number }> {
    const frozen = await this.guests.freezeIdle();
    if (frozen > 0) this.logger.log(`froze ${frozen} idle guest(s)`);
    return { frozen };
  }
}
