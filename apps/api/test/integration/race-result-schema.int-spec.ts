import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const prisma = getTestPrismaClient();

async function newPlayer(): Promise<string> {
  const account = await prisma.account.create({
    data: {
      email: `race-${randomUUID()}@example.com`,
      passwordHash: 'x',
      player: { create: { name: `p-${randomUUID().replaceAll('-', '').slice(0, 20)}` } },
    },
    include: { player: true },
  });
  return account.player!.id;
}

const result = (playerId: string, missionId: string) => ({
  playerId,
  missionId,
  routeKey: 'ceres>hedus',
  originId: 'ceres',
  destinationId: 'hedus',
  seconds: 120,
  place: 1,
  day: new Date('2026-10-28'),
});

describe('race results table', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(closeTestPrismaClient);

  it('keeps one row per mission', async () => {
    const playerId = await newPlayer();
    await prisma.raceResult.create({ data: result(playerId, 'm-1') });
    await prisma.raceResult.create({ data: result(playerId, 'm-2') });
    await expect(prisma.raceResult.create({ data: result(playerId, 'm-1') })).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it('is removed with the pilot', async () => {
    const playerId = await newPlayer();
    await prisma.raceResult.create({ data: result(playerId, 'm-1') });
    await prisma.player.delete({ where: { id: playerId } });
    expect(await prisma.raceResult.count()).toBe(0);
  });
});
