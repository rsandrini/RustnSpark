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

  it('boards are a mix: 8 on a big port, no two offers of one type for one destination, and at most half the board of one type, over many refreshes', async () => {
    const locations = ['ceres', 'vesta', 'hedus', 'marsa', 'cair', 'tycho'];
    for (let round = 0; round < 25; round += 1) {
      for (const locationId of locations) {
        const rows = await board!.getBoard(locationId, 1);
        expect(rows.length).toBe(8);
        const keys = rows.map(
          (row) =>
            `${row.type}>${row.destinationId}>${(row.cargo as { materialId?: string } | null)?.materialId ?? ''}`,
        );
        expect(new Set(keys).size).toBe(keys.length);
        const perType = new Map<string, number>();
        for (const row of rows) perType.set(row.type, (perType.get(row.type) ?? 0) + 1);
        expect(Math.max(...perType.values())).toBeLessThanOrEqual(4);
      }
      // let every offer run out, so the next read posts a fresh board
      await prisma.missionInstance.updateMany({
        where: { status: 'AVAILABLE' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }
  }, 60000);

  it('a board has the size of its place: 8 on a main port, 4 on a small stop, 1 on a test pad', async () => {
    expect((await board!.getBoard('ceres', 1)).length).toBe(8);
    expect((await board!.getBoard('ceres_dock', 1)).length).toBe(4);
    expect((await board!.getBoard('ceres_pad', 1)).length).toBe(1);
    const counts = await board!.countOffers(['hedus', 'tycho_slip', 'cair_pad']);
    expect(counts.get('hedus')).toBe(8);
    expect(counts.get('tycho_slip')).toBe(4);
    expect(counts.get('cair_pad')).toBe(1);
  });

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
    expect(live).toBe(3);
  }, 15000);

  it('fills a port with different offers: no two share both template and destination', async () => {
    await config!.setValue(
      'missions.board_min_by_detail',
      { main: 6, regional: 6, local: 4 },
      'tester',
      'integration-test',
    );
    for (const port of ['ceres', 'hedus', 'cair']) {
      const rows = await board!.getBoard(port, 1);
      expect(rows.length).toBeGreaterThanOrEqual(6);
      const pairs = rows.map((row) => `${row.templateId}>${row.destinationId}`);
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

  it('returns an empty board for an unknown location', async () => {
    const rows = await board!.getBoard('no-such-location', 1);
    expect(rows).toEqual([]);
  });
});
