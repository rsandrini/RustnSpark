import { Module } from '@nestjs/common';
import { PartsController } from './parts.controller.js';
import { PartsService } from './parts.service.js';

@Module({
  controllers: [PartsController],
  providers: [PartsService],
  exports: [PartsService],
})
export class PartsModule {}
