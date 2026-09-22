import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from './common/guards/throttler.guard.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { OwnershipResolverModule } from './common/guards/ownership-resolver.module.js';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor.js';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor.js';
import { EnvModule } from './common/env/env.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlayersModule } from './players/players.module.js';
import { TokenService } from './auth/token.service.js';

// AllExceptionsFilter is bound in main.ts instead of here: it needs HttpAdapterHost, which is
// only populated once NestFactory.create() sets up the platform adapter, not during a bare
// Test.createTestingModule().compile() used by unit tests such as app.module.spec.ts.
@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    OwnershipResolverModule,
    HealthModule,
    AuthModule,
    PlayersModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    // Global like the guards below (S2.5): passes every route straight through except the ones
    // decorated @Idempotent(), which then require an Idempotency-Key and get R21 replay semantics.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // R28: JwtAuthGuard is registered after ThrottlerGuard, never before or in place of it, so
    // throttling still sees every request, including ones this guard is about to reject with 401.
    // Default-deny: every route requires a valid access token unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Provided here only so the global JwtAuthGuard above can inject it; S2.3's future
    // AuthModule will add its own instance for its controllers (TokenService is stateless, so a
    // second instance is harmless).
    TokenService,
  ],
})
export class AppModule {}
