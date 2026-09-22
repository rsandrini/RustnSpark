import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthCheckService, PrismaHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

// Mirrors the real generated PrismaClient on a non-mongo datasource: terminus's
// PrismaHealthIndicator tries $runCommandRaw first and falls back to $queryRawUnsafe on this exact message.
function makePrismaMock(queryRawUnsafe: () => Promise<unknown>) {
  return {
    $runCommandRaw: jest.fn(() =>
      Promise.reject(
        new Error(
          'The postgresql provider does not support $runCommandRaw. Use the mongodb provider.',
        ),
      ),
    ),
    $queryRawUnsafe: jest.fn(queryRawUnsafe),
  };
}

describe('HealthController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports up when both prisma and redis pings succeed', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: makePrismaMock(() => Promise.resolve([{ '1': 1 }])) },
        {
          provide: RedisHealthIndicator,
          useValue: { pingCheck: () => ({ redis: { status: 'up' } }) },
        },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.details.database.status).toBe('up');
    expect(result.details.redis.status).toBe('up');
  });

  it('reports the overall check as failing when redis is down', async () => {
    // Terminus logs the failure via Nest's default console Logger; keep test output pristine.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: makePrismaMock(() => Promise.resolve([{ '1': 1 }])) },
        {
          provide: RedisHealthIndicator,
          useValue: {
            pingCheck: () => ({ redis: { status: 'down', message: 'connection refused' } }),
          },
        },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);

    await expect(controller.check()).rejects.toMatchObject({
      response: expect.objectContaining({ status: 'error' }),
    });
  });

  it('injects the built-in PrismaHealthIndicator from TerminusModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: RedisHealthIndicator, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(HealthCheckService)).toBeInstanceOf(HealthCheckService);
    expect(moduleRef.get(PrismaHealthIndicator)).toBeInstanceOf(PrismaHealthIndicator);
  });
});
