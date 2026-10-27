import { Module } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import { PlayerStatsService } from './player-stats.service.js';

// Imported by every module that records a number: the wallet's homes (players, missions, economy,
// parts, jobs) and auth (last active). The profile endpoints join this module later.
@Module({
  providers: [PlayerStatsService, Clock],
  exports: [PlayerStatsService],
})
export class StatsModule {}
