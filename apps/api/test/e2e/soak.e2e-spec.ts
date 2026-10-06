import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';
import type { DispatchJobData } from '../../src/missions/dispatch.service.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { WalletService } from '../../src/players/wallet.service.js';
import {
  bearer,
  createSecurityWorld,
  type Actor,
  type SecurityWorld,
} from '../security/support.js';
import { resetDatabase } from '../support/test-db.js';
import { seed } from '../../prisma/seed.js';
import { GameConfigService } from '../../src/config/game-config.service.js';

// S12.3 concurrency soak. The unit of trust here is the database, not the happy path: many
// requests race for the same money, mission, ship or job, and afterwards the WORLD must still
// add up. After every scenario `assertWorldInvariants` checks, for the whole database:
//   - nobody has a negative balance (no scenario here uses the rescue/mission-penalty path);
//   - every balance equals the sum of that player's wallet events (the ledger is complete: no
//     lost update, no movement without a record);
//   - one payout per mission, one log per mission, one Encounter per (pair, route, leg);
//   - a part is installed only on a ship of its owner; a player has at most one active mission.
// Requires the compose `test` profile (pnpm test:e2e).

const PARALLEL = 25;

describe('concurrency soak (S12.3)', () => {
  let world: SecurityWorld;
  let queue: Queue;
  let wallet: WalletService;
  // One real listening socket: supertest would otherwise open an ephemeral one per request, and
  // dozens of simultaneous ephemeral binds reset connections (a harness artefact, not the API).
  let base: string;

  beforeAll(async () => {
    world = await createSecurityWorld();
    queue = world.app.get(getQueueToken(MISSION_QUEUE_NAME));
    wallet = world.app.get(WalletService);
    await world.app.listen(0);
    base = await world.app.getUrl();
  });
  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await world?.close();
  });
  beforeEach(async () => {
    await resetDatabase(world.prisma);
    await seed(world.prisma);
    await world.app.get(GameConfigService).refresh();
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  async function assertWorldInvariants(): Promise<void> {
    const { prisma } = world;

    expect(await prisma.player.count({ where: { credits: { lt: 0 } } })).toBe(0);

    const balances = await prisma.$queryRaw<Array<{ id: string; credits: number; ledger: bigint }>>`
      SELECT p."id", p."credits",
             COALESCE((SELECT SUM(e."creditsDelta") FROM "PlayerEvent" e
                       WHERE e."playerId" = p."id" AND e."type" IN ('wallet.credit', 'wallet.debit')), 0) AS ledger
      FROM "Player" p
    `;
    const unbalanced = balances.filter((row) => Number(row.ledger) !== row.credits);
    expect(
      unbalanced.map((row) => ({ id: row.id, credits: row.credits, ledger: Number(row.ledger) })),
    ).toEqual([]);

    const payouts = await prisma.$queryRaw<Array<{ reason: string; n: bigint }>>`
      SELECT e."payload"->>'reason' AS reason, COUNT(*) AS n
      FROM "PlayerEvent" e
      WHERE e."type" IN ('wallet.credit', 'wallet.debit') AND e."payload"->>'reason' LIKE 'mission:%:payout'
      GROUP BY 1 HAVING COUNT(*) > 1
    `;
    expect(payouts).toEqual([]);

    const duplicateLogs = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM "MissionLog" GROUP BY "missionId" HAVING COUNT(*) > 1
    `;
    expect(duplicateLogs).toEqual([]);

    const duplicateEncounters = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM "Encounter"
      GROUP BY LEAST("missionAId", "missionBId"), GREATEST("missionAId", "missionBId"), "routeId", "legIndex"
      HAVING COUNT(*) > 1
    `;
    expect(duplicateEncounters).toEqual([]);

    const strayParts = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT pi."id" FROM "PartInstance" pi
      JOIN "Ship" s ON s."id" = pi."shipId"
      WHERE pi."location" = 'INSTALLED' AND pi."ownerPlayerId" <> s."ownerPlayerId"
    `;
    expect(strayParts).toEqual([]);

    const doubleBooked = await prisma.$queryRaw<Array<{ playerId: string }>>`
      SELECT "playerId" FROM "MissionInstance"
      WHERE "status" IN ('ACCEPTED', 'IN_TRANSIT', 'RESOLVING') AND "playerId" IS NOT NULL
      GROUP BY "playerId" HAVING COUNT(*) > 1
    `;
    expect(doubleBooked).toEqual([]);
  }

  /** Gives a player exactly `amount` more credits THROUGH the wallet, so the ledger stays whole. */
  async function fund(player: Actor, amount: number): Promise<void> {
    await wallet.credit(player.playerId, amount, 'soak.fund');
  }

  const credits = async (player: Actor): Promise<number> =>
    (await world.prisma.player.findUniqueOrThrow({ where: { id: player.playerId } })).credits;

  async function acceptedMission(
    player: Actor,
    overrides: { zone?: number } = {},
  ): Promise<MissionInstance> {
    const template = await world.prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const route = await world.prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return world.prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [30, 10].map((distance) => ({
          routeId: route.id,
          distance,
          danger: 1,
          zone: overrides.zone ?? 0,
          env: { id: 'belt', level: 1, fuelMult: 1 },
        })),
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `soak-${randomUUID()}`,
        status: 'ACCEPTED',
        playerId: player.playerId,
        shipId: player.shipId!,
        acceptedAt: new Date(),
      },
    });
  }

  it('parallel buys: exactly as many succeed as the balance affords, and the ledger balances', async () => {
    const player = await world.makePlayer();
    const market = await request(base).get('/v1/locations/ceres/market').set(bearer(player.token));
    const listing = (
      market.body as { listings: Array<{ listingId: string; kind: string; price: number }> }
    ).listings.find((entry) => entry.kind === 'catalog')!;

    // Start from an exact budget for three units so "how many may win" has one right answer.
    const current = await credits(player);
    if (current > listing.price * 3) {
      await wallet.debit(player.playerId, current - listing.price * 3, 'soak.trim');
    } else {
      await fund(player, listing.price * 3 - current);
    }
    const partsBefore = await world.prisma.partInstance.count({
      where: { ownerPlayerId: player.playerId },
    });

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(base)
          .post('/v1/market/buy')
          .set(bearer(player.token))
          .send({ listingId: listing.listingId, expectedPrice: listing.price }),
      ),
    );
    const wins = results.filter((response) => response.status === 200).length;
    expect(wins).toBe(3);
    expect(results.filter((response) => response.status >= 500)).toEqual([]);
    expect(await credits(player)).toBe(0);
    expect(
      await world.prisma.partInstance.count({ where: { ownerPlayerId: player.playerId } }),
    ).toBe(partsBefore + 3);
    await assertWorldInvariants();
  });

  it('parallel retries of ONE purchase (same Idempotency-Key) charge once', async () => {
    const player = await world.makePlayer();
    const market = await request(base).get('/v1/locations/ceres/market').set(bearer(player.token));
    const listing = (
      market.body as { listings: Array<{ listingId: string; kind: string; price: number }> }
    ).listings.find((entry) => entry.kind === 'catalog')!;
    await fund(player, listing.price * PARALLEL);
    const before = await credits(player);
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(base)
          .post('/v1/market/buy')
          .set({ ...bearer(player.token), 'Idempotency-Key': key })
          .send({ listingId: listing.listingId, expectedPrice: listing.price }),
      ),
    );
    // One executes, the rest either replay it (200) or are told it is in progress (409).
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await credits(player)).toBe(before - listing.price);
    await assertWorldInvariants();
  });

  it('parallel accepts of one mission by many players: exactly one winner', async () => {
    const players = await Promise.all(Array.from({ length: 12 }, () => world.makePlayer()));
    const template = await world.prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const mission = await world.prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [{ distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } }],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `soak-${randomUUID()}`,
        status: 'AVAILABLE',
      },
    });

    const results = await Promise.all(
      players.map((player) =>
        request(base)
          .post(`/v1/missions/${mission.id}/accept`)
          .set(bearer(player.token))
          .send({ shipId: player.shipId }),
      ),
    );
    const winners = results
      .map((r, i) => ({ status: r.status, player: players[i]! }))
      .filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    const stored = await world.prisma.missionInstance.findUniqueOrThrow({
      where: { id: mission.id },
    });
    expect(stored.status).toBe('ACCEPTED');
    expect(stored.playerId).toBe(winners[0]!.player.playerId);
    await assertWorldInvariants();
  });

  it('parallel dispatches of one accepted mission: one flight, one set of presences, one job', async () => {
    const player = await world.makePlayer();
    const mission = await acceptedMission(player);

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(base)
          .post(`/v1/ships/${player.shipId}/dispatch`)
          .set(bearer(player.token))
          .send({ missionId: mission.id }),
      ),
    );
    // A repeat dispatch of a flight already under way replays it (200, same arrival): what must
    // hold is that there is ONE flight, whatever number of callers were told about it.
    const flown = results.filter((r) => r.status === 200);
    expect(flown.length).toBeGreaterThanOrEqual(1);
    expect(new Set(flown.map((r) => (r.body as { arrivalAt: string }).arrivalAt)).size).toBe(1);
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    expect(await world.prisma.routePresence.count({ where: { missionId: mission.id } })).toBe(2);
    const jobs = await queue.getJobs(['delayed', 'waiting', 'active']);
    expect(
      jobs.filter((job) => (job.data as DispatchJobData).missionId === mission.id),
    ).toHaveLength(1);
    expect(
      (await world.prisma.ship.findUniqueOrThrow({ where: { id: player.shipId! } })).status,
    ).toBe('ON_MISSION');
    await assertWorldInvariants();
  });

  it('parallel repairs of one ship: never a negative balance, never a double charge', async () => {
    const player = await world.makePlayer();
    const parts = await world.prisma.partInstance.findMany({
      where: { ownerPlayerId: player.playerId, shipId: player.shipId!, location: 'INSTALLED' },
    });
    await world.prisma.partInstance.updateMany({
      where: { id: { in: parts.map((part) => part.id) } },
      data: { condition: 20 },
    });
    await fund(player, 5_000);
    const before = await credits(player);

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        request(base)
          .post(`/v1/ships/${player.shipId}/repair`)
          .set(bearer(player.token))
          .send({ targets: parts.map((part) => ({ partInstanceId: part.id, toCondition: 100 })) }),
      ),
    );
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    const started = results.filter((r) => r.status === 200).length;
    expect(started).toBe(1); // one PENDING job per ship is the hard guard
    const jobs = await world.prisma.repairJob.findMany({ where: { shipId: player.shipId! } });
    expect(jobs).toHaveLength(1);
    expect(await credits(player)).toBe(before - jobs[0]!.cost);
    await assertWorldInvariants();
  });

  it('parallel resolutions of one mission: one log, one payout, no duplicate effects', async () => {
    const player = await world.makePlayer();
    const mission = await acceptedMission(player);
    await request(base)
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(bearer(player.token))
      .send({ missionId: mission.id })
      .expect(200);
    const job = (await queue.getJobs(['delayed', 'waiting'])).find(
      (entry) => (entry.data as DispatchJobData).missionId === mission.id,
    )!;
    const resolver = world.app.get(MissionResolveService);

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () => resolver.resolve(job.data as DispatchJobData)),
    );
    // Losers of the race may be rejected by the MissionLog unique key or short-circuit as
    // skipped; what must hold is that exactly ONE invocation committed effects.
    expect(
      settled.filter((r) => r.status === 'fulfilled' && !r.value.skipped).length,
    ).toBeGreaterThanOrEqual(1);
    expect(await world.prisma.missionLog.count({ where: { missionId: mission.id } })).toBe(1);
    const payoutEvents = await world.prisma.playerEvent.count({
      where: { playerId: player.playerId, type: 'mission.resolved' },
    });
    expect(payoutEvents).toBe(1);
    await assertWorldInvariants();
  });

  it('two players resolving overlapping missions at once: at most one Encounter per pair, route and leg', async () => {
    const [a, b] = await Promise.all([world.makePlayer(), world.makePlayer()]);
    const missions = [await acceptedMission(a, { zone: 3 }), await acceptedMission(b, { zone: 3 })];
    for (const [player, mission] of [
      [a, missions[0]!],
      [b, missions[1]!],
    ] as const) {
      await request(base)
        .post(`/v1/ships/${player.shipId}/dispatch`)
        .set(bearer(player.token))
        .send({ missionId: mission.id })
        .expect(200);
    }
    const jobs = await queue.getJobs(['delayed', 'waiting']);
    const resolver = world.app.get(MissionResolveService);

    await Promise.allSettled(
      jobs.flatMap((job) =>
        Array.from({ length: 3 }, () => resolver.resolve(job.data as DispatchJobData)),
      ),
    );
    expect(await world.prisma.missionLog.count()).toBe(2);
    expect(await world.prisma.encounter.count()).toBeGreaterThan(0);
    await assertWorldInvariants();
  }, 15000);
});
