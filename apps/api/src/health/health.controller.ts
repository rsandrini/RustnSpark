import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

// No auth guard is applied here (none exists globally yet): this route is reachable without
// authentication by construction. S2.4's global guard rollout must add an explicit exemption
// for GET /v1/health when it lands, or this route will start requiring a token by accident.
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.redisIndicator.pingCheck('redis'),
    ]);
  }
}
