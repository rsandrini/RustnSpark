import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Player, Prisma } from '@prisma/client';
import { GameConfigService } from '../../config/game-config.service.js';
import { OnboardingService } from '../../players/onboarding.service.js';
import { WalletError, WalletService } from '../../players/wallet.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccountStatusCache } from '../../common/guards/account-status.cache.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';

// Support actions (GDD §17 screen D): grant/remove credits, unstick ship, clear negative
// balance, ban, reset. Every one runs in one transaction with its S11.1 audit row —
// rolled-back mutation ⇒ no audit row, committed mutation ⇒ never a missing one — and
// every one requires the caller's reason, stored inside `after` (AdminAuditLog has no
// dedicated reason column; TuningRevision's reason lives in the revision, not here).
//
// Wallet events use stable reasons (`support.grant`, …) so the economy dashboard buckets
// them apart from player traffic; the human reason stays in the audit row.

export interface SupportContext {
  /** Admin accountId (same actor vocabulary as TuningRevision / S11.1). */
  readonly actor: string;
  readonly ip?: string | null;
  readonly reason: string;
}

export interface SupportActionResult {
  readonly action: string;
  readonly target: string;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

const ACTIVE_MISSION_STATUSES = ['ACCEPTED', 'IN_TRANSIT', 'RESOLVING'] as const;

const SUPPORT_WALLET_REASONS = {
  grant: 'support.grant',
  remove: 'support.remove',
  clearNegative: 'support.clear_negative',
  reset: 'support.reset',
} as const;

// Wallet guards are domain outcomes, not crashes: insufficient funds and credit overflow
// surface as 409s with their existing machine codes (both translated in en/pt-BR).
function walletHttpException(error: WalletError): ConflictException {
  const code = (error as { code?: unknown }).code;
  return new ConflictException({
    error: typeof code === 'string' ? code : 'VALIDATION_ERROR',
  });
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly wallet: WalletService,
    private readonly config: GameConfigService,
    private readonly onboarding: OnboardingService,
    private readonly accounts: AccountStatusCache,
  ) {}

  async grantCredits(
    playerId: string,
    amount: number,
    context: SupportContext,
  ): Promise<SupportActionResult> {
    return this.run(playerId, context, 'SUPPORT_GRANT_CREDITS', async (tx, player) => {
      const before = { credits: player.credits };
      await this.wallet.credit(playerId, amount, SUPPORT_WALLET_REASONS.grant, tx);
      return { before, after: { credits: await this.creditsOf(tx, playerId) } };
    });
  }

  async removeCredits(
    playerId: string,
    amount: number,
    context: SupportContext,
  ): Promise<SupportActionResult> {
    return this.run(playerId, context, 'SUPPORT_REMOVE_CREDITS', async (tx, player) => {
      const before = { credits: player.credits };
      // Plain debit: support cannot push a player negative either (GDD §14 — only the
      // mission engine's debitAllowingNegative does that, plus the dedicated
      // clear-balance action for the debt itself).
      await this.wallet.debit(playerId, amount, SUPPORT_WALLET_REASONS.remove, tx);
      return { before, after: { credits: await this.creditsOf(tx, playerId) } };
    });
  }

  async clearNegativeBalance(
    playerId: string,
    context: SupportContext,
  ): Promise<SupportActionResult> {
    return this.run(playerId, context, 'SUPPORT_CLEAR_NEGATIVE_BALANCE', async (tx, player) => {
      const before = { credits: player.credits };
      if (player.credits < 0) {
        await this.wallet.credit(
          playerId,
          -player.credits,
          SUPPORT_WALLET_REASONS.clearNegative,
          tx,
        );
      }
      return { before, after: { credits: await this.creditsOf(tx, playerId) } };
    });
  }

  async ban(playerId: string, context: SupportContext): Promise<SupportActionResult> {
    let bannedAccountId: string | undefined;
    const result = await this.run(playerId, context, 'SUPPORT_BAN', async (tx, player) => {
      const account = await tx.account.findUnique({ where: { id: player.accountId } });
      if (account === null) throw new NotFoundException('account not found');
      if (account.role === 'ADMIN') {
        throw new BadRequestException('cannot ban an admin account');
      }
      const before = { status: account.status };
      await tx.account.update({ where: { id: account.id }, data: { status: 'BANNED' } });
      // Ban ends the session too: refresh tokens are deleted (both login and refresh
      // already refuse non-ACTIVE accounts, this just stops the current one sliding).
      await tx.refreshToken.deleteMany({ where: { accountId: account.id } });
      bannedAccountId = account.id;
      return { before, after: { status: 'BANNED' } };
    });
    // After the commit, so a request racing the transaction cannot re-cache the old status.
    if (bannedAccountId !== undefined) this.accounts.forget(bannedAccountId);
    return result;
  }

  async unstickShip(
    playerId: string,
    shipId: string,
    context: SupportContext,
  ): Promise<SupportActionResult> {
    return this.run(playerId, context, 'SUPPORT_UNSTICK_SHIP', async (tx, player) => {
      const ship = await tx.ship.findFirst({
        where: { id: shipId, ownerPlayerId: player.id },
      });
      if (ship === null) throw new NotFoundException('ship not found for this player');
      const before = { status: ship.status };
      // The mission attached to this ship is what pins it ON_MISSION (or the ship got
      // stuck ADRIFT): expire active missions on this hull — freeing the
      // one-active-mission slot — and park the ship in port. Presences and logs stay:
      // history is never rewritten by support, but presences still ahead are dropped: a ghost
      // ship must not keep meeting other players on a route it no longer sails.
      const pinned = await tx.missionInstance.findMany({
        where: { shipId: ship.id, status: { in: [...ACTIVE_MISSION_STATUSES] } },
        select: { id: true },
      });
      await this.dropFuturePresences(
        tx,
        pinned.map((mission) => mission.id),
      );
      const detached = await tx.missionInstance.updateMany({
        where: { shipId: ship.id, status: { in: [...ACTIVE_MISSION_STATUSES] } },
        data: { status: 'EXPIRED', shipId: null },
      });
      await tx.ship.update({
        where: { id: ship.id },
        data: { status: 'IN_PORT', stance: 'NEUTRAL' },
      });
      return {
        target: ship.id,
        before,
        after: { status: 'IN_PORT', expiredMissions: detached.count },
      };
    });
  }

  async reset(playerId: string, context: SupportContext): Promise<SupportActionResult> {
    return this.run(playerId, context, 'SUPPORT_RESET', async (tx, player) => {
      const rules = this.config.snapshot().rules;
      const before = {
        credits: player.credits,
        factionId: player.factionId,
        parts: await tx.partInstance.count({ where: { ownerPlayerId: playerId } }),
        materials: await tx.playerMaterial.count({ where: { playerId } }),
        activeMissions: await tx.missionInstance.count({
          where: { playerId, status: { in: [...ACTIVE_MISSION_STATUSES] } },
        }),
      };

      // Fresh sessions and fresh run: history (PlayerEvent, MissionLog, AdminAuditLog)
      // is deliberately kept — only the live state is wiped.
      await tx.refreshToken.deleteMany({ where: { accountId: player.accountId } });
      await tx.partInstance.deleteMany({ where: { ownerPlayerId: playerId } });
      await tx.playerMaterial.deleteMany({ where: { playerId } });
      await tx.repairJob.deleteMany({ where: { playerId } });
      await tx.scavengeCounter.deleteMany({ where: { playerId } });
      await tx.idempotencyKey.deleteMany({ where: { playerId } });
      const active = await tx.missionInstance.findMany({
        where: { playerId, status: { in: [...ACTIVE_MISSION_STATUSES] } },
        select: { id: true },
      });
      await this.dropFuturePresences(
        tx,
        active.map((mission) => mission.id),
      );
      await tx.missionInstance.updateMany({
        where: { playerId, status: { in: [...ACTIVE_MISSION_STATUSES] } },
        data: { status: 'EXPIRED', shipId: null, playerId: null },
      });
      // A mission merely HELD (reserved, not accepted) goes back on the board.
      await tx.missionInstance.updateMany({
        where: { playerId, status: 'HELD' },
        data: { status: 'AVAILABLE', playerId: null },
      });
      // Back to the faction's home port, exactly where onboarding put the first hull.
      const homeLocations = rules.onboarding.home_locations as Record<string, string>;
      const home =
        player.factionId !== null && Object.hasOwn(homeLocations, player.factionId)
          ? homeLocations[player.factionId]
          : undefined;
      await tx.ship.updateMany({
        where: { ownerPlayerId: playerId },
        data: {
          status: 'IN_PORT',
          stance: 'NEUTRAL',
          ...(home !== undefined ? { currentLocationId: home } : {}),
        },
      });

      // Wallet back to the onboarding grant — through the wallet so the economy
      // dashboard sees the movement. Only for onboarded pilots: a pilot without a
      // faction never received the grant (onboarding still owns that first credit).
      let credits = player.credits;
      if (player.factionId !== null) {
        const start = rules.economy.start_credits;
        const delta = start - player.credits;
        if (delta > 0) {
          await this.wallet.credit(playerId, delta, SUPPORT_WALLET_REASONS.reset, tx);
        } else if (delta < 0) {
          await this.wallet.debitAllowingNegative(
            playerId,
            -delta,
            SUPPORT_WALLET_REASONS.reset,
            tx,
          );
        }
        credits = start;

        // Re-kit the first hull through the exact onboarding starter path, so the pilot
        // can play immediately (starter parts, auto-layout, viability, full tank).
        const ship = await tx.ship.findFirst({
          where: { ownerPlayerId: playerId },
          orderBy: { id: 'asc' },
        });
        if (ship !== null) {
          await this.onboarding.applyStarterKit(tx, playerId, ship.id, rules);
        }
      }

      const after = {
        credits,
        factionId: player.factionId,
        parts: await tx.partInstance.count({ where: { ownerPlayerId: playerId } }),
        materials: await tx.playerMaterial.count({ where: { playerId } }),
        activeMissions: 0,
      };
      return { before, after };
    });
  }

  private async run(
    playerId: string,
    context: SupportContext,
    action: string,
    mutate: (
      tx: Prisma.TransactionClient,
      player: Player,
    ) => Promise<{
      target?: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>,
  ): Promise<SupportActionResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.findUnique({ where: { id: playerId } });
        if (player === null) throw new NotFoundException('player not found');
        const outcome = await mutate(tx, player);
        const target = outcome.target ?? playerId;
        await this.audit.record(
          {
            actor: context.actor,
            action,
            target,
            before: outcome.before,
            after: { ...outcome.after, reason: context.reason },
            ip: context.ip ?? null,
          },
          tx,
        );
        return { action, target, before: outcome.before, after: outcome.after };
      });
    } catch (error) {
      if (error instanceof WalletError) throw walletHttpException(error);
      throw error;
    }
  }

  // Deletes the route presences of these missions that have not ended yet.
  private async dropFuturePresences(
    tx: Prisma.TransactionClient,
    missionIds: readonly string[],
  ): Promise<void> {
    if (missionIds.length === 0) return;
    await tx.$executeRaw`
      DELETE FROM "RoutePresence"
      WHERE "missionId" = ANY(${missionIds as string[]}) AND upper("window") > now()
    `;
  }

  private async creditsOf(tx: Prisma.TransactionClient, playerId: string): Promise<number> {
    const row = await tx.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return row.credits;
  }
}
