import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { MissionInstance, MissionType } from '@prisma/client';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
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
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  async function createMission(
    overrides: {
      type?: MissionType;
      originId?: string;
      expiresAt?: Date;
      reward?: number;
      legs?: unknown;
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
        legs: overrides.legs ?? [
          { distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } },
        ],
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

  // §9.1 round-4 fix: a brand-new player's very first board must not include a mission that
  // leaves the safe core (GDD §2 zone 0-1), even though it's otherwise perfectly eligible; a
  // player past the D43 "new" threshold sees the same offer once it's no longer filtered.
  it('caps a new player\'s board to the safe core; a veteran sees the same dangerous offer', async () => {
    await freshSeededApp();
    const { token, seeded } = await onboardPlayer();
    const server = httpServer(testApp.app);

    const safe = await createMission({
      reward: 111,
      legs: [{ distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } }],
    });
    const dangerous = await createMission({
      reward: 222,
      legs: [{ distance: 40, danger: 8, zone: 3, env: { id: 'frontier', level: 3, fuelMult: 1 } }],
    });

    const asNew = await request(server).get('/v1/locations/ceres/missions').set(auth(token));
    expect(asNew.status).toBe(200);
    const newIds = (asNew.body as Array<{ id: string }>).map((row) => row.id);
    expect(newIds).toContain(safe.id);
    expect(newIds).not.toContain(dangerous.id);

    // Past D43's own "new player" threshold (starter_guarantee_max_completed): the cap lifts.
    const { starter_guarantee_max_completed: threshold } = configService.snapshot().rules.missions;
    for (let i = 0; i < threshold; i += 1) {
      const done = await createMission({ reward: 1 });
      await prisma.missionInstance.update({
        where: { id: done.id },
        data: { status: 'DONE', playerId: seeded.player.id },
      });
    }

    const asVeteran = await request(server).get('/v1/locations/ceres/missions').set(auth(token));
    expect(asVeteran.status).toBe(200);
    const veteranIds = (asVeteran.body as Array<{ id: string }>).map((row) => row.id);
    expect(veteranIds).toContain(dangerous.id);
  });

  // S10.6: the board disables Accept without the client re-deriving any rule, so the
  // server composes template requirements + accept's own preconditions per offer.
  it('reports upfront board eligibility: requirements, origin and one-active preconditions (S10.6)', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);

    interface EligibilityBody {
      eligible: boolean;
      reasons: Array<{ code: string; message: string }>;
    }
    type OfferRow = { id: string; type: string; eligibility: EligibilityBody };

    const delivery = await createMission({ type: 'DELIVERY' }); // starter crg 10 ≥ 1
    const mining = await createMission({ type: 'MINING' }); // starter has no mining rig
    const transport = await createMission({ type: 'TRANSPORT' }); // no pressurized cabin
    const rescue = await createMission({ type: 'RESCUE' }); // starter mob below reference
    const elsewhere = await createMission({ type: 'DELIVERY', originId: 'hedus' });

    const board = await request(server).get('/v1/locations/ceres/missions').set(auth(token));
    expect(board.status).toBe(200);
    const rows = (board.body as OfferRow[]).filter((row) =>
      [delivery.id, mining.id, transport.id, rescue.id].includes(row.id),
    );
    expect(rows).toHaveLength(4);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const codesOf = (id: string): string[] =>
      (byId.get(id)?.eligibility.reasons ?? []).map((reason) => reason.code);

    expect(byId.get(delivery.id)?.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(codesOf(mining.id)).toContain('MINER');
    expect(codesOf(transport.id)).toContain('PRESSURIZED_LIFE_SUPPORT');
    expect(codesOf(rescue.id)).toContain('SPEED');

    const otherBoard = await request(server).get('/v1/locations/hedus/missions').set(auth(token));
    expect(otherBoard.status).toBe(200);
    const foreign = (otherBoard.body as OfferRow[]).find((row) => row.id === elsewhere.id);
    expect(foreign?.eligibility.eligible).toBe(false);
    expect(foreign?.eligibility.reasons.map((reason) => reason.code)).toContain(
      'SHIP_NOT_AT_ORIGIN',
    );

    // Once a mission is under way every remaining offer reports the accept-time
    // ACTIVE_MISSION_EXISTS precondition too.
    const accepted = await request(server)
      .post(`/v1/missions/${delivery.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);

    const after = await request(server).get('/v1/locations/ceres/missions').set(auth(token));
    const miningAfter = (after.body as OfferRow[]).find((row) => row.id === mining.id);
    expect(miningAfter?.eligibility.eligible).toBe(false);
    expect(miningAfter?.eligibility.reasons.map((reason) => reason.code)).toContain(
      'ACTIVE_MISSION_EXISTS',
    );
  });

  // Round-10 owner request: "show the requirements for the mission, in a clear way, not
  // only the text" — `eligibility.reasons` only ever lists FAILING checks, so an eligible
  // offer (e.g. the delivery above) never told the pilot what it required at all.
  // `info.requirements` is the same checks, always present with a `met` flag.
  it("exposes info.requirements as the full checklist, not just the failing half (S10.6 follow-up)", async () => {
    await freshSeededApp();
    const { token } = await onboardPlayer();
    const server = httpServer(testApp.app);

    interface RequirementCheckBody {
      code: string;
      message: string;
      met: boolean;
    }
    type OfferRow = { id: string; type: string; info: { requirements: RequirementCheckBody[] } };

    const delivery = await createMission({ type: 'DELIVERY' }); // starter crg 10 ≥ 1
    const mining = await createMission({ type: 'MINING' }); // starter has no mining rig

    const board = await request(server).get('/v1/locations/ceres/missions').set(auth(token));
    expect(board.status).toBe(200);
    const byId = new Map(
      (board.body as OfferRow[])
        .filter((row) => [delivery.id, mining.id].includes(row.id))
        .map((row) => [row.id, row]),
    );

    // Eligible delivery: the checklist still lists CARGO_TYPE, now as met: true — it is
    // never dropped just because the ship already clears it.
    const deliveryRequirements = byId.get(delivery.id)?.info.requirements ?? [];
    expect(deliveryRequirements).toEqual([
      { code: 'CARGO_TYPE', message: expect.any(String), met: true },
    ]);

    // Ineligible mining: MINER is met: false, matching eligibility.reasons' MINER entry.
    const miningRequirements = byId.get(mining.id)?.info.requirements ?? [];
    const miner = miningRequirements.find((entry) => entry.code === 'MINER');
    expect(miner?.met).toBe(false);
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

  it('backs out of an accepted mission before dispatch: it returns to the board and frees the player', async () => {
    await freshSeededApp();
    const { token, shipId } = await onboardPlayer();
    const server = httpServer(testApp.app);
    const mission = await createMission();

    const accepted = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);

    const abandoned = await request(server)
      .post(`/v1/missions/${mission.id}/abandon`)
      .set(auth(token));
    expect(abandoned.status).toBe(200);
    expect(abandoned.body).toMatchObject({
      id: mission.id,
      status: 'AVAILABLE',
      playerId: null,
      shipId: null,
      acceptedAt: null,
    });
    expect((await request(server).get('/v1/missions/active').set(auth(token))).body).toEqual([]);

    // A repeat is a 409 with no second effect, and the offer can be accepted again.
    const again = await request(server).post(`/v1/missions/${mission.id}/abandon`).set(auth(token));
    expect(again.status).toBe(404);
    const reAccepted = await request(server)
      .post(`/v1/missions/${mission.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(reAccepted.status).toBe(200);

    // Someone else cannot abandon it, and an in-flight mission cannot be abandoned.
    await prisma.missionInstance.update({
      where: { id: mission.id },
      data: { status: 'IN_TRANSIT' },
    });
    const inFlight = await request(server)
      .post(`/v1/missions/${mission.id}/abandon`)
      .set(auth(token));
    expect(inFlight.status).toBe(409);
    expect(inFlight.body).toMatchObject({ message: { error: 'MISSION_NOT_ABANDONABLE' } });
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
