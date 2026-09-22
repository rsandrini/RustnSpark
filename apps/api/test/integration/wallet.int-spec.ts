import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { Player } from '@prisma/client';
import {
  CreditOverflowError,
  InsufficientFundsError,
  MAX_CREDITS,
  WALLET_CREDIT_EVENT,
  WALLET_DEBIT_EVENT,
  WalletPlayerNotFoundError,
  WalletService,
} from '../../src/players/wallet.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { resetDatabase } from '../support/test-db.js';

// WalletService against real Postgres (no mocks, per plan): the conditional-UPDATE race
// semantics below only exist on a real database with row locking.

describe('WalletService (real Postgres)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let wallet: WalletService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    wallet = testApp.app.get(WalletService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  async function seedPlayer(credits: number): Promise<Player> {
    const created = await prisma.account.create({
      data: {
        email: `wallet-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-hash',
        player: { create: { name: `w-${randomUUID().replaceAll('-', '').slice(0, 22)}`, credits } },
      },
      include: { player: true },
    });
    if (!created.player) throw new Error('seedPlayer: nested player create returned no player');
    return created.player;
  }

  async function balanceOf(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
    return player.credits;
  }

  it('serializes 20 parallel debits of 10 against a balance of 100: exactly 10 succeed', async () => {
    const player = await seedPlayer(100);

    // Shared gate: all 20 debits park on one promise and start in the same microtask flush, so
    // real transaction overlap never depends on how the individual calls happen to be staggered.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const attempts = Array.from({ length: 20 }, async () => {
      await gate;
      return wallet.debit(player.id, 10, 'race-test');
    });
    releaseGate();
    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(InsufficientFundsError);
      expect((result.reason as InsufficientFundsError).code).toBe('INSUFFICIENT_FUNDS');
    }

    expect(await balanceOf(player.id)).toBe(0);

    const events = await prisma.playerEvent.findMany({ where: { playerId: player.id } });
    expect(events).toHaveLength(10);
    for (const event of events) {
      expect(event.type).toBe(WALLET_DEBIT_EVENT);
      expect(event.creditsDelta).toBe(-10);
      expect(event.payload).toEqual({ reason: 'race-test' });
    }
  });

  it('credits the balance and writes the event in the same transaction', async () => {
    const player = await seedPlayer(100);

    await wallet.credit(player.id, 50, 'mission-reward');

    expect(await balanceOf(player.id)).toBe(150);
    const events = await prisma.playerEvent.findMany({ where: { playerId: player.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: WALLET_CREDIT_EVENT,
      creditsDelta: 50,
      payload: { reason: 'mission-reward' },
    });
  });

  it('rejects a credit that would overflow the Int range, leaving balance and events untouched', async () => {
    const player = await seedPlayer(MAX_CREDITS - 10);

    await expect(wallet.credit(player.id, 11, 'overflow')).rejects.toBeInstanceOf(
      CreditOverflowError,
    );

    expect(await balanceOf(player.id)).toBe(MAX_CREDITS - 10);
    expect(await prisma.playerEvent.count({ where: { playerId: player.id } })).toBe(0);
  });

  it('accepts a credit that lands exactly on the Int ceiling', async () => {
    const player = await seedPlayer(MAX_CREDITS - 10);

    await wallet.credit(player.id, 10, 'to-the-ceiling');

    expect(await balanceOf(player.id)).toBe(MAX_CREDITS);
  });

  it('throws WalletPlayerNotFoundError when crediting a missing player', async () => {
    await expect(wallet.credit(randomUUID(), 10, 'no-player')).rejects.toBeInstanceOf(
      WalletPlayerNotFoundError,
    );
  });

  it('rejects a debit larger than the balance with no balance change and no event', async () => {
    const player = await seedPlayer(40);

    await expect(wallet.debit(player.id, 41, 'too-expensive')).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );

    expect(await balanceOf(player.id)).toBe(40);
    expect(await prisma.playerEvent.count({ where: { playerId: player.id } })).toBe(0);
  });

  it('joins the caller transaction: a later failure rolls back the debit and its event', async () => {
    const player = await seedPlayer(100);

    await expect(
      prisma.$transaction(async (tx) => {
        await wallet.debit(player.id, 30, 'rolled-back', tx);
        throw new Error('caller aborted');
      }),
    ).rejects.toThrow('caller aborted');

    expect(await balanceOf(player.id)).toBe(100);
    expect(await prisma.playerEvent.count({ where: { playerId: player.id } })).toBe(0);
  });

  it('joins the caller transaction: debit and credit commit atomically', async () => {
    const player = await seedPlayer(100);

    await prisma.$transaction(async (tx) => {
      await wallet.debit(player.id, 30, 'buy-part', tx);
      await wallet.credit(player.id, 10, 'sell-loot', tx);
    });

    expect(await balanceOf(player.id)).toBe(80);
    // Postgres now() is the transaction start time, so both events share one `at` value and no
    // deterministic row order exists; assert the committed deltas as a multiset instead.
    const events = await prisma.playerEvent.findMany({ where: { playerId: player.id } });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.creditsDelta).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      -30, 10,
    ]);
  });
});
