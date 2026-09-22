import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EnvModule, EnvService } from '../common/env/env.module.js';
import { PingProcessor } from './processors/ping.processor.js';
import { bullConnectionOptions, PING_QUEUE_NAME } from './queues.js';

// Imported directly by worker.ts to build the worker application context (no HTTP server).
// EnvModule is imported here (not just relied on as @Global from elsewhere) because this module
// also stands alone as the whole graph for `NestFactory.createApplicationContext(JobsModule)`.
// The PingProcessor provider is what turns the registered queue into a live Worker (BullExplorer
// only starts a Worker for queues that have a @Processor-decorated provider in the graph); a
// consumer that only wants to enqueue jobs (a future API producer) can build its own bullmq Queue
// from queues.ts without pulling in this processor.
@Module({
  imports: [
    EnvModule,
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        connection: bullConnectionOptions(env.get('REDIS_URL')),
      }),
    }),
    BullModule.registerQueue({ name: PING_QUEUE_NAME }),
  ],
  providers: [PingProcessor],
})
export class JobsModule {}
