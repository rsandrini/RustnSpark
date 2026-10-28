import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { ShipsModule } from '../ships/ships.module.js';
import { ShipRatingService } from './ship-rating.service.js';

// Apart from StatsModule on purpose: ships import parts, which import StatsModule, so StatsModule
// cannot import ships back.
@Module({
  imports: [ConfigModule, ShipsModule],
  providers: [ShipRatingService],
  exports: [ShipRatingService],
})
export class ShipRatingModule {}
