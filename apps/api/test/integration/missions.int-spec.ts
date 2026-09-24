import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { MissionInstance, MissionType } from '@prisma/client';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { rewardBase } from '../../src/economy/reward.calculator.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TokenService } from '../../src/auth/token.service.js';
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

describe('missions accept/hold API (S6.4)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let configService: GameConfigService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
    configService = testApp.app.get(GameConfigService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  // Onboards luna, so the player's starter ship sits at ceres — the origin every
  // crafted mission below uses.
  async function onboardPlayer(): Promise<AuthPair> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  async function createMission(
    overrides: {
      type?: MissionType;
      originId?: string;
      expiresAt?: Date;
      reward?: number;
    } = {},
  ): Promise<MissionInstance> {
    const type = overrides.type ?? 'DELIVERY';
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type },
      orderBy: { id: 'asc' },
    });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type,
        factionId: template.factionId,
        originId: overrides.originId ?? 'ceres',
        destinationId: 'hedus',
        legs: [{ distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } }],
        cargo: {},
        // Deliberately wrong provisional: accept must finalize it from the ship's tier (D29).
        reward: overrides.reward ?? 1,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * 60_000),
        seed: `itest-${randomUUID()}`,
        status: 'AVAILABLE',
      },
    });
  }

  function expectedReward(missionType: string): number {
    const { rules } = configService.snapshot();
    return Math.round(rewardBase({ tier: 1, danger: 1, distance: 40, missionType }, rules));
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  it('requires an access token on every missions route', async () => {
    await freshSeededApp();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const responses = [
      await request(server).get('/v1/locations/ceres/missions'),
      await request(server).get('/v1/missions/active'),
      await request(server)
        .post(`/v1/missions/${mission.id}/accept`)
        .send({ shipId: randomUUID() }),
      await request(server).post(`/v1/missions/${mission.id}/hold`),
      await request(server).delete(`/v1/missions/${mission.id}/hold`),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
    }
  });

  it('serves the location board with reward estimates', async () => {
    await freshSeededApp();
    const { token } = await onboardPlayer();

    const response = await request(httpServer(testApp.app))
      .get('/v1/locations/ceres/missions')
      .set(auth(token));

    expect(response.status).toBe(200);
    const rows = response.body as Array<{ status: string; rewardEstimate: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.status).toBe('AVAILABLE');
      expect(typeof row.rewardEstimate).toBe('number');
    }
  });

  it('holds, re-holds idempotently, and releases a mission (max 1 hold, timer untouched)', async () => {
    await freshSeededApp();
    const { token } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const held = await request(server).post(`/v1/missions/${mission.id}/hold`).set(auth(token));
    expect(held.status).toBe(200);
    expect(held.body).toMatchObject({ id: mission.id, status: 'HELD' });
    const originalExpiry = (held.body as { expiresAt: string }).expiresAt;

    const reHeld = await request(server).post(`/v1/missions/${mission.id}/hold`).set(auth(token));
    expect(reHeld.status).toBe(200);
    expect(reHeld.body).toMatchObject({ id: mission.id, status: 'HELD' });

    const active = await request(server).get('/v1/missions/active').set(auth(token));
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject([{ id: mission.id, status: 'HELD' }]);
    // The hold never freezes the start deadline (design ux §7).
    expect((active.body as Array<{ expiresAt: string }>)[0]!.expiresAt).toBe(originalExpiry);

    const released = await request(server)
      .delete(`/v1/missions/${mission.id}/hold`)
      .set(auth(token));
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ id: mission.id, status: 'AVAILABLE', playerId: null });

    const activeAfter = await request(server).get('/v1/missions/active').set(auth(token));
    expect(activeAfter.body).toEqual([]);
  });

  it('enforces hold_max = 1 across different missions', async () => {
    await freshSeededApp();
    const { token } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const first = await createMission();
    const second = await createMission();

    const held = await request(server).post(`/v1/missions/${first.id}/hold`).set(auth(token));
    expect(held.status).toBe(200);

    const rejected = await request(server).post(`/v1/missions/${second.id}/hold`).set(auth(token));
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ statusCode: 409, message: { error: 'HOLD_LIMIT' } });
  });

  it('finalizes the reward from the accepting ship tier, is idempotent, and enforces one active mission (D29)', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const accepted = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);
    const body = accepted.body as {
      status: string;
      playerId: string;
      shipId: string;
      acceptedAt: string;
      reward: number;
    };
    expect(body.status).toBe('ACCEPTED');
    expect(body.playerId).toBeTruthy();
    expect(body.shipId).toBe(shipId);
    expect(body.acceptedAt).toBeTruthy();
    expect(body.reward).toBe(expectedReward('DELIVERY'));

    const again = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(again.status).toBe(200);
    expect((again.body as { reward: number }).reward).toBe(body.reward);
    expect((again.body as { acceptedAt: string }).acceptedAt).toBe(body.acceptedAt);

    const second = await createMission();
    const rejected = await request(server)
      .post(`/v1/missions/${second.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      statusCode: 409,
      message: { error: 'ACTIVE_MISSION_EXISTS' },
    });

    const active = await request(server).get('/v1/missions/active').set(auth(token));
    expect(active.body).toMatchObject([{ id: mission.id, status: 'ACCEPTED' }]);
  });

  it('lets exactly one of two players accept the same mission (one 200, one 409)', async () => {
    await freshSeededApp();
    const winner = await onboardPlayer();
    const loser = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const first = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(winner.token))
      .send({ shipId: winner.shipId });
    const second = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(loser.token))
      .send({ shipId: loser.shipId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const stored = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: mission.id },
    });
    expect(stored.status).toBe('ACCEPTED');
    expect(stored.playerId).toBe(winner.seeded.player.id);
  });

  it('rejects accepting with a ship that is not at the mission origin', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();
    await prisma.ship.update({ where: { id: shipId }, data: { currentLocationId: 'hedus' } });

    const response = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_AT_ORIGIN' },
    });
  });

  it('returns the requirement reasons when the ship fails the GDD §12 table', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    // Starter ship is viable but has no pressurized cabin with life support.
    const mission = await createMission({ type: 'TRANSPORT' });

    const response = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      message: { error: 'MISSION_REQUIREMENTS_NOT_MET' },
    });
    const reasons = (response.body as { message: { reasons: Array<{ code: string }> } }).message
      .reasons;
    expect(reasons.map((reason) => reason.code)).toContain('PRESSURIZED_LIFE_SUPPORT');
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('AVAILABLE');
  });

  it('rejects accepting with a non-viable ship before checking requirements', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();
    await prisma.partInstance.updateMany({
      where: { shipId },
      data: { location: 'INVENTORY', shipId: null },
    });
    await prisma.ship.update({ where: { id: shipId }, data: { layout: [] } });

    const response = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ statusCode: 400, message: { error: 'SHIP_NOT_VIABLE' } });
    const problems = (response.body as { message: { problems: Array<{ code: string }> } }).message
      .problems;
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects accepting an expired mission and flips it to EXPIRED with no penalty', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission({ expiresAt: new Date(Date.now() - 1000) });

    const response = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'MISSION_EXPIRED' } });
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.playerId).toBeNull();

    // No penalty: the player's one active slot is still free.
    const fresh = await createMission();
    const accepted = await request(server)
      .post(`/v1/missions/${fresh.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);
  });

  it('keeps the hold timer running: an expired hold becomes EXPIRED and frees the player', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const held = await request(server).post(`/v1/missions/${mission.id}/hold`).set(auth(token));
    expect(held.status).toBe(200);

    // The start deadline passes while the mission sits in hold (design ux §7).
    await prisma.missionInstance.update({
      where: { id: mission.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const accept = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accept.status).toBe(409);
    expect(accept.body).toMatchObject({ statusCode: 409, message: { error: 'MISSION_EXPIRED' } });
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.playerId).toBeNull();

    const active = await request(server).get('/v1/missions/active').set(auth(token));
    expect(active.body).toEqual([]);

    const fresh = await createMission();
    const accepted = await request(server)
      .post(`/v1/missions/${fresh.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);
  });

  it('refuses to release a mission that is not held by the caller', async () => {
    await freshSeededApp();
    const { token } = await onboardPlayer();
    const mission = await createMission();

    const response = await request(httpServer(testApp.app))
      .delete(`/v1/missions/${mission.id}/hold`)
      .set(auth(token));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'HOLD_NOT_OWNED' } });
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('AVAILABLE');
  });

  it('refuses an accept while another player holds the mission', async () => {
    await freshSeededApp();
    const holder = await onboardPlayer();
    const contender = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const held = await request(server)
      .post(`/v1/missions/${mission.id}/hold`)
      .set(auth(holder.token));
    expect(held.status).toBe(200);

    const response = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(contender.token))
      .send({ shipId: contender.shipId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'MISSION_HELD' } });
  });

  it('rejects holding an expired mission', async () => {
    await freshSeededApp();
    const { token } = await onboardPlayer();
    const mission = await createMission({ expiresAt: new Date(Date.now() - 1000) });

    const response = await request(httpServer(testApp.app))
      .post(`/v1/missions/${mission.id}/hold`)
      .set(auth(token));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'MISSION_EXPIRED' } });
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('EXPIRED');
  });
});
