import { Module } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import { ConfigModule } from '../config/config.module.js';
import { PlayerStatsService } from './player-stats.service.js';
import { ProfileService } from './profile.service.js';
import { RankingsController } from './rankings.controller.js';
import { RankingsService } from './rankings.service.js';
import { StatsController } from './stats.controller.js';

// Imported by every module that records a number: the wallet's homes (players, missions, economy,
// parts, jobs) and auth (last active). The controller serves the pilot card and the own numbers.
@Module({
  imports: [ConfigModule],
  controllers: [StatsController, RankingsController],
  providers: [PlayerStatsService, ProfileService, RankingsService, Clock],
  exports: [PlayerStatsService],
})
export class StatsModule {}
