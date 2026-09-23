import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const MIGRATION_SQL = `UPDATE "PartCatalog"
SET "structureCost" = -100
WHERE "partType" = 'bridge' AND "structureCost" = 0;`;

interface ShipSheetResponse {
  fuelCap: number;
  pot: number;
  hp: number;
  mob: number;
  structureBudget: number;
  structureUsed: number;
}

interface ShipResponse {
  id: string;
  ownerPlayerId: string;
  name: string;
  fuel: number;
  status: string;
  currentLocationId: string;
  stance: string;
  layout: Array<Record<string, unknown>>;
  sheet: ShipSheetResponse;
}

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function asShip(response: request.Response): ShipResponse {
  return response.body as ShipResponse;
}

describe('bridge structure budget fix migration (S4 C1)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    if (prisma) await resetDatabase(prisma);
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
  }

  async function tokenForPlayer(): Promise<string> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const tokenService = testApp.app.get(TokenService);
    return tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
  }

  it('migrates an old bridge structureCost from 0 to -100 and makes onboarding viable', async () => {
    await freshSeededApp();

    const before = await prisma.partCatalog.findUnique({ where: { partType: 'bridge' } });
    expect(before?.structureCost).toBe(-100);

    const otherBefore = await prisma.partCatalog.findMany({
      where: { partType: { not: 'bridge' } },
      select: { partType: true, structureCost: true },
    });
    expect(otherBefore.length).toBeGreaterThan(0);

    await prisma.partCatalog.update({
      where: { partType: 'bridge' },
      data: { structureCost: 0 },
    });

    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    const after = await prisma.partCatalog.findUnique({ where: { partType: 'bridge' } });
    expect(after?.structureCost).toBe(-100);

    const otherAfter = await prisma.partCatalog.findMany({
      where: { partType: { not: 'bridge' } },
      select: { partType: true, structureCost: true },
    });
    const beforeByType = new Map(otherBefore.map((p) => [p.partType, p.structureCost]));
    for (const part of otherAfter) {
      expect(part.structureCost).toBe(beforeByType.get(part.partType));
    }

    const token = await tokenForPlayer();
    const response = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });

    expect(response.status).toBe(200);
    const ship = asShip(response);
    expect(ship.sheet.structureBudget).toBe(100);
    expect(ship.sheet.structureUsed).toBeLessThanOrEqual(ship.sheet.structureBudget);
    expect(ship.sheet.hp).toBeGreaterThan(0);
  });
});
