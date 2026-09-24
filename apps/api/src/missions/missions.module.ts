import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule, EnvService } from '../common/env/env.module.js';
import { ConfigModule } from '../config/config.module.js';
import { MissionProducer } from '../jobs/producers/mission.producer.js';
import {
  MISSION_QUEUE_NAME,
  RESOLVE_BACKOFF_BASE_MS,
  RESOLVE_JOB_ATTEMPTS,
  bullConnectionOptions,
} from '../jobs/queues.js';
import { PartsModule } from '../parts/parts.module.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { BoardService } from './board.service.js';
import { DispatchService } from './dispatch.service.js';
import { EncounterService } from './encounters/encounter.service.js';
import { RoutePresenceService } from './encounters/route-presence.service.js';
import { MissionsController } from './missions.controller.js';
import { MissionsService } from './missions.service.js';
import { MissionResolveService } from './resolve.service.js';

// The API process enqueues resolve jobs here (S7.2/S7.3 via MissionProducer); the worker
// process registers the same queue name with MissionProcessor inside JobsModule — separate
// processes, so each carries its own forRoot connection to the same Redis. defaultJobOptions
// give every enqueued resolve job the retry/backoff policy (S7.3) without call-site wiring.
// S7.4: MissionResolveService + Wallet/PlayerEvent are provided directly (not via
// PlayersModule) so resolve-on-read in getActive() works without pulling ShipsModule's
// controller/ownership graph into partial test graphs (board.int-spec).
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
    BullModule.registerQueue({
      name: MISSION_QUEUE_NAME,
      defaultJobOptions: {
        attempts: RESOLVE_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: RESOLVE_BACKOFF_BASE_MS },
      },
    }),
  ],
  controllers: [MissionsController],
  providers: [
    BoardService,
    MissionsService,
    DispatchService,
    MissionProducer,
    MissionResolveService,
    EncounterService,
    RoutePresenceService,
    WalletService,
    PlayerEventService,
  ],
  exports: [BoardService, MissionsService, DispatchService, MissionProducer],
})
export class MissionsModule {}
