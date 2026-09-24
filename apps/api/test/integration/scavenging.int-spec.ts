import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME, REPAIR_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  fieldTypeOf,
  scavengeOutcome,
  type ScavengeOutcome,
} from '../../src/economy/scavenging.service.js';
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

interface ScavengeBody {
  locationId: string;
  attempt: number;
  fieldType: string;
  dropped: boolean;
  part: { partInstanceId: string; partType: string; condition: number } | null;
  cooldownSeconds: number;
}

// S8.5 acceptance (plan line 481): drop chances 25/55/75 by field type, quality
// 30-70 damaged, common parts mostly (DropTable), deterministic per world seed,
// per-player cooldown (D28, 5 min default), loot lands in inventory. The pure
// outcome function is imported so the HTTP responses are asserted against the
// exact seeded rolls — zero flake, and the endpoint is pinned to the same
// algorithm the unit tests pin.
describe('scavenging API (S8.5)', () => {
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

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

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
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  function scavenge(token: string, locationId: string) {
    return request(httpServer(testApp.app))
      .post(`/v1/locations/${locationId}/scavenge`)
      .set(auth(token));
  }

  async function setCooldown(seconds: number): Promise<void> {
    await prisma.gameConfig.update({
      where: { key: 'scavenging.cooldown_seconds' },
      data: { value: seconds },
    });
    await configService.refresh();
  }

  // Recomputes the seeded outcome for an attempt so HTTP responses can be
  // asserted exactly (same inputs, same pure function the service calls).
  async function expectedOutcome(
    playerId: string,
    locationId: string,
    attempt: number,
  ): Promise<ScavengeOutcome> {
    const [location, table] = await Promise.all([
      prisma.location.findUniqueOrThrow({ where: { id: locationId } }),
      prisma.dropTable.findFirstOrThrow({
        where: { source: 'scavenging' },
        orderBy: { id: 'asc' },
      }),
    ]);
    const catalog = await prisma.partCatalog.findMany({
      where: { active: true },
      orderBy: { partType: 'asc' },
      select: { partType: true, rarity: true },
    });
    const rules = configService.snapshot().rules;
    return scavengeOutcome({
      seed: rules.world.seed,
      playerId,
      locationId,
      attempt,
      fieldType: fieldTypeOf(location),
      chance: rules.scavenging.chance,
      qualityMin: rules.scavenging.quality_min,
      qualityMax: rules.scavenging.quality_max,
      tiers: table.tiers as unknown as Array<{ tier: string; chance: number }>,
      catalog,
    });
  }

  function assertMatchesExpected(body: ScavengeBody, outcome: ScavengeOutcome): void {
    expect(body.dropped).toBe(outcome.dropped);
    if (outcome.dropped) {
      expect(body.part).toMatchObject({
        partType: outcome.partType,
        condition: outcome.condition,
      });
      expect(body.part!.condition).toBeGreaterThanOrEqual(30);
      expect(body.part!.condition).toBeLessThanOrEqual(70);
    } else {
      expect(body.part).toBeNull();
    }
  }

  it('resolves attempts deterministically and lands loot in inventory', async () => {
    await freshSeededApp();
    await setCooldown(0);
    const player = await onboardPlayer();
    const drops: Array<{ partType: string; condition: number }> = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const expected = await expectedOutcome(player.seeded.player.id, 'ceres', attempt);
      const response = await scavenge(player.token, 'ceres');
      expect(response.status).toBe(200);
      const body = response.body as ScavengeBody;
      expect(body).toMatchObject({
        locationId: 'ceres',
        attempt,
        fieldType: 'common',
        cooldownSeconds: 0,
      });
      assertMatchesExpected(body, expected);
      if (body.part) drops.push({ partType: body.part.partType, condition: body.part.condition });

      const events = await prisma.playerEvent.findMany({
        where: { playerId: player.seeded.player.id, type: 'scavenge' },
        orderBy: { at: 'asc' },
      });
      expect(events).toHaveLength(attempt + 1);
      expect(events.at(-1)!.payload).toMatchObject({
        locationId: 'ceres',
        attempt,
        dropped: expected.dropped,
      });
    }

    const inventory = await prisma.partInstance.findMany({
      where: { ownerPlayerId: player.seeded.player.id, location: 'INVENTORY' },
    });
    expect(inventory).toHaveLength(drops.length);
    for (const drop of drops) {
      expect(inventory).toEqual(expect.arrayContaining([expect.objectContaining(drop)]));
    }
  });

  it('classifies the pirate-held debris field as the 75% tier', async () => {
    await freshSeededApp();
    await setCooldown(0);
    const player = await onboardPlayer();
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { currentLocationId: 'drift' },
    });

    const expected = await expectedOutcome(player.seeded.player.id, 'drift', 0);
    const response = await scavenge(player.token, 'drift');
    expect(response.status).toBe(200);
    const body = response.body as ScavengeBody;
    expect(body).toMatchObject({ locationId: 'drift', attempt: 0, fieldType: 'pirate' });
    assertMatchesExpected(body, expected);
    if (body.part) {
      const part = await prisma.partInstance.findUniqueOrThrow({
        where: { id: body.part.partInstanceId },
      });
      expect(part.location).toBe('INVENTORY');
      expect(part.ownerPlayerId).toBe(player.seeded.player.id);
    }
  });

  it('enforces the per-player cooldown (D28): second attempt 409 with retry hint', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    // Fresh seed: cooldown_seconds is the D28 default of 300.
    const first = await scavenge(player.token, 'ceres');
    expect(first.status).toBe(200);
    expect((first.body as ScavengeBody).cooldownSeconds).toBe(300);

    const second = await scavenge(player.token, 'ceres');
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      statusCode: 409,
      message: {
        error: 'SCAVENGE_COOL_DOWN',
        retryAfterSeconds: expect.any(Number),
      },
    });
    const retryAfter = (second.body as { message: { retryAfterSeconds: number } }).message
      .retryAfterSeconds;
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(300);

    // Only one attempt was consumed.
    const events = await prisma.playerEvent.count({
      where: { playerId: player.seeded.player.id, type: 'scavenge' },
    });
    expect(events).toBe(1);
  });

  it('guards: unknown location 404, ship elsewhere 409, on mission 409', async () => {
    await freshSeededApp();
    await setCooldown(0);
    const player = await onboardPlayer();

    const missing = await scavenge(player.token, 'no-such-location');
    expect(missing.status).toBe(404);

    const away = await scavenge(player.token, 'drift');
    expect(away.status).toBe(409);
    expect(away.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_AT_LOCATION' },
    });

    await prisma.ship.update({
      where: { id: player.shipId },
      data: { status: 'ON_MISSION' },
    });
    const onMission = await scavenge(player.token, 'ceres');
    expect(onMission.status).toBe(409);
    expect(onMission.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it('stays allowed on a negative balance (GDD §14: dig and keep digging)', async () => {
    await freshSeededApp();
    await setCooldown(0);
    const player = await onboardPlayer();
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: -50 },
    });

    const response = await scavenge(player.token, 'ceres');
    expect(response.status).toBe(200);

    const credits = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(credits.credits).toBe(-50);
  });
});
