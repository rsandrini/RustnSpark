import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { MissionType } from '@prisma/client';
import { seed } from '../../prisma/seed.js';
import { OwnershipResolverModule } from '../../src/common/guards/ownership-resolver.module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { BoardService } from '../../src/missions/board.service.js';
import { MissionsModule } from '../../src/missions/missions.module.js';
import { testEnv } from '../support/app-factory.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const ALL_TYPES: readonly MissionType[] = ['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE'];

describe('mission board (S6.2)', () => {
  const originalEnv = { ...process.env };
  const prisma = getTestPrismaClient();

  let module: INestApplicationContext | undefined;
  let board: BoardService | undefined;
  let config: GameConfigService | undefined;

  beforeAll(() => {
    Object.assign(process.env, testEnv());
  });

  beforeEach(async () => {
    await seed(prisma);
    // OwnershipResolverModule is normally global through AppModule; this partial graph
    // compiles MissionsController's OwnershipGuard routes without the full app (S7.2).
    module = await Test.createTestingModule({
      imports: [ConfigModule, OwnershipResolverModule, MissionsModule],
    }).compile();
    await module.init();
    board = module.get(BoardService);
    config = module.get(GameConfigService);
  });

  afterEach(async () => {
    await module?.close();
    module = undefined;
    board = undefined;
    config = undefined;
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
    process.env = originalEnv;
  });

  it('tops a virgin location up to board_min and returns only live offers', async () => {
    const rows = await board!.getBoard('ceres', 1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.originId).toBe('ceres');
      expect(row.status).toBe('AVAILABLE');
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(typeof row.rewardEstimate).toBe('number');
    }
    const stored = await prisma.missionInstance.count({ where: { originId: 'ceres' } });
    expect(stored).toBe(rows.length);
  });

  it('boards are a mix: 10 on a big port, no two offers of one type for one destination, and at most half the board of one type, over many refreshes', async () => {
    const locations = ['ceres', 'vesta', 'hedus', 'marsa', 'cair', 'tycho'];
    for (let round = 0; round < 25; round += 1) {
      for (const locationId of locations) {
        const rows = await board!.getBoard(locationId, 1);
        expect(rows.length).toBe(10);
        const keys = rows.map(
          (row) =>
            `${row.type}>${row.destinationId}>${(row.cargo as { materialId?: string } | null)?.materialId ?? ''}`,
        );
        expect(new Set(keys).size).toBe(keys.length);
        const perType = new Map<string, number>();
        for (const row of rows) perType.set(row.type, (perType.get(row.type) ?? 0) + 1);
        expect(Math.max(...perType.values())).toBeLessThanOrEqual(5);
      }
      // let every offer run out, so the next read posts a fresh board
      await prisma.missionInstance.updateMany({
        where: { status: 'AVAILABLE' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }
  }, 60000);

  it('a board has the size of its place: 10 on a main port, 6 on a small stop, 1 on a test pad', async () => {
    expect((await board!.getBoard('ceres', 1)).length).toBe(10);
    expect((await board!.getBoard('ceres_dock', 1)).length).toBe(6);
    expect((await board!.getBoard('ceres_pad', 1)).length).toBe(1);
    const counts = await board!.countOffers(['hedus', 'tycho_slip', 'cair_pad']);
    expect(counts.get('hedus')).toBe(10);
    expect(counts.get('tycho_slip')).toBe(6);
    expect(counts.get('cair_pad')).toBe(1);
  });

  it('counting offers never waits on a board that is being topped up: it answers from what is there', async () => {
    // another request holds the board lock for hedus (a slow top-up in flight)
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(6200::int4, hashtext('hedus'::text))::text`;
        locked();
        await held;
      },
      { timeout: 30000 },
    );
    await lockTaken;
    try {
      const started = Date.now();
      const counts = await board!.countOffers(['hedus', 'tycho_slip']);
      expect(Date.now() - started).toBeLessThan(2000);
      // the busy board is counted as it stands (empty), the free one is topped up as usual
      expect(counts.get('hedus')).toBe(0);
      expect(counts.get('tycho_slip')).toBe(6);
    } finally {
      release();
      await holder;
    }
  }, 15000);

  it('a big board shows every type its place can post before any type repeats', async () => {
    const eligible = new Set<string>();
    const templates = await prisma.missionTemplate.findMany({ where: { active: true } });
    const ceres = await prisma.location.findUniqueOrThrow({ where: { id: 'ceres' } });
    for (const template of templates) {
      const req = (template.requirements ?? {}) as {
        originFactions?: string[];
        originTypes?: string[];
      };
      if (req.originFactions !== undefined && !req.originFactions.includes(ceres.factionId))
        continue;
      if (req.originTypes !== undefined && !req.originTypes.includes(ceres.type)) continue;
      eligible.add(template.type);
    }
    // TRAVEL and SCAVENGE are pilot-requested, never board offers
    eligible.delete('TRAVEL');
    eligible.delete('SCAVENGE');
    const seen = new Set<string>();
    for (let round = 0; round < 6; round += 1) {
      for (const row of await board!.getBoard('ceres', 1)) seen.add(row.type);
      await prisma.missionInstance.updateMany({
        where: { status: 'AVAILABLE' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }
    // over a few renewals the board has shown every type the place can post (a type that needs a place or
    // destination the world lacks is the only exception, and the world has them for these)
    for (const type of eligible) expect(seen.has(type)).toBe(true);
    // and one board holds at least as many different types as its place can offer, up to its size
    const one = await board!.getBoard('ceres', 1);
    expect(new Set(one.map((row) => row.type)).size).toBeGreaterThanOrEqual(
      Math.min(eligible.size, 8) - 1,
    );
  }, 60000);

  it('the extras slot: every place that can post EXPLORE holds exactly one, home ports and pirate places never do, and a second top-up adds none', async () => {
    const rules = config!.snapshot().rules;
    expect(rules.missions.board_min_extras).toBe(1);
    const explored = ['echo', 'gate', 'marsa', 'rennick', 'spur', 'vesta', 'ziggy'];
    const never = ['ceres', 'tycho', 'cair', 'hedus', 'veil', 'drift', 'nadir'];
    for (const id of [...explored, ...never]) {
      const rows = await board!.getBoard(id, 1);
      const explores = rows.filter((row) => row.type === 'EXPLORE').length;
      expect([id, explores]).toEqual([id, explored.includes(id) ? 1 : 0]);
      // the board is full: a second top-up inserts nothing (no second EXPLORE, no growth)
      const stored = await prisma.missionInstance.count({ where: { originId: id } });
      const again = await board!.getBoard(id, 1);
      expect(again.length).toBe(rows.length);
      expect(await prisma.missionInstance.count({ where: { originId: id } })).toBe(stored);
    }
  }, 120000);

  it('is idempotent: a second read adds nothing and returns the same offers', async () => {
    const first = await board!.getBoard('ceres', 1);
    const second = await board!.getBoard('ceres', 1);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(await prisma.missionInstance.count({ where: { originId: 'ceres' } })).toBe(first.length);
  });

  it('never duplicates under concurrent reads (pg_advisory_xact_lock)', async () => {
    // Raise the target so a missing lock would be visible: three racers each trying to
    // fill the board to 3 would otherwise interleave and over-insert.
    await config!.setValue(
      'missions.board_min_by_detail',
      { main: 3, regional: 3, local: 3 },
      'tester',
      'integration-test',
    );

    await Promise.all([
      board!.getBoard('hedus', 1),
      board!.getBoard('hedus', 1),
      board!.getBoard('hedus', 1),
    ]);

    const live = await prisma.missionInstance.count({
      where: { originId: 'hedus', status: 'AVAILABLE' },
    });
    // the board size is a minimum: 3 racers on a plan that needs 4 core types and 2 races end on that plan, never more
    expect(live).toBe(6);
  }, 15000);

  it('fills a port with different offers: no two share template, destination and (for mining) material', async () => {
    await config!.setValue(
      'missions.board_min_by_detail',
      { main: 6, regional: 6, local: 4 },
      'tester',
      'integration-test',
    );
    for (const port of ['ceres', 'hedus', 'cair']) {
      const rows = await board!.getBoard(port, 1);
      expect(rows.length).toBeGreaterThanOrEqual(6);
      const pairs = rows.map((row) => {
        const materialId = (row.cargo as { materialId?: string } | null)?.materialId;
        return row.type === 'MINING' && materialId !== undefined
          ? `${row.templateId}>${row.destinationId}>${materialId}`
          : `${row.templateId}>${row.destinationId}`;
      });
      expect(new Set(pairs).size).toBe(pairs.length);
    }
  }, 30000);

  it('gives every location at least one mission (GDD §12)', async () => {
    const locations = await prisma.location.findMany({ select: { id: true } });
    expect(locations.length).toBe(29);
    for (const location of locations) {
      const rows = await board!.getBoard(location.id, 1);
      if (rows.length < 1) throw new Error(`no offers at ${location.id}`);
    }
  }, 30000);

  it('replaces expired offers with no penalty: the old row flips to EXPIRED and a fresh one appears', async () => {
    await board!.getBoard('ceres', 1);
    const original = await prisma.missionInstance.findMany({
      where: { originId: 'ceres', status: 'AVAILABLE' },
    });
    expect(original.length).toBeGreaterThanOrEqual(1);

    await prisma.missionInstance.updateMany({
      where: { id: { in: original.map((row) => row.id) } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const rows = await board!.getBoard('ceres', 1);
    const originalIds = new Set(original.map((row) => row.id));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(originalIds.has(row.id)).toBe(false);
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }

    const flipped = await prisma.missionInstance.findMany({
      where: { id: { in: [...originalIds] } },
    });
    expect(flipped.length).toBe(original.length);
    for (const row of flipped) {
      expect(row.status).toBe('EXPIRED');
    }
  });

  it('scales the reward estimate with the viewer tier (D29 preview)', async () => {
    const lowTier = await board!.getBoard('ceres', 1);
    const highTier = await board!.getBoard('ceres', 3);
    expect(lowTier.length).toBeGreaterThan(0);
    const highById = new Map(highTier.map((row) => [row.id, row.rewardEstimate]));
    for (const row of lowTier) {
      const high = highById.get(row.id);
      expect(high).toBeDefined();
      expect(high!).toBeGreaterThan(row.rewardEstimate);
    }
  });

  it('covers all five mission types across board renewals', async () => {
    const seen = new Set<MissionType>();
    const locations = await prisma.location.findMany({ select: { id: true } });
    const MAX_ROUNDS = 10;
    for (let round = 0; round < MAX_ROUNDS && seen.size < ALL_TYPES.length; round += 1) {
      for (const location of locations) {
        const rows = await board!.getBoard(location.id, 1);
        for (const row of rows) seen.add(row.type);
      }
      if (seen.size < ALL_TYPES.length) {
        // Age every live offer so the next read renews the board with new epochs.
        await prisma.missionInstance.updateMany({
          where: { status: 'AVAILABLE' },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      }
    }
    for (const type of ALL_TYPES) {
      expect(seen.has(type)).toBe(true);
    }
  }, 60000);

  it('stores an Appendix E deadline on rescue missions only', async () => {
    const locations = await prisma.location.findMany({ select: { id: true } });
    for (const location of locations) {
      await board!.getBoard(location.id, 1);
    }
    const rows = await prisma.missionInstance.findMany({ where: { status: 'AVAILABLE' } });
    const rescues = rows.filter((row) => row.type === 'RESCUE');
    const others = rows.filter((row) => row.type !== 'RESCUE');
    expect(rescues.length).toBeGreaterThan(0);
    for (const row of rescues) {
      expect(row.deadlineAt).not.toBeNull();
      expect(row.deadlineAt!.getTime()).toBeGreaterThan(Date.now());
      const legs = row.legs as unknown as { distance: number }[];
      const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
      const roundTripSeconds = (totalDistance / 3) * 2.25;
      const budgetMs = row.deadlineAt!.getTime() - Date.now();
      // Deadline was stamped at generation; allow generous slack for test execution time
      // while still proving it was derived from the round-trip formula, not arbitrary.
      expect(budgetMs).toBeGreaterThan(0);
      expect(budgetMs).toBeLessThanOrEqual(roundTripSeconds * 2.0 * 1000 + 60000);
      expect(budgetMs).toBeGreaterThanOrEqual(roundTripSeconds * 1.25 * 1000 - 60000);
    }
    for (const row of others) {
      expect(row.deadlineAt).toBeNull();
    }
  }, 30000);

  it('names a material on every mining offer and a quantity when contracted', async () => {
    const locations = await prisma.location.findMany({ select: { id: true } });
    for (const location of locations) {
      await board!.getBoard(location.id, 1);
    }
    const materials = await prisma.material.findMany({ select: { id: true } });
    const materialIds = new Set(materials.map((row) => row.id));
    const mining = await prisma.missionInstance.findMany({
      where: { status: 'AVAILABLE', type: 'MINING' },
    });
    expect(mining.length).toBeGreaterThan(0);
    for (const row of mining) {
      const cargo = row.cargo as {
        materialId?: string;
        contracted?: boolean;
        quantity?: number;
      };
      expect(materialIds.has(cargo.materialId!)).toBe(true);
      if (cargo.contracted === true) {
        expect(Number.isInteger(cargo.quantity)).toBe(true);
        expect(cargo.quantity!).toBeGreaterThanOrEqual(1);
      }
    }
  }, 30000);

  it('regenerates different content after a full renewal (epoch advances with row count)', async () => {
    const first = await board!.getBoard('tycho', 1);
    expect(first.length).toBeGreaterThan(0);

    await prisma.missionInstance.updateMany({
      where: { originId: 'tycho', status: 'AVAILABLE' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await board!.getBoard('tycho', 1);
    expect(second.length).toBe(first.length);
    const firstSeeds = new Set(first.map((row) => row.seed));
    for (const row of second) {
      expect(firstSeeds.has(row.seed)).toBe(false);
    }
  });

  const pathDistance = (row: { legs: unknown }): number =>
    (row.legs as { distance: number }[]).reduce((sum, leg) => sum + leg.distance, 0);

  async function expireAll(): Promise<void> {
    await prisma.missionInstance.updateMany({
      where: { status: 'AVAILABLE' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  }

  it.each(['ceres', 'tycho', 'gate', 'hedus', 'marsa', 'rennick', 'cair'])(
    'every inner main port posts the four core types, two races, a short and a long offer, over 25 refreshes (%s)',
    async (locationId) => {
      for (let round = 0; round < 25; round += 1) {
        const rows = await board!.getBoard(locationId, 1);
        expect(rows.length).toBe(10);
        const types = new Set(rows.map((row) => row.type));
        for (const type of ['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING'] as const) {
          expect(types.has(type)).toBe(true);
        }
        expect(rows.filter((row) => row.type === 'RACE').length).toBeGreaterThanOrEqual(2);
        expect(rows.some((row) => pathDistance(row) <= 800)).toBe(true);
        expect(rows.some((row) => pathDistance(row) >= 4800)).toBe(true);
        await expireAll();
      }
    },
    60000,
  );

  it('a local stop holds what it can: delivery, transport, mining, its one race, a short and a long offer', async () => {
    for (let round = 0; round < 10; round += 1) {
      const rows = await board!.getBoard('ceres_dock', 1);
      expect(rows.length).toBe(6);
      const types = new Set(rows.map((row) => row.type));
      for (const type of ['DELIVERY', 'TRANSPORT', 'MINING', 'RACE'] as const) {
        expect(types.has(type)).toBe(true);
      }
      expect(rows.some((row) => pathDistance(row) <= 800)).toBe(true);
      expect(rows.some((row) => pathDistance(row) >= 4800)).toBe(true);
      await expireAll();
    }
  }, 60000);

  it('ziggy has no trip under 10 minutes and still posts its nearest destination as the short one', async () => {
    for (let round = 0; round < 10; round += 1) {
      const rows = await board!.getBoard('ziggy', 1);
      expect(rows.length).toBeGreaterThan(0);
      expect(Math.min(...rows.map(pathDistance))).toBe(900);
      await expireAll();
    }
  }, 60000);

  it('drift (pirates, no givers, no race) still fills its board', async () => {
    const rows = await board!.getBoard('drift', 1);
    expect(rows.length).toBe(10);
    const types = new Set(rows.map((row) => row.type));
    expect(types.has('RACE')).toBe(false);
    expect(types.has('DELIVERY')).toBe(true);
    expect(types.has('TRANSPORT')).toBe(true);
  }, 60000);

  it('a held long offer leaves the board and the refill posts another long one', async () => {
    const first = await board!.getBoard('ceres', 1);
    const longs = first.filter((row) => pathDistance(row) >= 4800);
    expect(longs.length).toBeGreaterThan(0);
    const player = await prisma.account.create({
      data: {
        email: `held-${Date.now()}@example.com`,
        passwordHash: 'x',
        status: 'ACTIVE',
        player: { create: { name: `held-${Date.now()}`, locale: 'en' } },
      },
      include: { player: true },
    });
    // hold every long offer: the board has none left, so the refill must post a long one
    await prisma.missionInstance.updateMany({
      where: { id: { in: longs.map((row) => row.id) } },
      data: { status: 'HELD', playerId: player.player!.id },
    });
    const heldIds = new Set(longs.map((row) => row.id));
    const rows = await board!.getBoard('ceres', 1);
    expect(rows.length).toBe(10);
    expect(rows.some((row) => !heldIds.has(row.id) && pathDistance(row) >= 4800)).toBe(true);
  }, 60000);

  it('a private starter offer does not count toward the mix', async () => {
    const account = await prisma.account.create({
      data: {
        email: `starter-${Date.now()}@example.com`,
        passwordHash: 'x',
        status: 'ACTIVE',
        player: { create: { name: `starter-${Date.now()}`, locale: 'en' } },
      },
      include: { player: true },
    });
    const created = await board!.createStarterOffer({
      playerId: account.player!.id,
      locationId: 'ceres',
      types: ['DELIVERY'],
      isTakeable: () => true,
    });
    expect(created).toBe(true);
    await board!.getBoard('ceres', 1);
    // every shared short offer runs out while the starter offer (a short one) is still live
    await prisma.missionInstance.updateMany({
      where: { originId: 'ceres', status: 'AVAILABLE', privatePlayerId: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const rows = await board!.getBoard('ceres', 1);
    const shared = rows.filter((row) => row.privatePlayerId === null);
    expect(shared.length).toBe(10);
    expect(shared.some((row) => pathDistance(row) <= 800)).toBe(true);
  }, 60000);

  it('a high board_min_races still fills the board to its size and ends', async () => {
    await config!.setValue('missions.board_min_races', 6, 'tester', 'integration-test');
    const rows = await board!.getBoard('ceres', 1);
    expect(rows.length).toBe(10);
    expect(rows.filter((row) => row.type === 'RACE').length).toBeLessThanOrEqual(5);
  }, 60000);

  it('returns an empty board for an unknown location', async () => {
    const rows = await board!.getBoard('no-such-location', 1);
    expect(rows).toEqual([]);
  });
});
