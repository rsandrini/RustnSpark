import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Clock } from '../../src/common/clock/clock.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { RankingsService } from '../../src/stats/rankings.service.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const prisma = getTestPrismaClient();

class FixedClock extends Clock {
  override now(): Date {
    return new Date('2026-10-28T12:00:00Z'); // a Wednesday: the week began 2026-10-26
  }
}
const rankings = new RankingsService(prisma as unknown as PrismaService, new FixedClock());

interface PilotOptions {
  name?: string;
  joined?: string;
  banned?: boolean;
  factionId?: string;
}

async function pilot(options: PilotOptions = {}): Promise<string> {
  const name = options.name ?? `p-${randomUUID().replaceAll('-', '').slice(0, 14)}`;
  const account = await prisma.account.create({
    data: {
      email: `rank-${randomUUID()}@example.com`,
      passwordHash: 'x',
      status: options.banned === true ? 'BANNED' : 'ACTIVE',
      player: {
        create: {
          name,
          factionId: options.factionId ?? null,
          ...(options.joined !== undefined ? { createdAt: new Date(options.joined) } : {}),
        },
      },
    },
    include: { player: true },
  });
  return account.player!.id;
}

async function lifetime(playerId: string, totals: Record<string, number>): Promise<void> {
  await prisma.playerStats.create({ data: { playerId, totals } });
}

async function day(playerId: string, date: string, totals: Record<string, number>): Promise<void> {
  await prisma.playerStatsDaily.create({ data: { playerId, day: new Date(date), totals } });
}

async function race(playerId: string, seconds: number, date: string, route = 'ceres>hedus') {
  const [originId, destinationId] = route.split('>') as [string, string];
  await prisma.raceResult.create({
    data: {
      playerId,
      missionId: randomUUID(),
      routeKey: route,
      originId,
      destinationId,
      seconds,
      place: 1,
      day: new Date(date),
    },
  });
}

describe('RankingsService', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(closeTestPrismaClient);

  it('ranks the lifetime distance board, biggest first, with the faction and the own row', async () => {
    const [a, b, c] = [
      await pilot({ name: 'Ann', factionId: 'luna' }),
      await pilot({ name: 'Bob' }),
      await pilot({ name: 'Cid' }),
    ];
    await lifetime(a, { 'flight.distance': 300 });
    await lifetime(b, { 'flight.distance': 900 });
    await lifetime(c, { 'flight.distance': 100 });

    const board = await rankings.board(a, 'distance', 'lifetime');
    expect(board.entries.map((entry) => [entry.rank, entry.name, entry.value])).toEqual([
      [1, 'Bob', 900],
      [2, 'Ann', 300],
      [3, 'Cid', 100],
    ]);
    expect(board.entries[1]).toMatchObject({ factionId: 'luna', isMe: true });
    expect(board.me).toEqual({ rank: 2, value: 300 });
    expect(board.total).toBe(3);
    expect(board.weekStart).toBeNull();
  });

  it('weekly sums only the days since Monday', async () => {
    const [a, b] = [await pilot({ name: 'Ann' }), await pilot({ name: 'Bob' })];
    await day(a, '2026-10-25', { 'fights.won': 50 }); // last week
    await day(a, '2026-10-26', { 'fights.won': 1 });
    await day(a, '2026-10-28', { 'fights.won': 1 });
    await day(b, '2026-10-27', { 'fights.won': 5 });

    const board = await rankings.board(a, 'fights_won', 'weekly');
    expect(board.entries.map((entry) => [entry.name, entry.value])).toEqual([
      ['Bob', 5],
      ['Ann', 2],
    ]);
    expect(board.weekStart).toBe('2026-10-26T00:00:00.000Z');
  });

  it('an empty week is an empty board, not an error', async () => {
    const a = await pilot();
    await day(a, '2026-10-25', { 'races.won': 4 });
    const board = await rankings.board(a, 'race_wins', 'weekly');
    expect(board).toMatchObject({ entries: [], me: null, total: 0 });
  });

  it('breaks a tie by the earlier-joined pilot, then by name', async () => {
    const late = await pilot({ name: 'Zed', joined: '2026-09-02T00:00:00Z' });
    const early = await pilot({ name: 'Yan', joined: '2026-09-01T00:00:00Z' });
    const same = await pilot({ name: 'Abe', joined: '2026-09-02T00:00:00Z' });
    for (const id of [late, early, same]) await lifetime(id, { 'races.won': 3 });
    const board = await rankings.board(late, 'race_wins', 'lifetime');
    expect(board.entries.map((entry) => entry.name)).toEqual(['Yan', 'Abe', 'Zed']);
    expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('hides banned accounts and zero values', async () => {
    const a = await pilot({ name: 'Ann' });
    const banned = await pilot({ name: 'Ban', banned: true });
    const zero = await pilot({ name: 'Zero' });
    await lifetime(a, { 'flight.distance': 10 });
    await lifetime(banned, { 'flight.distance': 9999 });
    await lifetime(zero, { 'flight.distance': 0 });
    const board = await rankings.board(a, 'distance', 'lifetime');
    expect(board.entries.map((entry) => entry.name)).toEqual(['Ann']);
    expect(board.total).toBe(1);
  });

  it('returns the pilot own position when they are below the top 50', async () => {
    const me = await pilot({ name: 'Last' });
    await lifetime(me, { 'flight.distance': 1 });
    for (let i = 0; i < 55; i += 1) {
      await lifetime(await pilot(), { 'flight.distance': 1000 + i });
    }
    const board = await rankings.board(me, 'distance', 'lifetime');
    expect(board.entries).toHaveLength(50);
    expect(board.entries.some((entry) => entry.isMe)).toBe(false);
    expect(board.me).toEqual({ rank: 56, value: 1 });
    expect(board.total).toBe(56);
  });

  it('the race time board is the best time per pilot on the route, fastest first', async () => {
    const [a, b, c] = [
      await pilot({ name: 'Ann' }),
      await pilot({ name: 'Bob' }),
      await pilot({ name: 'Cid' }),
    ];
    await race(a, 200, '2026-10-20');
    await race(a, 150, '2026-10-21'); // Ann's best, last week
    await race(a, 180, '2026-10-27');
    await race(b, 160, '2026-10-27');
    await race(c, 100, '2026-10-27', 'ceres>vesta'); // another route

    const lifetimeBoard = await rankings.board(a, 'race_time', 'lifetime', 'ceres>hedus');
    expect(lifetimeBoard.entries.map((entry) => [entry.name, entry.value])).toEqual([
      ['Ann', 150],
      ['Bob', 160],
    ]);
    expect(lifetimeBoard.route).toBe('ceres>hedus');

    const weeklyBoard = await rankings.board(a, 'race_time', 'weekly', 'ceres>hedus');
    expect(weeklyBoard.entries.map((entry) => [entry.name, entry.value])).toEqual([
      ['Bob', 160],
      ['Ann', 180],
    ]);
  });

  it('a route nobody raced is an empty board', async () => {
    const a = await pilot();
    const board = await rankings.board(a, 'race_time', 'lifetime', 'nowhere>nothing');
    expect(board).toMatchObject({ entries: [], me: null, total: 0 });
  });

  it('a hostile route value is only ever a bound parameter', async () => {
    const a = await pilot();
    await race(a, 100, '2026-10-27');
    const board = await rankings.board(a, 'race_time', 'lifetime', 'x\'; DROP TABLE "Player"; --');
    expect(board.entries).toEqual([]);
    expect(await prisma.player.count()).toBe(1);
  });

  it('lists the routes that have results, with how many pilots raced them', async () => {
    const [a, b] = [await pilot(), await pilot()];
    await race(a, 100, '2026-10-27');
    await race(a, 90, '2026-10-27');
    await race(b, 95, '2026-10-27');
    await race(b, 50, '2026-10-27', 'ceres>vesta');
    const routes = await rankings.raceRoutes();
    expect(routes.routes).toEqual([
      { routeKey: 'ceres>hedus', originId: 'ceres', destinationId: 'hedus', pilots: 2 },
      { routeKey: 'ceres>vesta', originId: 'ceres', destinationId: 'vesta', pilots: 1 },
    ]);
  });
});
