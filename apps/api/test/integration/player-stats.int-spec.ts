import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Clock } from '../../src/common/clock/clock.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { PlayerStatsService } from '../../src/stats/player-stats.service.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const prisma = getTestPrismaClient();

class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }
  override now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
}

async function newPlayer(): Promise<string> {
  const account = await prisma.account.create({
    data: {
      email: `stats-${randomUUID()}@example.com`,
      passwordHash: 'x',
      player: { create: { name: `p-${randomUUID().replaceAll('-', '').slice(0, 20)}` } },
    },
    include: { player: true },
  });
  return account.player!.id;
}

describe('PlayerStatsService', () => {
  const clock = new FixedClock(new Date('2026-10-27T10:00:00Z'));
  const stats = new PlayerStatsService(prisma as unknown as PrismaService, clock);

  beforeEach(async () => {
    await resetDatabase(prisma);
    clock.set(new Date('2026-10-27T10:00:00Z'));
  });
  afterAll(closeTestPrismaClient);

  it('adds to the lifetime row and to today, creating both, and sums on the next call', async () => {
    const playerId = await newPlayer();
    await prisma.$transaction((tx) => stats.add(playerId, { 'flight.distance': 40 }, tx));
    await prisma.$transaction((tx) =>
      stats.add(playerId, { 'flight.distance': 2, 'fights.won': 1 }, tx),
    );
    const read = await stats.read(playerId);
    expect(read.totals).toEqual({ 'flight.distance': 42, 'fights.won': 1 });
    const daily = await prisma.playerStatsDaily.findMany({ where: { playerId } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.totals).toEqual({ 'flight.distance': 42, 'fights.won': 1 });
  });

  it('keeps one daily row per UTC day', async () => {
    const playerId = await newPlayer();
    await prisma.$transaction((tx) => stats.add(playerId, { 'fights.won': 1 }, tx));
    clock.set(new Date('2026-10-28T00:00:01Z'));
    await prisma.$transaction((tx) => stats.add(playerId, { 'fights.won': 1 }, tx));
    const days = await prisma.playerStatsDaily.findMany({
      where: { playerId },
      orderBy: { day: 'asc' },
    });
    expect(days.map((row) => row.totals)).toEqual([{ 'fights.won': 1 }, { 'fights.won': 1 }]);
    expect((await stats.read(playerId)).totals).toEqual({ 'fights.won': 2 });
  });

  it('does not lose counts when two transactions add at once', async () => {
    const playerId = await newPlayer();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) => stats.add(playerId, { 'missions.started': 1 }, tx)),
      ),
    );
    expect((await stats.read(playerId)).totals).toEqual({ 'missions.started': 10 });
  });

  it('writes nothing when the transaction rolls back, and skips zero and non-finite values', async () => {
    const playerId = await newPlayer();
    await expect(
      prisma.$transaction(async (tx) => {
        await stats.add(playerId, { 'fights.won': 3 }, tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.playerStats.count()).toBe(0);
    await prisma.$transaction((tx) =>
      stats.add(playerId, { 'fights.won': 0, 'fights.lost': Number.NaN }, tx),
    );
    expect(await prisma.playerStats.count()).toBe(0);
  });

  it('keeps the best value: the highest for a max record, the lowest for a min record', async () => {
    const playerId = await newPlayer();
    await prisma.$transaction(async (tx) => {
      await stats.best(playerId, 'best.payout', 500, tx, { missionId: 'm1' });
      await stats.best(playerId, 'best.payout', 300, tx, { missionId: 'm2' });
      await stats.best(playerId, 'best.race_place', 3, tx);
      await stats.best(playerId, 'best.race_place', 1, tx);
      await stats.best(playerId, 'best.race_place', 2, tx);
    });
    const { records } = await stats.read(playerId);
    expect(records['best.payout']).toMatchObject({ value: 500, missionId: 'm1' });
    expect(records['best.race_place']?.value).toBe(1);
  });

  it('sets the last active time, and the first mission time only once', async () => {
    const playerId = await newPlayer();
    await stats.touch(playerId);
    expect((await stats.read(playerId)).lastActiveAt).toEqual(new Date('2026-10-27T10:00:00Z'));
    expect((await stats.read(playerId)).firstMissionAt).toBeNull();
    await stats.touch(playerId, undefined, { markMission: true });
    clock.set(new Date('2026-10-29T08:00:00Z'));
    await stats.touch(playerId, undefined, { markMission: true });
    const read = await stats.read(playerId);
    expect(read.firstMissionAt).toEqual(new Date('2026-10-27T10:00:00Z'));
    expect(read.lastActiveAt).toEqual(new Date('2026-10-29T08:00:00Z'));
  });

  it('reads empties for a pilot with no row', async () => {
    const playerId = await newPlayer();
    expect(await stats.read(playerId)).toEqual({
      totals: {},
      records: {},
      firstMissionAt: null,
      lastActiveAt: null,
    });
  });
});
