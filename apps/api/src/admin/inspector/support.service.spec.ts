import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import type { Player } from '@prisma/client';
import { GameConfigService } from '../../config/game-config.service.js';
import { OnboardingService } from '../../players/onboarding.service.js';
import { InsufficientFundsError, WalletService } from '../../players/wallet.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AccountStatusCache } from '../../common/guards/account-status.cache.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { SupportService, type SupportContext } from './support.service.js';

const context: SupportContext = { actor: 'admin-1', ip: '10.0.0.1', reason: 'stuck after crash' };

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    accountId: 'account-1',
    name: 'pilot',
    credits: 100,
    locale: 'en',
    factionId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Player;
}

function makeFixture() {
  const playerFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const playerFindUniqueOrThrow = jest.fn<(args: unknown) => Promise<unknown>>();
  const accountFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const accountUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
  const refreshDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const shipFindFirst = jest.fn<(args: unknown) => Promise<unknown>>();
  const shipUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
  const shipUpdateMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const missionUpdateMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const missionFindMany = jest.fn<(args: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
  const executeRaw = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(0);
  const missionCount = jest.fn<(args: unknown) => Promise<number>>();
  const partDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const partCount = jest.fn<(args: unknown) => Promise<number>>();
  const materialDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const materialCount = jest.fn<(args: unknown) => Promise<number>>();
  const repairDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const scavengeDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const idempotencyDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>();
  const record = jest.fn<(entry: unknown, tx?: unknown) => Promise<unknown>>();
  const walletCredit = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const walletDebit = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const walletDebitAllowing = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const applyStarterKit = jest.fn<(...args: unknown[]) => Promise<unknown>>();

  const tx = {
    player: { findUnique: playerFindUnique, findUniqueOrThrow: playerFindUniqueOrThrow },
    account: { findUnique: accountFindUnique, update: accountUpdate },
    refreshToken: { deleteMany: refreshDeleteMany },
    ship: { findFirst: shipFindFirst, update: shipUpdate, updateMany: shipUpdateMany },
    missionInstance: {
      updateMany: missionUpdateMany,
      count: missionCount,
      findMany: missionFindMany,
    },
    $executeRaw: executeRaw,
    partInstance: { deleteMany: partDeleteMany, count: partCount },
    playerMaterial: { deleteMany: materialDeleteMany, count: materialCount },
    repairJob: { deleteMany: repairDeleteMany },
    scavengeCounter: { deleteMany: scavengeDeleteMany },
    idempotencyKey: { deleteMany: idempotencyDeleteMany },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const audit = { record } as unknown as AdminAuditService;
  const wallet = {
    credit: walletCredit,
    debit: walletDebit,
    debitAllowingNegative: walletDebitAllowing,
  } as unknown as WalletService;
  const config = {
    snapshot: () => ({
      rules: {
        economy: { start_credits: 1_000 },
        onboarding: { home_locations: { luna: 'ceres' } },
      },
    }),
  } as unknown as GameConfigService;
  const onboarding = { applyStarterKit } as unknown as OnboardingService;

  return {
    service: new SupportService(prisma, audit, wallet, config, onboarding, {
      forget: jest.fn(),
    } as unknown as AccountStatusCache),
    playerFindUnique,
    playerFindUniqueOrThrow,
    accountFindUnique,
    accountUpdate,
    refreshDeleteMany,
    shipFindFirst,
    shipUpdate,
    shipUpdateMany,
    missionUpdateMany,
    missionCount,
    partDeleteMany,
    partCount,
    materialDeleteMany,
    materialCount,
    repairDeleteMany,
    scavengeDeleteMany,
    idempotencyDeleteMany,
    record,
    walletCredit,
    walletDebit,
    walletDebitAllowing,
    applyStarterKit,
    tx,
  };
}

describe('SupportService (S11.4)', () => {
  it('grants credits through the wallet and audits before/after with the reason', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: 100 }));
    f.playerFindUniqueOrThrow.mockResolvedValueOnce({ credits: 350 });

    const result = await f.service.grantCredits('player-1', 250, context);

    expect(f.walletCredit).toHaveBeenCalledWith(
      'player-1',
      250,
      'support.grant',
      expect.anything(),
    );
    expect(result).toEqual({
      action: 'SUPPORT_GRANT_CREDITS',
      target: 'player-1',
      before: { credits: 100 },
      after: { credits: 350 },
    });
    expect(f.record).toHaveBeenCalledTimes(1);
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'admin-1',
        action: 'SUPPORT_GRANT_CREDITS',
        target: 'player-1',
        before: { credits: 100 },
        after: { credits: 350, reason: 'stuck after crash' },
        ip: '10.0.0.1',
      }),
      expect.anything(),
    );
  });

  it('maps a wallet failure to 409 with its machine code and records no audit row', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: 10 }));
    f.walletDebit.mockRejectedValueOnce(new InsufficientFundsError('player-1', 500));

    const error = await f.service
      .removeCredits('player-1', 500, context)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({ error: 'INSUFFICIENT_FUNDS' });
    expect(f.record).not.toHaveBeenCalled();
  });

  it('removes credits through the plain debit path', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: 400 }));
    f.playerFindUniqueOrThrow.mockResolvedValueOnce({ credits: 300 });

    await f.service.removeCredits('player-1', 100, context);

    expect(f.walletDebit).toHaveBeenCalledWith(
      'player-1',
      100,
      'support.remove',
      expect.anything(),
    );
    expect(f.walletCredit).not.toHaveBeenCalled();
  });

  it('clears a negative balance by crediting the exact debt back', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: -80 }));
    f.playerFindUniqueOrThrow.mockResolvedValueOnce({ credits: 0 });

    const result = await f.service.clearNegativeBalance('player-1', context);

    expect(f.walletCredit).toHaveBeenCalledWith(
      'player-1',
      80,
      'support.clear_negative',
      expect.anything(),
    );
    expect(result.before).toEqual({ credits: -80 });
    expect(result.after).toEqual({ credits: 0 });
  });

  it('leaves a non-negative balance untouched when clearing', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: 250 }));
    f.playerFindUniqueOrThrow.mockResolvedValueOnce({ credits: 250 });

    await f.service.clearNegativeBalance('player-1', context);

    expect(f.walletCredit).not.toHaveBeenCalled();
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPPORT_CLEAR_NEGATIVE_BALANCE' }),
      expect.anything(),
    );
  });

  it('refuses to ban an admin account', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer());
    f.accountFindUnique.mockResolvedValueOnce({ id: 'account-1', status: 'ACTIVE', role: 'ADMIN' });

    await expect(f.service.ban('player-1', context)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.accountUpdate).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });

  it('bans a player account and revokes its refresh tokens in the same transaction', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer());
    f.accountFindUnique.mockResolvedValueOnce({
      id: 'account-1',
      status: 'ACTIVE',
      role: 'PLAYER',
    });

    const result = await f.service.ban('player-1', context);

    expect(f.accountUpdate).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { status: 'BANNED' },
    });
    expect(f.refreshDeleteMany).toHaveBeenCalledWith({ where: { accountId: 'account-1' } });
    expect(result).toEqual({
      action: 'SUPPORT_BAN',
      target: 'player-1',
      before: { status: 'ACTIVE' },
      after: { status: 'BANNED' },
    });
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUPPORT_BAN',
        after: { status: 'BANNED', reason: 'stuck after crash' },
      }),
      expect.anything(),
    );
  });

  it('unsticks only ships that belong to the player', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer());
    f.shipFindFirst.mockResolvedValueOnce(null);

    await expect(f.service.unstickShip('player-1', 'ship-x', context)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.shipUpdate).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });

  it('expires missions on the hull, parks the ship in port and audits the ship as target', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer());
    f.shipFindFirst.mockResolvedValueOnce({
      id: 'ship-9',
      status: 'ON_MISSION',
      stance: 'AGGRESSIVE',
    });
    f.missionUpdateMany.mockResolvedValueOnce({ count: 1 });
    f.shipUpdate.mockResolvedValueOnce({});

    const result = await f.service.unstickShip('player-1', 'ship-9', context);

    expect(f.missionUpdateMany).toHaveBeenCalledWith({
      where: { shipId: 'ship-9', status: { in: ['ACCEPTED', 'IN_TRANSIT', 'RESOLVING'] } },
      data: { status: 'EXPIRED', shipId: null },
    });
    expect(f.shipUpdate).toHaveBeenCalledWith({
      where: { id: 'ship-9' },
      data: { status: 'IN_PORT', stance: 'NEUTRAL' },
    });
    expect(result.target).toBe('ship-9');
    expect(result.after).toEqual({ status: 'IN_PORT', expiredMissions: 1 });
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPPORT_UNSTICK_SHIP', target: 'ship-9' }),
      expect.anything(),
    );
  });

  it('resets a fully onboarded pilot: wipe state, wallet to start credits, re-kit the hull', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: 500, factionId: 'ferrum' }));
    f.partCount.mockResolvedValueOnce(4);
    f.materialCount.mockResolvedValueOnce(2);
    f.missionUpdateMany.mockResolvedValueOnce({ count: 1 });
    f.shipUpdateMany.mockResolvedValueOnce({ count: 2 });
    f.missionCount.mockResolvedValueOnce(1);
    f.playerFindUniqueOrThrow.mockResolvedValueOnce({ credits: 500 });
    f.shipFindFirst.mockResolvedValueOnce({ id: 'ship-1' });
    f.partCount.mockResolvedValueOnce(4);
    f.materialCount.mockResolvedValueOnce(2);

    const result = await f.service.reset('player-1', context);

    expect(f.refreshDeleteMany).toHaveBeenCalledWith({ where: { accountId: 'account-1' } });
    expect(f.partDeleteMany).toHaveBeenCalledWith({ where: { ownerPlayerId: 'player-1' } });
    expect(f.materialDeleteMany).toHaveBeenCalledWith({ where: { playerId: 'player-1' } });
    expect(f.repairDeleteMany).toHaveBeenCalledWith({ where: { playerId: 'player-1' } });
    expect(f.scavengeDeleteMany).toHaveBeenCalledWith({ where: { playerId: 'player-1' } });
    expect(f.idempotencyDeleteMany).toHaveBeenCalledWith({ where: { playerId: 'player-1' } });
    expect(f.missionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED', shipId: null, playerId: null } }),
    );
    expect(f.shipUpdateMany).toHaveBeenCalledWith({
      where: { ownerPlayerId: 'player-1' },
      data: { status: 'IN_PORT', stance: 'NEUTRAL' },
    });
    expect(f.walletCredit).toHaveBeenCalledWith(
      'player-1',
      500,
      'support.reset',
      expect.anything(),
    );
    expect(f.applyStarterKit).toHaveBeenCalledWith(f.tx, 'player-1', 'ship-1', expect.anything());
    expect(result.after).toEqual({
      credits: 1_000,
      factionId: 'ferrum',
      parts: 4,
      materials: 2,
      activeMissions: 0,
    });
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUPPORT_RESET' }),
      expect.anything(),
    );
  });

  it('skips wallet and starter kit for a pilot that never onboarded', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(makePlayer({ credits: 75, factionId: null }));
    f.partCount.mockResolvedValueOnce(0);
    f.materialCount.mockResolvedValueOnce(0);
    f.missionCount.mockResolvedValueOnce(0);
    f.missionUpdateMany.mockResolvedValueOnce({ count: 0 });
    f.partCount.mockResolvedValueOnce(0);
    f.materialCount.mockResolvedValueOnce(0);
    f.shipUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await f.service.reset('player-1', context);

    expect(f.walletCredit).not.toHaveBeenCalled();
    expect(f.walletDebitAllowing).not.toHaveBeenCalled();
    expect(f.applyStarterKit).not.toHaveBeenCalled();
    expect(result.before.credits).toBe(75);
    expect(result.after.credits).toBe(75);
    expect(result.after.factionId).toBeNull();
  });

  it('404s an unknown player without writing an audit row', async () => {
    const f = makeFixture();
    f.playerFindUnique.mockResolvedValueOnce(null);

    await expect(f.service.ban('ghost', context)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.record).not.toHaveBeenCalled();
  });
});
