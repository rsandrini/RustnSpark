import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Idempotent } from '../../src/common/idempotency/idempotent.decorator.js';

// The whitelist ValidationPipe (validation.config.ts) rejects any property outside these two —
// which is also the mechanism that answers the plan's "forged credits in any body → 400" rule
// until real wallet endpoints exist (S2.5 ruling): `credits` here is a non-whitelisted property.
export class IdempotentEchoDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  latchKey?: string;
}

// Test-only controller (never imported by AppModule): gives the global IdempotencyInterceptor a
// real @Idempotent() route to act on, since no production route is decorated yet. The execution
// counter lets tests prove the handler ran exactly once; `latchKey` parks the handler on a
// test-released latch so the concurrency test can race a second same-key request against the
// winner's pending row with zero wall-clock timing assumptions.
@Controller('test/idempotency')
export class IdempotencyTestController {
  executions = 0;
  private readonly latches = new Map<string, () => void>();

  @Post('echo')
  @HttpCode(200)
  @Idempotent()
  async echo(@Body() dto: IdempotentEchoDto): Promise<{ seq: number; label: string | null }> {
    this.executions += 1;
    const seq = this.executions;
    if (dto.latchKey) {
      await new Promise<void>((resolve) => this.latches.set(dto.latchKey as string, resolve));
    }
    return { seq, label: dto.label ?? null };
  }

  releaseLatch(latchKey: string): void {
    this.latches.get(latchKey)?.();
    this.latches.delete(latchKey);
  }

  // between tests; releasing parked latches means a failed concurrency test can never wedge the app
  reset(): void {
    this.executions = 0;
    for (const release of this.latches.values()) release();
    this.latches.clear();
  }
}
