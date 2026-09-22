import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from './common/guards/throttler.guard.js';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor.js';
import { EnvModule } from './common/env/env.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';

// AllExceptionsFilter is bound in main.ts instead of here: it needs HttpAdapterHost, which is
// only populated once NestFactory.create() sets up the platform adapter, not during a bare
// Test.createTestingModule().compile() used by unit tests such as app.module.spec.ts.
@Module({
  imports: [EnvModule, PrismaModule, RedisModule, HealthModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
