import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { BoardService } from './board.service.js';

// S6.2 ships the board only; S6.4 adds the state machine, service and controller
// (accept/hold endpoints) to this same module.
@Module({
  imports: [ConfigModule],
  providers: [BoardService],
  exports: [BoardService],
})
export class MissionsModule {}
