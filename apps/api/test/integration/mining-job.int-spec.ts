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
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
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

// Round-10 owner request: "add independent mining missions at minable locations (fixed
// duration, stops early if ship cargo full)" — same shape as the scavenging job (W8): a free
// MINING mission that starts and ends at the ship's own location, through the same
// DispatchService, gated on the location actually being minable and the ship carrying a
// mining rig (neither of which the board flow has to check, since a contracted board offer
// is only ever shown where it was already generated to be eligible).
describe('independent mining job (round 10)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let queue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
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

  // The starter kit's power budget has no margin at all — a rig alone tips continuous energy
  // negative (SHIP_NOT_VIABLE), so the test rig always comes with its own reactor.
  //
  // Both parts are created in INVENTORY and placed through the real auto-assemble endpoint
  // (not a raw `location: 'INSTALLED'` write) — `location: 'INSTALLED'` alone isn't enough
  // for Connectors v0.1's connectivity graph, which walks ship.layout's own placements, so a
  // part with no placement there would be invisible to it (and count as disconnected, zeroing
  // exactly the `min`/`energyCont` stats this test is about). Routing through the real
  // placement algorithm, instead of hand-picking grid coordinates here, guarantees the new
  // parts land adjacent to the existing cluster.
  async function installMiningRig(token: string, playerId: string, shipId: string): Promise<void> {
    const rig = await prisma.partInstance.create({
      data: { partType: 'mining_rig', ownerPlayerId: playerId, condition: 100, location: 'INVENTORY' },
    });
    const reactor = await prisma.partInstance.create({
      data: { partType: 'reactor_solar', ownerPlayerId: playerId, condition: 100, location: 'INVENTORY' },
    });
    const installed = await prisma.partInstance.findMany({
      where: { ownerPlayerId: playerId, location: 'INSTALLED', shipId },
      select: { id: true },
    });
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/auto-assemble`)
      .set(auth(token))
      .send({ partInstanceIds: [...installed.map((p) => p.id), rig.id, reactor.id] });
    expect(response.status).toBe(200);
  }

  const start = (token: string, locationId: string) =>
    request(httpServer(testApp.app)).post(`/v1/locations/${locationId}/mine`).set(auth(token));

  // Every seeded faction has at least one MINING template, and the owning faction's own
  // locations are always eligible for its own template (luna's has no originTypes
  // restriction at all) — so NOT_MINABLE is exercised at the predicate level
  // (template.filler.spec.ts's isMiningEligible tests), not against this particular seed.

  it('refuses without a mining rig installed (NO_MINING_RIG)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const response = await start(player.token, 'ceres');
    expect(response.status).toBe(400);
    expect((response.body as { message?: { error?: string } }).message?.error).toBe(
      'NO_MINING_RIG',
    );
  });

  it('starts a job at a minable location with a mining rig: free MINING mission, ship locked, no reward', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await installMiningRig(player.token, player.seeded.player.id, player.shipId);

    const response = await start(player.token, 'ceres');
    expect(response.status).toBe(200);
    const body = response.body as { missionId: string; durationSeconds?: number };
    expect(
      Math.abs(
        (body.durationSeconds ?? 0) - configService.snapshot().rules.mining.job_duration_seconds,
      ),
    ).toBeLessThanOrEqual(5);

    const mission = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: body.missionId },
    });
    expect(mission).toMatchObject({
      type: 'MINING',
      status: 'IN_TRANSIT',
      originId: 'ceres',
      destinationId: 'ceres',
      reward: 0,
    });
    expect((mission.cargo as { contracted?: boolean }).contracted).toBe(false);
    expect(typeof (mission.cargo as { materialId?: string }).materialId).toBe('string');

    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
    expect(await queue.getJob(mission.id)).toBeTruthy();

    // One flight at a time.
    expect((await start(player.token, 'ceres')).status).toBe(409);
  });

  // Part direction rules: mining flies the ship out, so an engine with a part behind its exhaust
  // keeps it in port; scavenging is manual work at the place (the ship never travels) and is not
  // held by the rule.
  it('mining is refused while an engine has a part behind its exhaust; scavenging at the same layout is not', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await installMiningRig(player.token, player.seeded.player.id, player.shipId);

    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    const layout = ship.layout as { partInstanceId: string; gx: number; gy: number; rot: number }[];
    const engines = await prisma.partInstance.findMany({
      where: { id: { in: layout.map((placement) => placement.partInstanceId) }, partCatalog: { partClass: 'ENGINE' } },
      select: { id: true },
    });
    const engineId = engines[0]!.id;

    // turn the engine through its four facings until the ship is flight-viable apart from the
    // direction rule: that one problem, EXHAUST_BLOCKED, is what this test is about
    let chosen: number | null = null;
    for (const rot of [0, 90, 180, 270]) {
      const candidate = layout.map((placement) =>
        placement.partInstanceId === engineId ? { ...placement, rot } : placement,
      );
      const preview = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/preview`)
        .set(auth(player.token))
        .send({ layout: candidate });
      const codes = (
        (preview.body as { viability?: { problems: { code: string }[] } }).viability?.problems ?? []
      ).map((problem) => problem.code);
      if (codes.length === 1 && codes[0] === 'EXHAUST_BLOCKED') {
        chosen = rot;
        await prisma.ship.update({
          where: { id: player.shipId },
          data: { layout: candidate },
        });
        break;
      }
    }
    expect(chosen).not.toBeNull();

    const refused = await start(player.token, 'ceres');
    expect(refused.status).toBe(400);
    const problems = (
      (refused.body as { message?: { error?: string; problems?: { code: string }[] } }).message ?? {}
    ).problems;
    expect(problems?.map((problem) => problem.code)).toContain('EXHAUST_BLOCKED');

    const scavenging = await request(httpServer(testApp.app))
      .post('/v1/locations/ceres/scavenge')
      .set(auth(player.token));
    expect(scavenging.status).toBe(200);
  });
});
