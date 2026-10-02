import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PartsModule } from '../parts/parts.module.js';
import { ShipFormatsController } from './ship-formats.controller.js';
import { ShipsController } from './ships.controller.js';
import { ShipsService } from './ships.service.js';

@Module({
  imports: [ConfigModule, PartsModule],
  controllers: [ShipsController, ShipFormatsController],
  providers: [ShipsService],
  exports: [ShipsService],
})
export class ShipsModule {}
