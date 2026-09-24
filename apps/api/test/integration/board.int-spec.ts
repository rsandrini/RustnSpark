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

  it('is idempotent: a second read adds nothing and returns the same offers', async () => {
    const first = await board!.getBoard('ceres', 1);
    const second = await board!.getBoard('ceres', 1);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(await prisma.missionInstance.count({ where: { originId: 'ceres' } })).toBe(first.length);
  });

  it('never duplicates under concurrent reads (pg_advisory_xact_lock)', async () => {
    // Raise the target so a missing lock would be visible: three racers each trying to
    // fill the board to 3 would otherwise interleave and over-insert.
    await config!.setValue('missions.board_min_per_location', 3, 'tester', 'integration-test');

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

  it('gives every location at least one mission (GDD §12)', async () => {
    const locations = await prisma.location.findMany({ select: { id: true } });
    expect(locations.length).toBe(12);
    for (const location of locations) {
      const rows = await board!.getBoard(location.id, 1);
      expect(rows.length).toBeGreaterThanOrEqual(1);
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
