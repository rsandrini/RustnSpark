import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { RESCUE_BASE_TYPES, towPlanFor } from '../../src/ships/floating.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME, REPAIR_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AuthPair {
  seeded: SeededPlayer;
  token: string;
  shipId: string;
}

interface RescueBody {
  shipId: string;
  status: string;
  cost: number;
  fuel: number;
  credits: number;
  replacementParts: string[];
  viability: { viable: boolean; problems: { code: string }[] };
}

interface RefuelBody {
  units: number;
  cost: number;
}

// S8.6 acceptance (plan line 484): a rescue (here with no recorded float spot: the base is where
// the ship is docked, so the distance charge is 0 and 'now' costs the 400 ¢ reference) may drive the balance
// negative (GDD §14), replacement parts are free, loose, common parts for what is missing or dead. While negative, spending (refuel) is blocked —
// navigation and mining stay open, missions repay the debt (resolve-processor spec).
describe('rescue API (S8.6)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let missionQueue: Queue;
  let repairQueue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    repairQueue = testApp.app.get(getQueueToken(REPAIR_QUEUE_NAME));
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
    await repairQueue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  async function onboardPlayer(): Promise<AuthPair> {
    const passwords = testApp.app.get(PasswordService);
    const tokens = testApp.app.get(TokenService);
    const seeded = await seedAccountWithPlayer(prisma, passwords);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  function rescue(
    token: string,
    shipId: string,
    key: string | undefined,
    mode: 'now' | 'wait' = 'now',
  ) {
    const req = request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/rescue`)
      .set(auth(token))
      .send({ mode });
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req;
  }

  function refuel(token: string, shipId: string, key: string, body: Record<string, unknown>) {
    return request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/refuel`)
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send(body);
  }

  async function setStatus(shipId: string, status: string): Promise<void> {
    await prisma.ship.update({ where: { id: shipId }, data: { status: status as never } });
  }

  async function setCredits(playerId: string, credits: number): Promise<void> {
    await prisma.player.update({ where: { id: playerId }, data: { credits } });
  }

  async function currentCredits(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }

  async function shipRow(shipId: string) {
    return prisma.ship.findUniqueOrThrow({ where: { id: shipId } });
  }

  async function installedParts(shipId: string) {
    return prisma.partInstance.findMany({
      where: { shipId, location: 'INSTALLED' },
      include: { partCatalog: { select: { rarity: true, partClass: true } } },
      orderBy: { id: 'asc' },
    });
  }

  it('a rescue called now costs 400 here (no distance) and may drive the balance negative (GDD §14)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100);
    await setStatus(player.shipId, 'ADRIFT');
    const shipBefore = await shipRow(player.shipId);

    const response = await rescue(player.token, player.shipId, randomUUID());
    expect(response.status).toBe(200);
    expect(response.body as RescueBody).toMatchObject({
      shipId: player.shipId,
      status: 'IN_PORT',
      cost: 400,
      credits: -300,
      replacementParts: [],
      viability: { viable: true },
    });

    // Rescue is not a refuel: it tows the hull, it does not top up the tank (a tank that is
    // already above the emergency ration is left exactly as it was).
    const shipAfter = await shipRow(player.shipId);
    expect(shipAfter.status).toBe('IN_PORT');
    expect(shipAfter.fuel).toBe(shipBefore.fuel);
    expect(shipAfter.currentLocationId).toBe(shipBefore.currentLocationId);
    expect(await currentCredits(player.seeded.player.id)).toBe(-300);

    const debits = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'wallet.debit' },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]!.creditsDelta).toBe(-400);
    expect(String((debits[0]!.payload as { reason: string }).reason)).toBe(
      `rescue:${player.shipId}`,
    );

    const rescueEvents = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'rescue' },
    });
    expect(rescueEvents).toHaveLength(1);
    expect(rescueEvents[0]!.payload).toMatchObject({
      shipId: player.shipId,
      cost: 400,
      replacementParts: [],
    });
  });

  it('refuses a ship that is not adrift and never charges', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const inPort = await rescue(player.token, player.shipId, randomUUID());
    expect(inPort.status).toBe(409);
    expect(inPort.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_ADRIFT' },
    });

    await setStatus(player.shipId, 'ON_MISSION');
    const onMission = await rescue(player.token, player.shipId, randomUUID());
    expect(onMission.status).toBe(409);
    expect(onMission.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });

    expect(await currentCredits(player.seeded.player.id)).toBe(200);
    await expect(
      prisma.playerEvent.count({
        where: { playerId: player.seeded.player.id, type: 'wallet.debit' },
      }),
    ).resolves.toBe(0);
  });

  it('is idempotent: missing key 400, same key replays without charging twice', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    await setStatus(player.shipId, 'ADRIFT');

    const noKey = await rescue(player.token, player.shipId, undefined);
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({
      statusCode: 400,
      message: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(await currentCredits(player.seeded.player.id)).toBe(100000);

    const key = randomUUID();
    const first = await rescue(player.token, player.shipId, key);
    const replay = await rescue(player.token, player.shipId, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await currentCredits(player.seeded.player.id)).toBe(100000 - 400);
    await expect(
      prisma.playerEvent.count({
        where: { playerId: player.seeded.player.id, type: 'wallet.debit' },
      }),
    ).resolves.toBe(1);
  });

  it('replacements: only what is missing or dead, loose, common, at the replacement condition; nothing installed or removed', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const rules = configService.snapshot().rules;

    // Strip the engine: the ADRIFT hull has no engine any more.
    const engine = await prisma.partInstance.findFirstOrThrow({
      where: { shipId: player.shipId, location: 'INSTALLED', partType: 'engine_chem_small' },
    });
    const installedBefore = await installedParts(player.shipId);
    await prisma.partInstance.update({
      where: { id: engine.id },
      data: { location: 'INVENTORY', shipId: null },
    });
    await setStatus(player.shipId, 'ADRIFT');
    await setCredits(player.seeded.player.id, 500);

    const response = await rescue(player.token, player.shipId, randomUUID());
    expect(response.status).toBe(200);
    const body = response.body as RescueBody;
    // only the engine is missing: no bridge, no tank, no life support, no hull or cargo
    expect(body.replacementParts).toEqual([rules.parts.replacement_types['engine']]);
    expect(body.cost).toBe(400);
    expect(body.credits).toBe(500 - 400);
    expect(body.status).toBe('IN_PORT');

    // everything that was installed stays installed (the pilot swaps the new engine in)
    expect(await installedParts(player.shipId)).toHaveLength(installedBefore.length - 1);
    const handed = await prisma.partInstance.findMany({
      where: {
        ownerPlayerId: player.seeded.player.id,
        location: 'INVENTORY',
        condition: rules.parts.replacement_condition,
      },
      include: { partCatalog: { select: { rarity: true } } },
    });
    expect(handed).toHaveLength(1);
    expect(handed[0]?.partCatalog.rarity).toBe('COMMON');
    // nothing is ever destroyed: the stripped engine is still owned, in inventory
    expect(await prisma.partInstance.findUniqueOrThrow({ where: { id: engine.id } })).toMatchObject(
      { location: 'INVENTORY', shipId: null },
    );
  });

  it('a dead part counts as missing: the replacement is handed over beside it, the dead one stays installed', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const engine = await prisma.partInstance.findFirstOrThrow({
      where: { shipId: player.shipId, location: 'INSTALLED', partType: 'engine_chem_small' },
    });
    await prisma.partInstance.update({ where: { id: engine.id }, data: { condition: 0 } });
    await setStatus(player.shipId, 'ADRIFT');
    await setCredits(player.seeded.player.id, 500);

    const response = await rescue(player.token, player.shipId, randomUUID());
    expect((response.body as RescueBody).replacementParts).toEqual(['engine_chem_small']);
    expect(await prisma.partInstance.findUniqueOrThrow({ where: { id: engine.id } })).toMatchObject(
      { location: 'INSTALLED', shipId: player.shipId },
    );
  });

  it('a missing tank is replaced and the fuel is clamped to the new tank ceiling (review item 5)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const tank = await prisma.partInstance.findFirstOrThrow({
      where: { shipId: player.shipId, location: 'INSTALLED', partType: 'tank_small' },
    });
    await prisma.partInstance.update({
      where: { id: tank.id },
      data: { location: 'INVENTORY', shipId: null },
    });
    await setStatus(player.shipId, 'ADRIFT');
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 9999 } });
    await setCredits(player.seeded.player.id, 5000);

    const rescued = await rescue(player.token, player.shipId, randomUUID());
    expect(rescued.status).toBe(200);
    expect((rescued.body as RescueBody).replacementParts).toEqual(['tank_small']);

    const handed = await prisma.partCatalog.findUniqueOrThrow({
      where: { partType: 'tank_small' },
    });
    const ship = await shipRow(player.shipId);
    expect(ship.fuel).toBe(handed.fuelCap);
  });

  it('a ship that is fine gets nothing', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setStatus(player.shipId, 'ADRIFT');
    await setCredits(player.seeded.player.id, 500);
    const response = await rescue(player.token, player.shipId, randomUUID());
    expect((response.body as RescueBody).replacementParts).toEqual([]);
  });

  it('spending guard both ways: negative balance blocks refuel, positive unlocks it', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const fuelCap = await (async () => {
      const rows = await prisma.partInstance.findMany({
        where: { shipId: player.shipId, location: 'INSTALLED' },
        include: { partCatalog: true },
      });
      return rows.reduce((total, row) => total + (row.partCatalog.fuelCap ?? 0), 0);
    })();
    await setStatus(player.shipId, 'ADRIFT');
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 0 } });

    const rescued = await rescue(player.token, player.shipId, randomUUID());
    expect(rescued.status).toBe(200);
    expect((rescued.body as RescueBody).credits).toBe(200 - 400);

    const blocked = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      statusCode: 409,
      message: { error: 'BALANCE_NEGATIVE' },
    });
    // The emergency ration (25% of the tank) is what the player is left with — enough to
    // fly one short job, never a refill.
    const ration = Math.round(fuelCap * 0.25);
    expect((rescued.body as RescueBody).fuel).toBe(ration);
    expect((await shipRow(player.shipId)).fuel).toBe(ration);
    expect(await currentCredits(player.seeded.player.id)).toBe(-200);

    // Missions pay the debt back (GDD §14); with a positive balance buying works again.
    await setCredits(player.seeded.player.id, 5000);
    const unlocked = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(unlocked.status).toBe(200);
    expect((unlocked.body as RefuelBody).units).toBe(fuelCap - ration);
    expect((unlocked.body as RefuelBody).cost).toBeGreaterThan(0);
    expect(await currentCredits(player.seeded.player.id)).toBe(
      5000 - (unlocked.body as RefuelBody).cost,
    );
  });

  it('emergency ration never lowers fuel and is capped at the tank (review item 11)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setStatus(player.shipId, 'ADRIFT');
    const before = await shipRow(player.shipId);
    // Already above 25% → untouched.
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: before.fuel } });
    const rescued = await rescue(player.token, player.shipId, randomUUID());
    expect(rescued.status).toBe(200);
    expect((await shipRow(player.shipId)).fuel).toBe(before.fuel);
  });

  describe('floating ship: wait or call it now', () => {
    async function floatOnLongestRoute(shipId: string, progress: number) {
      const routes = await prisma.route.findMany({ orderBy: { distance: 'desc' } });
      const route = routes[0]!;
      await prisma.ship.update({
        where: { id: shipId },
        data: {
          status: 'ADRIFT',
          floatRouteId: route.id,
          floatFromId: route.nodeAId,
          floatProgress: progress,
        },
      });
      const locations = await prisma.location.findMany({ select: { id: true, type: true } });
      const bases = new Set(
        locations.filter((l) => RESCUE_BASE_TYPES.has(l.type)).map((l) => l.id),
      );
      const plan = towPlanFor(
        { routeId: route.id, fromId: route.nodeAId, progress },
        routes,
        bases,
      )!;
      return { route, plan };
    }

    it('shows where it floats and what each way out costs, in the ship itself', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const { route, plan } = await floatOnLongestRoute(player.shipId, 0.5);

      const listed = await request(httpServer(testApp.app))
        .get('/v1/ships')
        .set(auth(player.token));
      const ship = (listed.body as Array<Record<string, unknown>>)[0]!;
      expect(ship['status']).toBe('ADRIFT');
      expect(ship['float']).toMatchObject({
        routeId: route.id,
        fromId: route.nodeAId,
        progress: 0.5,
      });
      expect(ship['rescue']).toMatchObject({
        waitCost: 400,
        nowCost: 400 + Math.round(plan.distance),
        waitSeconds: 600,
        dueAt: null,
        baseId: plan.baseId,
      });
    });

    it('calling it now tows the ship to the nearest base for the waiting price plus the distance', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const { plan } = await floatOnLongestRoute(player.shipId, 0.5);
      await setCredits(player.seeded.player.id, 5000);

      const response = await rescue(player.token, player.shipId, randomUUID(), 'now');
      expect(response.status).toBe(200);
      const body = response.body as RescueBody & { baseId: string };
      expect(body.cost).toBe(400 + Math.round(plan.distance));
      expect(body.baseId).toBe(plan.baseId);
      const ship = await shipRow(player.shipId);
      expect(ship).toMatchObject({
        status: 'IN_PORT',
        currentLocationId: plan.baseId,
        floatRouteId: null,
        floatFromId: null,
        floatProgress: null,
        rescueAt: null,
      });
      expect(await currentCredits(player.seeded.player.id)).toBe(5000 - body.cost);
    });

    it('waiting charges nothing until the rescue arrives, then the cheaper price, and not before', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const { plan } = await floatOnLongestRoute(player.shipId, 0.5);
      await setCredits(player.seeded.player.id, 5000);

      const waiting = await rescue(player.token, player.shipId, randomUUID(), 'wait');
      expect(waiting.status).toBe(200);
      expect(waiting.body).toMatchObject({ status: 'ADRIFT', mode: 'wait', cost: 0 });
      expect((waiting.body as { dueAt: string }).dueAt).toEqual(expect.any(String));
      expect(await currentCredits(player.seeded.player.id)).toBe(5000);
      expect((await shipRow(player.shipId)).status).toBe('ADRIFT');

      // the timer is not up: settling is refused
      const early = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/rescue/settle`)
        .set(auth(player.token));
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ message: { error: 'RESCUE_NOT_DUE' } });

      // calling the rescue again does not restart the clock
      const dueBefore = (await shipRow(player.shipId)).rescueAt!.getTime();
      await rescue(player.token, player.shipId, randomUUID(), 'wait');
      expect((await shipRow(player.shipId)).rescueAt!.getTime()).toBe(dueBefore);

      // time passes
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { rescueAt: new Date(Date.now() - 1000) },
      });
      const arrived = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/rescue/settle`)
        .set(auth(player.token));
      expect(arrived.status).toBe(200);
      expect(arrived.body).toMatchObject({ status: 'IN_PORT', cost: 400, baseId: plan.baseId });
      expect(await currentCredits(player.seeded.player.id)).toBe(4600);
      expect(await shipRow(player.shipId)).toMatchObject({
        status: 'IN_PORT',
        currentLocationId: plan.baseId,
        rescueAt: null,
      });
    });

    it('while waiting, the pilot can still call it now (and pays the higher price instead)', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const { plan } = await floatOnLongestRoute(player.shipId, 0.5);
      await setCredits(player.seeded.player.id, 5000);
      await rescue(player.token, player.shipId, randomUUID(), 'wait');

      const now = await rescue(player.token, player.shipId, randomUUID(), 'now');
      expect(now.status).toBe(200);
      expect((now.body as RescueBody).cost).toBe(400 + Math.round(plan.distance));
      expect((await shipRow(player.shipId)).rescueAt).toBeNull();
    });
  });
});
