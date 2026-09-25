import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module.js';
import { WorldController } from './world.controller.js';
import { WorldService } from './world.service.js';

@Module({
  imports: [MissionsModule],
  controllers: [WorldController],
  providers: [WorldService],
})
export class WorldModule {}
