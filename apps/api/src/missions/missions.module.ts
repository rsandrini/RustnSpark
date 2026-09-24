import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule, EnvService } from '../common/env/env.module.js';
import { ConfigModule } from '../config/config.module.js';
import { MISSION_QUEUE_NAME, bullConnectionOptions } from '../jobs/queues.js';
import { PartsModule } from '../parts/parts.module.js';
import { BoardService } from './board.service.js';
import { DispatchService } from './dispatch.service.js';
import { MissionsController } from './missions.controller.js';
import { MissionsService } from './missions.service.js';

// The API process enqueues resolve jobs here (S7.2); the worker process registers the same
// queue name with its own processor (S7.3) inside JobsModule — separate processes, so each
// carries its own forRoot connection to the same Redis.
@Module({
  imports: [
    ConfigModule,
    PartsModule,
    EnvModule,
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        connection: bullConnectionOptions(env.get('REDIS_URL')),
      }),
    }),
    BullModule.registerQueue({ name: MISSION_QUEUE_NAME }),
  ],
  controllers: [MissionsController],
  providers: [BoardService, MissionsService, DispatchService],
  exports: [BoardService, MissionsService, DispatchService],
})
export class MissionsModule {}
