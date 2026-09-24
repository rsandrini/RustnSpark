import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PartsModule } from '../parts/parts.module.js';
import { BoardService } from './board.service.js';
import { MissionsController } from './missions.controller.js';
import { MissionsService } from './missions.service.js';

@Module({
  imports: [ConfigModule, PartsModule],
  controllers: [MissionsController],
  providers: [BoardService, MissionsService],
  exports: [BoardService, MissionsService],
})
export class MissionsModule {}
