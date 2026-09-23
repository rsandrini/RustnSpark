import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './guards/admin.guard.js';
import { BundleService } from './tuning/bundle.service.js';
import { ConfigTuningController } from './tuning/config-tuning.controller.js';
import { ConfigTuningService } from './tuning/config-tuning.service.js';
import { EntityTuningController } from './tuning/entity-tuning.controller.js';
import { EntityTuningService } from './tuning/entity-tuning.service.js';
import { RevisionService } from './tuning/revision.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [AdminController, ConfigTuningController, EntityTuningController],
  providers: [AdminGuard, ConfigTuningService, EntityTuningService, RevisionService, BundleService],
})
export class AdminModule {}
