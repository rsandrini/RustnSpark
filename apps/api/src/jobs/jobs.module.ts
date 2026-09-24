import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule, EnvService } from '../common/env/env.module.js';
import { ConfigModule } from '../config/config.module.js';
import { PartsService } from '../parts/parts.service.js';
import { MissionResolveService } from '../missions/resolve.service.js';
import { EncounterService } from '../missions/encounters/encounter.service.js';
import { RoutePresenceService } from '../missions/encounters/route-presence.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { RepairService } from '../economy/repair.service.js';
import { MissionProcessor } from './processors/mission.processor.js';
import { PingProcessor } from './processors/ping.processor.js';
import { ReconcileProcessor } from './processors/reconcile.processor.js';
import { RepairProcessor } from './processors/repair.processor.js';
import { ReconcileScheduler } from './reconcile.scheduler.js';
import {
  MISSION_QUEUE_NAME,
  PING_QUEUE_NAME,
  RECONCILE_QUEUE_NAME,
  REPAIR_QUEUE_NAME,
  RESOLVE_BACKOFF_BASE_MS,
  RESOLVE_JOB_ATTEMPTS,
  bullConnectionOptions,
} from './queues.js';

// Imported directly by worker.ts to build the worker application context (no HTTP server).
// EnvModule is imported here (not just relied on as @Global from elsewhere) because this module
// also stands alone as the whole graph for `NestFactory.createApplicationContext(JobsModule)`.
// The PingProcessor provider is what turns the registered queue into a live Worker (BullExplorer
// only starts a Worker for queues that have a @Processor-decorated provider in the graph); a
// consumer that only wants to enqueue jobs (a future API producer) can build its own bullmq Queue
// from queues.ts without pulling in this processor.
// S7.3: MissionProcessor joins the graph with its DB/config/wallet dependencies provided
// directly here — the worker never imports PlayersModule/ShipsModule (their controllers and
// resolver registration belong to the API process), and ConfigModule pulls in the global
// Prisma/Redis/Env modules this standalone context needs.
// S7.4: ReconcileProcessor + ReconcileScheduler join with MissionResolveService and
// PartsService provided directly (same rationale — no controllers in the worker graph);
// the scheduler upserts one repeatable tick every RECONCILE_INTERVAL_MS on boot.
@Module({
  imports: [
    EnvModule,
    ConfigModule,
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        connection: bullConnectionOptions(env.get('REDIS_URL')),
      }),
    }),
    BullModule.registerQueue({ name: PING_QUEUE_NAME }),
    BullModule.registerQueue({
      name: MISSION_QUEUE_NAME,
      defaultJobOptions: {
        attempts: RESOLVE_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: RESOLVE_BACKOFF_BASE_MS },
      },
    }),
    BullModule.registerQueue({ name: RECONCILE_QUEUE_NAME }),
    BullModule.registerQueue({ name: REPAIR_QUEUE_NAME }),
  ],
  providers: [
    PingProcessor,
    MissionProcessor,
    ReconcileProcessor,
    RepairProcessor,
    ReconcileScheduler,
    MissionResolveService,
    EncounterService,
    RoutePresenceService,
    PartsService,
    WalletService,
    PlayerEventService,
    RepairService,
  ],
})
export class JobsModule {}
