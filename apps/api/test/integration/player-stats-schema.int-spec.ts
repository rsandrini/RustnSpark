import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  closeTestPrismaClient,
  getTestPrismaClient,
  resetDatabase,
} from '../support/test-db.js';

const prisma = getTestPrismaClient();

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

describe('player stats tables', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(closeTestPrismaClient);

  it('keeps one lifetime row and one row per day for a pilot', async () => {
    const playerId = await newPlayer();
    await prisma.playerStats.create({ data: { playerId } });
    await prisma.playerStatsDaily.create({ data: { playerId, day: new Date('2026-10-27') } });
    await prisma.playerStatsDaily.create({ data: { playerId, day: new Date('2026-10-28') } });
    await expect(
      prisma.playerStatsDaily.create({ data: { playerId, day: new Date('2026-10-27') } }),
    ).rejects.toThrow(/Unique constraint/);
    const stats = await prisma.playerStats.findUniqueOrThrow({ where: { playerId } });
    expect(stats.totals).toEqual({});
    expect(stats.records).toEqual({});
  });

  it('is removed with the pilot', async () => {
    const playerId = await newPlayer();
    await prisma.playerStats.create({ data: { playerId } });
    await prisma.playerStatsDaily.create({ data: { playerId, day: new Date('2026-10-27') } });
    await prisma.player.delete({ where: { id: playerId } });
    expect(await prisma.playerStats.count()).toBe(0);
    expect(await prisma.playerStatsDaily.count()).toBe(0);
  });
});
