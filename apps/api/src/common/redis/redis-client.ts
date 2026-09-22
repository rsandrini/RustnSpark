import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EnvService } from '../env/env.module.js';

// Lazy connect mirrors PrismaService: the constructor never touches the network,
// only onModuleInit does, so compiling a testing module never dials out.
@Injectable()
export class RedisClient extends Redis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClient.name);

  constructor(env: EnvService) {
    super(env.get('REDIS_URL'), { lazyConnect: true });
    // ioredis retries reconnecting on its own; without a listener an 'error' event
    // (e.g. Redis briefly unreachable) is an uncaught exception that crashes the process.
    this.on('error', (error: Error) => this.logger.error(error.message, 'connection error'));
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
