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
import { MISSION_QUEUE_NAME, REPAIR_QUEUE_NAME } from '../../src/jobs/queues.js';
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

interface MaterialHolding {
  materialId: string;
  quantity: number;
  unitPrice: number;
}

interface MarketListingBody {
  locationId: string;
  listings: {
    listingId: string;
    kind: string;
    partType: string;
    price: number;
  }[];
}

// M8 gate (plan line 491): "Complete economic loop through the API; money invariants
// hold under parallel requests." Test 1 walks the whole loop — earn (mission payout +
// mined loot), sell the loot, refuel, buy a part, dispatch again — and then checks the
// core money invariant: the balance is exactly the start balance plus the sum of every
// recorded wallet movement. Test 2 attacks the invariant from the concurrency side.
describe('economy milestone M8', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let missionQueue: Queue;
  let repairQueue: Queue;
  let processor: MissionProcessor;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    repairQueue = testApp.app.get(getQueueToken(REPAIR_QUEUE_NAME));
    // Constructed directly (same as the resolve-processor spec) so no competing BullMQ
    // Worker boots; the job is taken off the queue and resolved synchronously.
    processor = new MissionProcessor(testApp.app.get(MissionResolveService));
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

  function post(
    token: string,
    path: string,
    key: string | undefined,
    body?: Record<string, unknown>,
  ) {
    const req = request(httpServer(testApp.app)).post(path).set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return body === undefined ? req : req.send(body);
  }

  function get(token: string, path: string) {
    return request(httpServer(testApp.app)).get(path).set(auth(token));
  }

  async function createMission(
    player: AuthPair,
    seedValue: string,
    type: 'MINING' | 'DELIVERY',
    originId: string,
    destinationId: string,
    cargo: Record<string, string>,
  ) {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type },
      orderBy: { id: 'asc' },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type,
        factionId: template.factionId,
        originId,
        destinationId,
        legs: [
          {
            routeId: route.id,
            distance: 150,
            danger: 0,
            zone: 0,
            env: { id: 'debris', level: 1, fuelMult: 1 },
          },
        ],
        cargo,
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: seedValue,
        status: 'ACCEPTED',
        playerId: player.seeded.player.id,
        shipId: player.shipId,
        acceptedAt: new Date(),
      },
    });
  }

  async function currentCredits(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }

  async function walletMovement(playerId: string): Promise<number> {
    const events = await prisma.playerEvent.findMany({
      where: { playerId, type: { in: ['wallet.credit', 'wallet.debit'] } },
      select: { creditsDelta: true },
    });
    return events.reduce((sum, event) => sum + (event.creditsDelta ?? 0), 0);
  }

  it('closes the loop: earn → sell → refuel → buy → dispatch again, balance = Σ movements', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    // Mining rig + solar panel: the rig yields the loot, the panel keeps the hull viable.
    //
    // Created in INVENTORY and placed through the real auto-assemble endpoint, not a raw
    // `location: 'INSTALLED'` write: Connectors v0.1's connectivity graph walks ship.layout's
    // own placements, so a part with no placement there is invisible to it (and counts as
    // disconnected, zeroing exactly the `min` stat this test depends on).
    const rig = await prisma.partInstance.create({
      data: {
        partType: 'mining_rig',
        ownerPlayerId: player.seeded.player.id,
        condition: 100,
        location: 'INVENTORY',
      },
    });
    const reactor = await prisma.partInstance.create({
      data: {
        partType: 'reactor_solar',
        ownerPlayerId: player.seeded.player.id,
        condition: 100,
        location: 'INVENTORY',
      },
    });
    const installedBefore = await prisma.partInstance.findMany({
      where: { ownerPlayerId: player.seeded.player.id, location: 'INSTALLED', shipId: player.shipId },
      select: { id: true },
    });
    const autoAssembleResponse = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/auto-assemble`)
      .set(auth(player.token))
      .send({ partInstanceIds: [...installedBefore.map((p) => p.id), rig.id, reactor.id] });
    expect(autoAssembleResponse.status).toBe(200);
    // Enough fuel to launch, little enough that the tank still needs a paid top-up.
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 60 } });

    // 1. Earn: payout and mined loot land together when the worker resolves the mission.
    const mission = await createMission(player, 'm8-loop-seed', 'MINING', 'ceres', 'hedus', {
      materialId: 'common_ore',
    });
    const dispatched = await post(player.token, `/v1/ships/${player.shipId}/dispatch`, undefined, {
      missionId: mission.id,
    });
    expect(dispatched.status).toBe(200);
    const job = await missionQueue.getJob(mission.id);
    expect(job).toBeTruthy();
    const result = await processor.process(job as Job<DispatchJobData>);
    expect(result.status).toBe('DONE');
    expect(result.credited).toBeGreaterThan(0);

    const shipAfterMission = await prisma.ship.findUniqueOrThrow({
      where: { id: player.shipId },
    });
    expect(shipAfterMission.currentLocationId).toBe('hedus');
    expect(shipAfterMission.status).toBe('IN_PORT');

    // 2. Sell the loot at the port the ship is docked at.
    const listed = await get(player.token, '/v1/materials');
    expect(listed.status).toBe(200);
    const holdings = (listed.body as { materials: MaterialHolding[] }).materials;
    expect(holdings).toHaveLength(1);
    const holding = holdings[0]!;
    expect(holding.quantity).toBeGreaterThan(0);

    const salePrice = holding.unitPrice * holding.quantity;
    const sold = await post(player.token, '/v1/market/sell-material', randomUUID(), {
      materialId: holding.materialId,
      quantity: holding.quantity,
      expectedPrice: salePrice,
    });
    expect(sold.status).toBe(200);
    expect(sold.body).toMatchObject({ price: salePrice });
    expect(await get(player.token, '/v1/materials')).toHaveProperty('body.materials', []);

    // 3. Spend: a partial refuel of 10 units (tank is far from full after the burn).
    const refueled = await post(player.token, `/v1/ships/${player.shipId}/refuel`, randomUUID(), {
      mode: 'partial',
      amount: 10,
    });
    expect(refueled.status).toBe(200);
    expect(refueled.body).toMatchObject({ units: 10 });
    expect((refueled.body as { cost: number }).cost).toBeGreaterThan(0);

    // 4. Spend: buy the cheapest listing this balance can cover, at the ship's port.
    const ship = await prisma.ship.findUniqueOrThrow({
      where: { id: player.shipId },
      select: { currentLocationId: true },
    });
    const balanceBefore = await currentCredits(player.seeded.player.id);
    const board = await get(player.token, `/v1/locations/${ship.currentLocationId}/market`);
    expect(board.status).toBe(200);
    const affordable = (board.body as MarketListingBody).listings
      .filter(
        (entry) => entry.kind === 'catalog' && entry.price > 0 && entry.price <= balanceBefore,
      )
      .sort((left, right) => left.price - right.price);
    expect(affordable.length).toBeGreaterThan(0);
    const listing = affordable[0]!;
    const bought = await post(player.token, '/v1/market/buy', randomUUID(), {
      listingId: listing.listingId,
      expectedPrice: listing.price,
    });
    expect(bought.status).toBe(200);

    // 5. The loop closes: the ship takes another mission from the port it just traded at.
    const second = await createMission(player, 'm8-loop-second', 'DELIVERY', 'hedus', 'marsa', {});
    const redispatched = await post(
      player.token,
      `/v1/ships/${player.shipId}/dispatch`,
      undefined,
      { missionId: second.id },
    );
    expect(redispatched.status).toBe(200);

    // Money invariant: the balance is exactly the sum of the recorded wallet movements
    // (the seeded player starts at 0; onboarding's 200 is movement #1) — no silent
    // writes anywhere along the loop.
    const credits = await currentCredits(player.seeded.player.id);
    const movement = await walletMovement(player.seeded.player.id);
    expect(credits).toBe(movement);
    // onboarding credit, mission payout, material sale, refuel debit, part purchase
    await expect(
      prisma.playerEvent.count({
        where: {
          playerId: player.seeded.player.id,
          type: { in: ['wallet.credit', 'wallet.debit'] },
        },
      }),
    ).resolves.toBe(5);
    expect(movement).toBe(
      200 + result.credited + salePrice - (refueled.body as { cost: number }).cost - listing.price,
    );
  }, 30_000);

  it('money invariants under parallelism: concurrent sells cannot oversell the stack', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.playerMaterial.upsert({
      where: {
        playerId_materialId: {
          playerId: player.seeded.player.id,
          materialId: 'common_ore',
        },
      },
      create: { playerId: player.seeded.player.id, materialId: 'common_ore', quantity: 10 },
      update: { quantity: 10 },
    });

    // The unit price comes from the same formula the API uses (materials endpoint).
    const listed = await get(player.token, '/v1/materials');
    expect(listed.status).toBe(200);
    const holding = (listed.body as { materials: MaterialHolding[] }).materials[0]!;
    const unit = holding.unitPrice;
    expect(unit).toBeGreaterThan(0);

    // Six concurrent sales of 4 against a stack of 10: the conditional UPDATE lets exactly
    // floor(10/4) = 2 through, no matter how the requests interleave.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(player.token, '/v1/market/sell-material', randomUUID(), {
          materialId: 'common_ore',
          quantity: 4,
          expectedPrice: unit * 4,
        }),
      ),
    );
    const succeeded = responses.filter((response) => response.status === 200);
    const rejected = responses.filter((response) => response.status === 400);
    expect(succeeded).toHaveLength(2);
    expect(rejected).toHaveLength(4);
    for (const response of rejected) {
      expect(response.body).toMatchObject({
        statusCode: 400,
        message: { error: 'INSUFFICIENT_MATERIALS' },
      });
    }

    const row = await prisma.playerMaterial.findUnique({
      where: {
        playerId_materialId: {
          playerId: player.seeded.player.id,
          materialId: 'common_ore',
        },
      },
    });
    expect(row?.quantity).toBe(2);

    const credits = await currentCredits(player.seeded.player.id);
    const movement = await walletMovement(player.seeded.player.id);
    expect(credits).toBe(movement);
    expect(movement).toBe(200 + 2 * (unit * 4));
  }, 30_000);
});
