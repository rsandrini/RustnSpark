import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from './player-event.service.js';

export const WALLET_DEBIT_EVENT = 'wallet.debit';
export const WALLET_CREDIT_EVENT = 'wallet.credit';

// Player.credits is a Postgres int4 column.
export const MAX_CREDITS = 2_147_483_647;
export const MIN_CREDITS = -2_147_483_648;

// Base for every wallet failure, so game-logic callers can catch the family when they only care
// that the movement failed, and match on the subtype/code when they need to distinguish.
export abstract class WalletError extends Error {}

export class InvalidWalletOperationError extends WalletError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWalletOperationError';
  }
}

export class InsufficientFundsError extends WalletError {
  readonly code = 'INSUFFICIENT_FUNDS' as const;

  constructor(playerId: string, amount: number) {
    super(`player ${playerId} cannot cover a debit of ${amount} credits`);
    this.name = 'InsufficientFundsError';
  }
}

// A credit against a missing player is a caller bug and must not silently no-op. Debit folds the
// same case into InsufficientFundsError: its conditional UPDATE cannot distinguish it, and the
// client only ever needs to learn "the debit did not happen".
export class WalletPlayerNotFoundError extends WalletError {
  constructor(playerId: string) {
    super(`player ${playerId} not found`);
    this.name = 'WalletPlayerNotFoundError';
  }
}

// Guarded explicitly so an overflowing credit surfaces as a domain error instead of a raw
// Postgres integer-out-of-range failure.
export class CreditOverflowError extends WalletError {
  readonly code = 'CREDIT_OVERFLOW' as const;

  constructor(playerId: string, amount: number) {
    super(`crediting ${amount} credits to player ${playerId} would overflow the balance`);
    this.name = 'CreditOverflowError';
  }
}

// Amounts are integer credits (never floats, so balances stay exactly summable) and every
// movement needs an auditable, non-empty reason that lands on the PlayerEvent row.
export function assertValidWalletOperation(amount: number, reason: string): void {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    throw new InvalidWalletOperationError('amount must be a positive integer number of credits');
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new InvalidWalletOperationError('reason must be a non-empty string');
  }
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PlayerEventService,
  ) {}

  // Single conditional UPDATE (S2.5 ruling): the row lock plus the `credits >= amount` predicate
  // make concurrent debits serialize inside Postgres, so exactly floor(balance/amount) of them
  // succeed — no SELECT-then-UPDATE race. The PlayerEvent row is written in the SAME transaction,
  // so a failed event write also rolls back the balance change.
  async debit(
    playerId: string,
    amount: number,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    assertValidWalletOperation(amount, reason);
    if (tx) return this.debitInTransaction(tx, playerId, amount, reason);
    await this.prisma.$transaction((inner) =>
      this.debitInTransaction(inner, playerId, amount, reason),
    );
  }

  async credit(
    playerId: string,
    amount: number,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    assertValidWalletOperation(amount, reason);
    if (tx) return this.creditInTransaction(tx, playerId, amount, reason);
    await this.prisma.$transaction((inner) =>
      this.creditInTransaction(inner, playerId, amount, reason),
    );
  }

  // Mission combat-loss penalties (GDD §14) must land even when the balance cannot cover
  // them: the sim subtracts unconditionally and only later gates *spending* on a negative
  // balance. No `credits >= amount` predicate here — same single-UPDATE shape as debit(),
  // minus the solvency check.
  async debitAllowingNegative(
    playerId: string,
    amount: number,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    assertValidWalletOperation(amount, reason);
    if (tx) return this.debitAllowingNegativeInTransaction(tx, playerId, amount, reason);
    await this.prisma.$transaction((inner) =>
      this.debitAllowingNegativeInTransaction(inner, playerId, amount, reason),
    );
  }

  private async debitInTransaction(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE "Player" SET credits = credits - ${amount}
      WHERE id = ${playerId} AND credits >= ${amount}
    `;
    if (updated === 0) throw new InsufficientFundsError(playerId, amount);
    await this.events.record(
      { playerId, type: WALLET_DEBIT_EVENT, creditsDelta: -amount, payload: { reason } },
      tx,
    );
  }

  private async creditInTransaction(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    // The int4 ceiling check lives in the UPDATE predicate so concurrent credits cannot race
    // past it; the follow-up exists-check only picks which error a 0-row update means.
    const updated = await tx.$executeRaw`
      UPDATE "Player" SET credits = credits + ${amount}
      WHERE id = ${playerId} AND credits <= ${MAX_CREDITS - amount}
    `;
    if (updated === 0) {
      const player = await tx.player.findUnique({ where: { id: playerId }, select: { id: true } });
      if (player) throw new CreditOverflowError(playerId, amount);
      throw new WalletPlayerNotFoundError(playerId);
    }
    await this.events.record(
      { playerId, type: WALLET_CREDIT_EVENT, creditsDelta: amount, payload: { reason } },
      tx,
    );
  }

  private async debitAllowingNegativeInTransaction(
    tx: Prisma.TransactionClient,
    playerId: string,
    amount: number,
    reason: string,
  ): Promise<void> {
    // Floor is the int4 minimum so a penalty never wraps past Postgres range; a 0-row
    // update therefore only means "player missing".
    const updated = await tx.$executeRaw`
      UPDATE "Player" SET credits = credits - ${amount}
      WHERE id = ${playerId} AND credits >= ${MIN_CREDITS + amount}
    `;
    if (updated === 0) throw new WalletPlayerNotFoundError(playerId);
    await this.events.record(
      { playerId, type: WALLET_DEBIT_EVENT, creditsDelta: -amount, payload: { reason } },
      tx,
    );
  }
}
