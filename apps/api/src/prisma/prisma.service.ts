import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EnvService } from '../common/env/env.module.js';

// Prisma sizes its pool at cpus * 2 + 1 unless the URL says otherwise: 5 connections on a 2-core
// runner. A mission resolution holds one connection for its whole transaction and still reads
// through the shared client (encounters, parts), so a few concurrent resolutions used up the pool
// and every one of them waited for a connection that only another could release.
const DEFAULT_POOL_SIZE = 20;

/** The URL with an explicit pool size, unless it already carries one. */
export function withPoolSize(url: string, size: number = DEFAULT_POOL_SIZE): string {
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${size}`;
}

// Wraps PrismaClient as a Nest provider so every domain module injects one shared connection.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(env: EnvService) {
    super({ datasourceUrl: withPoolSize(env.get('DATABASE_URL')) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
