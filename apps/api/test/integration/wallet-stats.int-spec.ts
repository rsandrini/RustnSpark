import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Clock } from '../../src/common/clock/clock.js';
import { PlayerEventService } from '../../src/players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../../src/players/wallet.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { PlayerStatsService } from '../../src/stats/player-stats.service.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const prisma = getTestPrismaClient();
const service = prisma as unknown as PrismaService;
const stats = new PlayerStatsService(service, new Clock());
const wallet = new WalletService(service, new PlayerEventService(service), stats);

async function newPlayer(credits: number): Promise<string> {
  const account = await prisma.account.create({
    data: {
      email: `wallet-${randomUUID()}@example.com`,
      passwordHash: 'x',
      player: {
        create: { name: `p-${randomUUID().replaceAll('-', '').slice(0, 20)}`, credits },
      },
    },
    include: { player: true },
  });
  return account.player!.id;
}

describe('wallet stats', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(closeTestPrismaClient);

  it('counts a credit by its reason and raises the wallet record', async () => {
    const playerId = await newPlayer(100);
    await wallet.credit(playerId, 40, 'market.sell:part-1');
    const read = await stats.read(playerId);
    expect(read.totals).toEqual({ 'money.earned_parts': 40 });
    expect(read.records['best.wallet']?.value).toBe(140);
    await wallet.credit(playerId, 10, 'mission:m1:payout');
    expect((await stats.read(playerId)).totals).toEqual({
      'money.earned_parts': 40,
      'money.earned_missions': 10,
    });
  });

  it('counts debits by reason, with or without the solvency check', async () => {
    const playerId = await newPlayer(100);
    await wallet.debit(playerId, 30, 'refuel:ship-1');
    await wallet.debitAllowingNegative(playerId, 500, 'rescue:ship-1');
    expect((await stats.read(playerId)).totals).toEqual({
      'money.spent_refuel': 30,
      'money.spent_rescue': 500,
    });
  });

  it('counts nothing for a debit that is refused', async () => {
    const playerId = await newPlayer(10);
    await expect(wallet.debit(playerId, 30, 'market.buy:l1')).rejects.toThrow(
      InsufficientFundsError,
    );
    expect(await prisma.playerStats.count()).toBe(0);
  });

  it('counts nothing when the surrounding transaction rolls back', async () => {
    const playerId = await newPlayer(100);
    await expect(
      prisma.$transaction(async (tx) => {
        await wallet.debit(playerId, 30, 'repair.start:ship-1', tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.playerStats.count()).toBe(0);
  });
});
