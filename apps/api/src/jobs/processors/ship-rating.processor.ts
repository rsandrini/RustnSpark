import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
// Constructor-injected services must be value imports (emitDecoratorMetadata), like the other processors.
import { ShipRatingService } from '../../stats/ship-rating.service.js';
import { SHIP_RATING_QUEUE_NAME } from '../queues.js';

// Refreshes every pilot's ShipRating snapshot, which the ship power and speed boards rank.
@Processor(SHIP_RATING_QUEUE_NAME)
@Injectable()
export class ShipRatingProcessor extends WorkerHost {
  private readonly logger = new Logger(ShipRatingProcessor.name);

  constructor(private readonly ratings: ShipRatingService) {
    super();
  }

  async process(): Promise<{ rated: number }> {
    const rated = await this.ratings.refreshAll();
    this.logger.log(`ship ratings refreshed (${rated} ships)`);
    return { rated };
  }
}
