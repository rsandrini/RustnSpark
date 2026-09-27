import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME, REPAIR_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { PartsService } from '../../src/parts/parts.service.js';
import { RepairService } from '../../src/economy/repair.service.js';
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

// S8.4 acceptance (plan line 477): cost charged up-front atomically; duration = points ×
// hub/outpost k (zone ≤ 1 → 3 s/point); parts change condition only on completion; ship
// cannot dispatch while repairing; job idempotent; sold-during-repair cannot wedge complete().
describe('repair job API (S8.4)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let missionQueue: Queue;
  let repairQueue: Queue<{ repairJobId: string }>;
  let repairService: RepairService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    repairQueue = testApp.app.get(getQueueToken(REPAIR_QUEUE_NAME));
    repairService = testApp.app.get(RepairService);
  });

  afterAll(async () => {
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
    await repairQueue.obliterate({ force: true }).catch(() => undefined);
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
    await repairQueue.obliterate({ force: true }).catch(() => undefined);
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
    // Repair cost depends on which (randomly-identified) parts a test damages; the 200-credit
    // start balance cannot cover every combination. Tests about affording set their own balance.
    await prisma.player.update({
      where: { id: seeded.player.id },
      data: { credits: 1_000_000 },
    });
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  async function damagedInstalledParts(player: AuthPair, conditions: readonly number[]) {
    const parts = await prisma.partInstance.findMany({
      where: {
        ownerPlayerId: player.seeded.player.id,
        location: 'INSTALLED',
        shipId: player.shipId,
      },
      orderBy: { id: 'asc' },
    });
    expect(parts.length).toBeGreaterThanOrEqual(conditions.length);
    for (const [index, condition] of conditions.entries()) {
      const part = parts[index];
      if (!part) throw new Error('not enough installed parts');
      await prisma.partInstance.update({ where: { id: part.id }, data: { condition } });
    }
    return parts.slice(0, conditions.length);
  }

  async function damagedInstalledPart(player: AuthPair, condition = 50) {
    const [part] = await damagedInstalledParts(player, [condition]);
    if (!part) throw new Error('no installed part');
    return part;
  }

  function startRepair(
    token: string,
    shipId: string,
    key: string | undefined,
    targets: Array<{ partInstanceId: string; toCondition: number }>,
  ) {
    const req = request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/repair`)
      .set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send({ targets });
  }

  async function createAcceptedMission(originId = 'ceres'): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId,
        destinationId: originId === 'hedus' ? 'ceres' : 'hedus',
        legs: [
          {
            routeId: route.id,
            distance: 100,
            danger: 1,
            zone: 0,
            env: { id: 'belt', level: 1, fuelMult: 1 },
          },
        ],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `s8.4-${randomUUID()}`,
        status: 'ACCEPTED',
      },
    });
  }

  it('start charges cost, creates one PENDING job, duration = points × hub k', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 50);

    const before = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });

    // Idempotency-Key is required (R21) — missing key is 400 before any side effect.
    const noKey = await startRepair(player.token, player.shipId, undefined, [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(noKey.status).toBe(400);

    const key = randomUUID();
    const first = await startRepair(player.token, player.shipId, key, [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(first.status).toBe(200);
    const body = first.body as {
      repairJobId: string;
      cost: number;
      durationSeconds: number;
      targets: Array<{ fromCondition: number; toCondition: number }>;
    };
    expect(body.cost).toBeGreaterThanOrEqual(1);
    // ceres is zone ≤ 1 → hub = 3 s/point; 50 points repaired.
    expect(body.durationSeconds).toBe(50 * 3);
    expect(body.targets).toEqual([
      { partInstanceId: part.id, fromCondition: 50, toCondition: 100 },
    ]);

    const after = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(after.credits).toBe(before.credits - body.cost);

    // Condition unchanged until completion.
    const mid = await prisma.partInstance.findUniqueOrThrow({ where: { id: part.id } });
    expect(mid.condition).toBe(50);

    const job = await prisma.repairJob.findUniqueOrThrow({ where: { id: body.repairJobId } });
    expect(job.status).toBe('PENDING');

    const second = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      statusCode: 409,
      message: { error: 'ALREADY_REPAIRING' },
    });

    const replay = await startRepair(player.token, player.shipId, key, [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(replay.status).toBe(200);
    expect(replay.text).toBe(first.text);
    expect(await prisma.repairJob.count({ where: { shipId: player.shipId } })).toBe(1);
  });

  it('dispatch while PENDING returns 409 SHIP_REPAIRING', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 90);
    const started = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(started.status).toBe(200);

    const mission = await createAcceptedMission('ceres');
    await prisma.missionInstance.update({
      where: { id: mission.id },
      data: { playerId: player.seeded.player.id, shipId: player.shipId },
    });

    const dispatch = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId: mission.id });
    expect(dispatch.status).toBe(409);
    expect(dispatch.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_REPAIRING' },
    });
  });

  it('complete applies conditions once; second complete no-ops; sold part cannot wedge it', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const [part, other] = await damagedInstalledParts(player, [40, 60]);
    if (!part || !other) throw new Error('expected two distinct installed parts');

    const started = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
      { partInstanceId: other.id, toCondition: 80 },
    ]);
    expect(started.status).toBe(200);
    const repairJobId = (started.body as { repairJobId: string }).repairJobId;

    // Simulate sell-during-repair: one target row disappears before the worker runs.
    await prisma.partInstance.delete({ where: { id: other.id } });

    const applied = await repairService.complete(repairJobId);
    expect(applied).toEqual({ applied: true });

    const repaired = await prisma.partInstance.findUnique({ where: { id: part.id } });
    expect(repaired?.condition).toBe(100);
    const gone = await prisma.partInstance.findUnique({ where: { id: other.id } });
    expect(gone).toBeNull();

    const job = await prisma.repairJob.findUniqueOrThrow({ where: { id: repairJobId } });
    expect(job.status).toBe('COMPLETED');

    const replay = await repairService.complete(repairJobId);
    expect(replay).toEqual({ applied: false });
    expect(await prisma.partInstance.findUnique({ where: { id: part.id } })).toMatchObject({
      condition: 100,
    });
  });

  it('repair start rejects invalid targets without charging', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 70);

    const lower = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 50 },
    ]);
    expect(lower.status).toBe(409);
    expect(lower.body).toMatchObject({
      statusCode: 409,
      message: { error: 'INVALID_REPAIR_TARGET' },
    });

    const empty = await startRepair(player.token, player.shipId, randomUUID(), []);
    expect(empty.status).toBe(400);

    expect(await prisma.repairJob.count({ where: { shipId: player.shipId } })).toBe(0);
    const after = await prisma.partInstance.findUniqueOrThrow({ where: { id: part.id } });
    expect(after.condition).toBe(70);
  });

  it('a destroyed part (condition 0) cannot be repaired, and nothing is charged', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 0);

    const response = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ message: { error: 'PART_DESTROYED' } });
    expect(await prisma.repairJob.count({ where: { shipId: player.shipId } })).toBe(0);
  });

  it('while a repair runs the part shows the share of the work done so far', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 40);
    const started = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(started.status).toBe(200);

    const conditionNow = async () => {
      const rows = await testApp.app.get(PartsService).findPlayerParts(player.seeded.player.id);
      return rows.find((row) => row.id === part.id)?.condition ?? -1;
    };
    // Just started: still (about) the starting value; halfway: about halfway; the stored value
    // stays untouched until the job completes.
    expect(await conditionNow()).toBeLessThanOrEqual(45);
    await prisma.repairJob.updateMany({
      where: { shipId: player.shipId },
      data: {
        startedAt: new Date(Date.now() - 90_000),
        completesAt: new Date(Date.now() + 90_000),
      },
    });
    const half = await conditionNow();
    expect(half).toBeGreaterThanOrEqual(69);
    expect(half).toBeLessThanOrEqual(71);
    const stored = await prisma.partInstance.findUniqueOrThrow({ where: { id: part.id } });
    expect(stored.condition).toBe(40);
  });

  it('admin.debug_fast_ops shortens the queued repair delay without touching the displayed duration', async () => {
    await freshSeededApp();
    await prisma.gameConfig.update({
      where: { key: 'admin.debug_fast_ops' },
      data: { value: true },
    });
    await prisma.gameConfig.update({
      where: { key: 'admin.debug_fast_ops_seconds' },
      data: { value: 5 },
    });
    await configService.refresh();
    try {
      const player = await onboardPlayer();
      const part = await damagedInstalledPart(player, 5);

      const started = await startRepair(player.token, player.shipId, randomUUID(), [
        { partInstanceId: part.id, toCondition: 100 },
      ]);
      expect(started.status).toBe(200);
      const body = started.body as { repairJobId: string; durationSeconds: number };
      // Hub k = 3 s/point × 99 points is well over 5 seconds; the figure charged and shown is real.
      expect(body.durationSeconds).toBeGreaterThan(5);

      const job = await repairQueue.getJob(body.repairJobId);
      expect(job).toBeDefined();
      expect(job?.opts.delay).toBeLessThanOrEqual(5000);
    } finally {
      await prisma.gameConfig.update({
        where: { key: 'admin.debug_fast_ops' },
        data: { value: false },
      });
      await configService.refresh();
    }
  });

  it('quote returns the exact cost and duration start will charge, without charging (S10.9)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 50);
    const targets = [{ partInstanceId: part.id, toCondition: 100 }];
    const before = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });

    // A dry run needs no Idempotency-Key and leaves no trace.
    const quoted = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/repair/quote`)
      .set(auth(player.token))
      .send({ targets });
    expect(quoted.status).toBe(200);
    const quote = quoted.body as {
      cost: number;
      durationSeconds: number;
      fee: number;
      items: Array<{ partInstanceId: string; cost: number; durationSeconds: number }>;
    };
    expect(quote.durationSeconds).toBe(50 * 3);
    // The per-part lines plus the workshop fee are exactly the total that start() charges.
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]).toMatchObject({ partInstanceId: part.id, durationSeconds: 50 * 3 });
    expect(quote.items.reduce((sum, item) => sum + item.cost, 0) + quote.fee).toBe(quote.cost);
    expect(await prisma.repairJob.count({ where: { shipId: player.shipId } })).toBe(0);
    const unchanged = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(unchanged.credits).toBe(before.credits);

    const started = await startRepair(player.token, player.shipId, randomUUID(), targets);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      cost: quote.cost,
      durationSeconds: quote.durationSeconds,
    });

    // Same validation as the charge: bad targets are refused on the quote too.
    const invalid = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/repair/quote`)
      .set(auth(player.token))
      .send({ targets: [{ partInstanceId: part.id, toCondition: 10 }] });
    expect(invalid.status).toBe(409);
  });

  it('start refuses with 409 INSUFFICIENT_FUNDS (never 500) and charges nothing', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 10);
    await prisma.player.update({ where: { id: player.seeded.player.id }, data: { credits: 1 } });

    const res = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: { error: 'INSUFFICIENT_FUNDS' } });
    expect(await prisma.repairJob.count({ where: { shipId: player.shipId } })).toBe(0);
    const after = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(after.credits).toBe(1);
  });

  it('start is blocked while the balance is negative (spending guard, GDD §14)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const part = await damagedInstalledPart(player, 50);
    await prisma.player.update({ where: { id: player.seeded.player.id }, data: { credits: -100 } });

    const res = await startRepair(player.token, player.shipId, randomUUID(), [
      { partInstanceId: part.id, toCondition: 100 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: { error: 'BALANCE_NEGATIVE' } });
    expect(await prisma.repairJob.count({ where: { shipId: player.shipId } })).toBe(0);
  });
});
