import { Module } from '@nestjs/common';
import { IdempotencyTestController } from './idempotency-test.controller.js';

// Test-only wiring for the IdempotencyInterceptor integration tests (S2.5's controller ruling):
// imported only through createTestApp's extraImports, never by the production AppModule — same
// pattern as ownership-test.module.ts (S2.4). The interceptor itself is a global APP_INTERCEPTOR
// in AppModule, so no provider registration is needed here.
@Module({
  controllers: [IdempotencyTestController],
})
export class IdempotencyTestModule {}
