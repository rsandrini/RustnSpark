import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ScrapPartResponseSchema, ScrapQuoteResponseSchema } from '@rustandspark/contract';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { assembleStarterKit } from '../support/assemble.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { contract } from '../support/contract.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

// Turn a loose part into scrap (round 2, item 2f): any loose part but the bridge, a result fixed
// per part, one grant however many times (or in parallel) it is asked.
describe('scrap a loose part', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
  });
  afterEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await testApp?.close();
  });

  async function onboard(): Promise<{ playerId: string; token: string; shipId: string }> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);
    return { playerId: seeded.player.id, token, shipId };
  }

  async function addLoose(playerId: string, partType: string, condition = 100): Promise<string> {
    const created = await prisma.partInstance.create({
      data: { partType, ownerPlayerId: playerId, condition, location: 'INVENTORY' },
    });
    return created.id;
  }

  async function scrapHeld(playerId: string): Promise<number> {
    const row = await prisma.playerMaterial.findUnique({
      where: { playerId_materialId: { playerId, materialId: 'scrap' } },
    });
    return row?.quantity ?? 0;
  }

  function quote(token: string, id: string) {
    return request(httpServer(testApp.app))
      .post(`/v1/inventory/${id}/scrap/quote`)
      .set(auth(token))
      .send();
  }

  function scrap(token: string, id: string, key: string = randomUUID()) {
    return request(httpServer(testApp.app))
      .post(`/v1/inventory/${id}/scrap`)
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send();
  }

  it('quotes the range and the odds for a loose part', async () => {
    const { playerId, token } = await onboard();
    const id = await addLoose(playerId, 'hull', 60);
    const response = await quote(token, id);
    expect(response.status).toBe(200);
    const body = contract(ScrapQuoteResponseSchema, response.body, 'scrap quote');
    expect(body.partInstanceId).toBe(id);
    expect(body.max).toBeGreaterThanOrEqual(body.min);
    expect(body.min).toBeGreaterThanOrEqual(1);
    expect(await prisma.partInstance.count({ where: { id } })).toBe(1);
  });

  it('destroys the part, grants the scrap and records one event; a replay returns the same body', async () => {
    const { playerId, token } = await onboard();
    const id = await addLoose(playerId, 'hull', 60);
    const before = await scrapHeld(playerId);
    const key = randomUUID();
    const first = await scrap(token, id, key);
    expect(first.status).toBe(200);
    const body = contract(ScrapPartResponseSchema, first.body, 'scrap');
    expect(body.pieces).toBe(body.base + body.bonus);
    expect(body.scrapHeld).toBe(before + body.pieces);
    expect(await prisma.partInstance.count({ where: { id } })).toBe(0);
    expect(await scrapHeld(playerId)).toBe(before + body.pieces);
    const events = await prisma.playerEvent.findMany({
      where: { playerId, type: 'inventory.scrap' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      partInstanceId: id,
      partType: 'hull',
      condition: 60,
      base: body.base,
      bonus: body.bonus,
      pieces: body.pieces,
    });

    const replay = await scrap(token, id, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await scrapHeld(playerId)).toBe(before + body.pieces);

    const again = await scrap(token, id);
    expect(again.status).toBe(404);
    expect(await scrapHeld(playerId)).toBe(before + body.pieces);
  });

  it('grants once when asked twice in parallel', async () => {
    const { playerId, token } = await onboard();
    const id = await addLoose(playerId, 'hull', 100);
    const before = await scrapHeld(playerId);
    const results = await Promise.all([scrap(token, id), scrap(token, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    const ok = results.find((r) => r.status === 200)!.body as { pieces: number };
    expect(await scrapHeld(playerId)).toBe(before + ok.pieces);
  });

  it('gives a part the same result however many copies of the same state exist', async () => {
    const { playerId, token } = await onboard();
    const id = await addLoose(playerId, 'hull', 100);
    const first = (await quote(token, id)).body as { min: number; max: number };
    const second = (await quote(token, id)).body as { min: number; max: number };
    expect(second).toEqual(first);
  });

  it('refuses an installed part, a bridge, a part in repair and a ship on a mission; hides another pilot part', async () => {
    const { playerId, token, shipId } = await onboard();

    const installed = await prisma.partInstance.findFirstOrThrow({
      where: { shipId, location: 'INSTALLED', partCatalog: { partClass: { not: 'BRIDGE' } } },
    });
    const onInstalled = await scrap(token, installed.id);
    expect(onInstalled.status).toBe(409);
    expect(onInstalled.body).toMatchObject({ message: { error: 'PART_INSTALLED' } });

    const bridgeCatalog = await prisma.partCatalog.findFirstOrThrow({
      where: { partClass: 'BRIDGE' },
    });
    const bridge = await addLoose(playerId, bridgeCatalog.partType);
    const onBridge = await scrap(token, bridge);
    expect(onBridge.status).toBe(409);
    expect(onBridge.body).toMatchObject({ message: { error: 'PART_NOT_SCRAPPABLE' } });

    const repairing = await addLoose(playerId, 'hull', 40);
    await prisma.repairJob.create({
      data: {
        shipId,
        playerId,
        targets: [{ partInstanceId: repairing, fromCondition: 40, toCondition: 100 }],
        cost: 1,
        durationSeconds: 60,
        status: 'PENDING',
        completesAt: new Date(Date.now() + 60_000),
      },
    });
    const onRepair = await scrap(token, repairing);
    expect(onRepair.status).toBe(409);
    expect(onRepair.body).toMatchObject({ message: { error: 'PART_IN_REPAIR' } });

    const loose = await addLoose(playerId, 'hull', 100);
    await prisma.ship.update({ where: { id: shipId }, data: { status: 'ON_MISSION' } });
    const onMission = await scrap(token, loose);
    expect(onMission.status).toBe(409);
    expect(onMission.body).toMatchObject({ message: { error: 'SHIP_ON_MISSION' } });
    expect(await prisma.partInstance.count({ where: { id: loose } })).toBe(1);
    expect(await scrapHeld(playerId)).toBe(0);

    const other = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const otherToken = await testApp.app.get(TokenService).signAccessToken({
      accountId: other.account.id,
      playerId: other.player.id,
      role: 'PLAYER',
    });
    expect((await scrap(otherToken, loose)).status).toBe(404);
    expect((await quote(otherToken, loose)).status).toBe(404);
  });
});
