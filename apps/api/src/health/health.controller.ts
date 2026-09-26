import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

// Explicit exemption from the global JwtAuthGuard (S2.4): this route must stay reachable with
// no Authorization header, or the Docker healthchecks (compose.yaml) and CI break.
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  // Readiness: the process AND the things it cannot serve without (Postgres, Redis). Point a load
  // balancer's "send traffic here?" probe at this. `/health` is the same check under its original
  // name, which compose's healthcheck and the CI smoke already use.
  @Get()
  @HealthCheck()
  check() {
    return this.ready();
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.redisIndicator.pingCheck('redis'),
    ]);
  }

  // Liveness: the event loop answers. Deliberately touches NO dependency, so a database or Redis
  // outage makes the instance unready (traffic stops) without an orchestrator restart loop
  // that would only add load to a dependency that is already down.
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
