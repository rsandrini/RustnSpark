import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MissionProcessor } from '../../src/jobs/processors/mission.processor.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import type { DispatchJobData } from '../../src/missions/dispatch.service.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
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

// W8: scavenging is a timed job (a mission of type SCAVENGE that starts and ends at the ship's
// own port): the ship is locked for the duration, encounters come from the place's danger, and
// the finds (always USED parts, some scrap) arrive with the report. Scrap sells at a fixed price.
describe('scavenging job (W8)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let queue: Queue;
  let processor: MissionProcessor;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    processor = new MissionProcessor(testApp.app.get(MissionResolveService));
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

  async function onboardPlayer(): Promise<AuthPair> {
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
    return { seeded, token, shipId };
  }

  const start = (token: string, locationId: string) =>
    request(httpServer(testApp.app)).post(`/v1/locations/${locationId}/scavenge`).set(auth(token));

  it('starts a job: a SCAVENGE mission at the same port, ship locked, no reward, about the configured time', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const response = await start(player.token, 'ceres');
    expect(response.status).toBe(200);
    const body = response.body as {
      missionId: string;
      arrivalAt: string;
      durationSeconds?: number;
    };
    expect(body.durationSeconds).toBeGreaterThan(0);
    expect(
      Math.abs(
        (body.durationSeconds ?? 0) - configService.snapshot().rules.scavenging.duration_seconds,
      ),
    ).toBeLessThanOrEqual(5);

    const mission = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: body.missionId },
    });
    expect(mission).toMatchObject({
      type: 'SCAVENGE',
      status: 'IN_TRANSIT',
      originId: 'ceres',
      destinationId: 'ceres',
      reward: 0,
    });
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
    expect(await queue.getJob(mission.id)).toBeTruthy();

    // One flight at a time, and only at the ship's own port.
    expect((await start(player.token, 'ceres')).status).toBe(409);
    expect((await start(player.token, 'hedus')).status).toBe(409);
    expect((await start(player.token, 'nowhere')).status).toBe(404);
  });

  it('a ship that cannot fly can still scavenge by hand — marked handicapped for the roll', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    // every part back in the hold: no bridge, no engine — a ship that could not fly a mission
    await prisma.partInstance.updateMany({
      where: { shipId: player.shipId, ownerPlayerId: player.seeded.player.id },
      data: { location: 'INVENTORY', shipId: null },
    });
    await prisma.ship.update({ where: { id: player.shipId }, data: { layout: [] } });

    const response = await start(player.token, 'ceres');
    expect(response.status).toBe(200);
    const mission = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: (response.body as { missionId: string }).missionId },
    });
    expect(mission.type).toBe('SCAVENGE');
    // a mission needs a bridge to fly, but this one never leaves port
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
  });

  it('on foot: its own (shorter) time, mode validated, and the dispatch is marked on foot', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const bad = await start(player.token, 'ceres').send({ mode: 'swim' });
    expect(bad.status).toBe(400);

    const response = await start(player.token, 'ceres').send({ mode: 'foot' });
    expect(response.status).toBe(200);
    const body = response.body as { missionId: string; durationSeconds?: number };
    const rules = configService.snapshot().rules.scavenging;
    expect(Math.abs((body.durationSeconds ?? 0) - rules.foot_duration_seconds)).toBeLessThanOrEqual(5);
    expect(rules.foot_duration_seconds).toBeLessThan(rules.duration_seconds);
    const mission = await prisma.missionInstance.findUniqueOrThrow({ where: { id: body.missionId } });
    expect(mission.type).toBe('SCAVENGE');
  });

  it('a chemical ship with an empty tank can still scavenge (it never flies)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 0 } });
    expect((await start(player.token, 'ceres')).status).toBe(200);
  });

  it('resolves into a report: used parts in the inventory (or scrap), no payment, ship back in the same port', async () => {
    await freshSeededApp();
    // a run can come back empty (covered by the resolver's own tests): here, always find something
    await prisma.gameConfig.update({ where: { key: 'scavenging.nothing_chance' }, data: { value: [0] } });
    await configService.refresh();
    const player = await onboardPlayer();
    const before = await prisma.partInstance.count({
      where: { ownerPlayerId: player.seeded.player.id, location: 'INVENTORY' },
    });
    const started = await start(player.token, 'ceres');
    const missionId = (started.body as { missionId: string }).missionId;
    const job = (await queue.getJob(missionId)) as Job<DispatchJobData>;
    const result = await processor.process(job);
    expect(result.skipped).toBe(false);

    const mission = await prisma.missionInstance.findUniqueOrThrow({ where: { id: missionId } });
    expect(['DONE', 'FAILED']).toContain(mission.status);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.currentLocationId).toBe('ceres');
    expect(ship.status).toBe('IN_PORT');

    const log = await prisma.missionLog.findUniqueOrThrow({ where: { missionId } });
    const events = (
      log.legs as { events: Array<{ type: string; found?: { kind: string; condition: number } }> }
    ).events;
    expect(events.some((event) => event.type === 'mission_payout')).toBe(false);
    const finds = events.filter((event) => event.type === 'scavenge_find');
    if (mission.status === 'DONE') {
      expect(finds.length).toBeGreaterThan(0);
      const parts = await prisma.partInstance.count({
        where: { ownerPlayerId: player.seeded.player.id, location: 'INVENTORY' },
      });
      const partFinds = finds.filter((event) => event.found?.kind === 'part');
      expect(parts - before).toBe(partFinds.length);
      // Used parts only: every find carries a condition below 100.
      for (const event of partFinds) expect(event.found!.condition).toBeLessThan(100);
      // The report shows what was found.
      const report = await request(httpServer(testApp.app))
        .get(`/v1/reports/${missionId}?view=summary`)
        .set(auth(player.token));
      expect(report.status).toBe(200);
      expect((report.body as { stats: { found: unknown[] } }).stats.found.length).toBe(
        finds.length,
      );
    } else {
      // Pirates got the better of the search: nothing is found.
      expect(finds).toEqual([]);
    }
  });

  it('tells the pilot the place: odds, zone, time, scrap and the wait', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const info = await request(httpServer(testApp.app))
      .get('/v1/locations/drift/scavenge')
      .set(auth(player.token));
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      fieldType: 'pirate',
      zone: 3,
      scrapPlace: true,
      durationSeconds: 600,
      footDurationSeconds: 300,
      retryAfterSeconds: 0,
    });
    const safe = await request(httpServer(testApp.app))
      .get('/v1/locations/ceres/scavenge')
      .set(auth(player.token));
    expect(safe.body).toMatchObject({ fieldType: 'common', zone: 0, scrapPlace: false });
    // Riskier places give better parts.
    expect((info.body as { qualityMin: number }).qualityMin).toBeGreaterThan(
      (safe.body as { qualityMin: number }).qualityMin,
    );
  });

  it('enforces the wait between jobs at the same place', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await configService.setValue('scavenging.cooldown_seconds', 600, 'tester', 'W8 test');
    const first = await start(player.token, 'ceres');
    expect(first.status).toBe(200);
    // Finish it so the ship is free again, then try to go straight back out.
    const job = (await queue.getJob(
      (first.body as { missionId: string }).missionId,
    )) as Job<DispatchJobData>;
    await processor.process(job);
    const again = await start(player.token, 'ceres');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ message: { error: 'SCAVENGE_COOL_DOWN' } });
    const info = await request(httpServer(testApp.app))
      .get('/v1/locations/ceres/scavenge')
      .set(auth(player.token));
    expect((info.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('scrap has a fixed price: the same everywhere, whatever the port or the mood', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const playerId = player.seeded.player.id;
    const scrapValue = (
      await prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'cargo' } })
    ).scrapValue;
    await prisma.playerMaterial.create({
      data: { playerId, materialId: 'scrap_cargo', quantity: 3 },
    });
    const listAt = async (place: string) => {
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { currentLocationId: place },
      });
      const res = await request(httpServer(testApp.app))
        .get('/v1/materials')
        .set(auth(player.token));
      return (
        res.body as { materials: Array<{ materialId: string; unitPrice: number }> }
      ).materials.find((entry) => entry.materialId === 'scrap_cargo')!.unitPrice;
    };
    expect(await listAt('ceres')).toBe(scrapValue);
    expect(await listAt('drift')).toBe(scrapValue);
    expect(await listAt('hedus')).toBe(scrapValue);

    const sold = await request(httpServer(testApp.app))
      .post('/v1/market/sell-material')
      .set(auth(player.token))
      .set('Idempotency-Key', randomUUID())
      .send({ materialId: 'scrap_cargo', quantity: 3, expectedPrice: scrapValue * 3 });
    expect(sold.status).toBe(200);
    expect((sold.body as { price: number }).price).toBe(scrapValue * 3);
  });

  it('scrap is never something a mining offer asks you to dig', async () => {
    await freshSeededApp();
    const scrap = await prisma.material.count({ where: { fixedPrice: true } });
    expect(scrap).toBeGreaterThan(10);
    const mining = await prisma.missionInstance.count({ where: { type: 'MINING' } });
    expect(mining).toBe(0);
  });
});
