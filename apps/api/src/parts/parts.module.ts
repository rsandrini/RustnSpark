import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PartsController } from './parts.controller.js';
import { PartsService } from './parts.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [PartsController],
  providers: [PartsService],
  exports: [PartsService],
})
export class PartsModule {}
