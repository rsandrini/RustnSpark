import { toJsonInput } from '../common/prisma-json.js';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import { REPAIR_JOB_NAME, REPAIR_QUEUE_NAME } from '../jobs/queues.js';
import { PartsService } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { shipTier } from '../ships/ship-tier.js';
import { locationFactor, repairCost } from './repair-cost.calculator.js';

export const REPAIR_STARTED_EVENT = 'repair.started';
export const REPAIR_COMPLETED_EVENT = 'repair.completed';

const MS_PER_SECOND = 1000;

export interface RepairTargetInput {
  readonly partInstanceId: string;
  readonly toCondition: number;
}

export interface StoredTarget {
  readonly partInstanceId: string;
  readonly fromCondition: number;
  readonly toCondition: number;
}

function parseTargets(raw: unknown): StoredTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate['partInstanceId'] !== 'string' ||
      typeof candidate['fromCondition'] !== 'number' ||
      typeof candidate['toCondition'] !== 'number'
    ) {
      return [];
    }
    return [
      {
        partInstanceId: candidate['partInstanceId'],
        fromCondition: candidate['fromCondition'],
        toCondition: candidate['toCondition'],
      },
    ];
  });
}

function repairSecondsPerPoint(rules: GameRules, zone: number): number {
  const table = rules.economy.repair_seconds_per_point;
  const key = zone <= 1 ? 'hub' : 'outpost';
  return table[key] ?? table['hub'] ?? 0;
}

// Float noise (79.999999 stored, 80 shown) must not turn a fair repair target into an invalid one.
const CONDITION_EPSILON = 0.000001;

@Injectable()
export class RepairService {
  private readonly logger = new Logger(RepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    @InjectQueue(REPAIR_QUEUE_NAME) private readonly repairs: Queue<{ repairJobId: string }>,
  ) {}

  /**
   * Price and duration of a repair without touching the wallet (S10.9): the port shows
   * the exact figure before the player commits, and it comes from the same `plan` that
   * `start` charges, so a quote can never disagree with the debit (barring a price move
   * between the two calls, which start() re-derives and charges at the new value).
   */
  async quote(shipId: string, playerId: string, targets: readonly RepairTargetInput[]) {
    const { cost, durationSeconds, items, fee } = await this.plan(shipId, playerId, targets);
    return { shipId, cost, durationSeconds, items, fee };
  }

  private async plan(shipId: string, playerId: string, targets: readonly RepairTargetInput[]) {
    // Ownership / installed-target validation runs outside the tx so a 404/409 does not
    // hold a Ship row lock. Status, pending-job and payment all re-check inside the tx
    // against a FOR UPDATE lock: two concurrent starts serialize, and the unique partial
    // index (migration 0015) is the hard backstop if a path ever skips the lock.
    const ship = await this.prisma.ship.findUnique({
      where: { id: shipId },
      include: { location: { include: { faction: { select: { relations: true } } } } },
    });
    if (!ship || ship.ownerPlayerId !== playerId) {
      throw new NotFoundException('ship not found');
    }
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    }
    if (ship.status !== 'IN_PORT') {
      throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
    }

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { factionId: true },
    });
    const rules = this.config.snapshot().rules;
    const rows = await this.parts.findPlayerParts(playerId);
    const installed = rows.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === shipId,
    );
    const byId = new Map(installed.map((part) => [part.id, part]));

    const stored: StoredTarget[] = [];
    for (const target of targets) {
      const part = byId.get(target.partInstanceId);
      if (!part) {
        throw new ConflictException({ error: 'PART_NOT_INSTALLED' });
      }
      // A destroyed part is beyond a workshop: it can only be replaced (or discarded).
      if (part.condition <= rules.wear.dead_at_or_below) {
        throw new ConflictException({ error: 'PART_DESTROYED' });
      }
      // A hair of float noise (a stored 79.999999 shown as 80) must not make a fair target invalid.
      if (target.toCondition < part.condition - CONDITION_EPSILON) {
        throw new ConflictException({ error: 'INVALID_REPAIR_TARGET' });
      }
      stored.push({
        partInstanceId: part.id,
        fromCondition: part.condition,
        toCondition: target.toCondition,
      });
    }
    if (stored.length === 0) {
      throw new ConflictException({ error: 'NO_REPAIR_TARGETS' });
    }

    const relations = ship.location.faction.relations;
    let rawRelation: unknown;
    if (typeof relations === 'object' && relations !== null && !Array.isArray(relations)) {
      rawRelation = (relations as Record<string, unknown>)[player?.factionId ?? ''];
    }
    const relationKey =
      typeof rawRelation === 'string' && (rawRelation === 'ally' || rawRelation === 'hostile')
        ? rawRelation
        : 'neutral';

    const costInput = stored.map((target) => {
      const part = byId.get(target.partInstanceId)!;
      return {
        basePrice: part.partCatalog.basePrice,
        fromCondition: target.fromCondition,
        toCondition: target.toCondition,
      };
    });
    const tier = shipTier(
      installed.map((part) => ({ basePrice: part.partCatalog.basePrice })),
      rules,
    );
    const rawCost = repairCost(costInput, tier, ship.location.isolation, relationKey, rules);
    const cost = Math.max(1, Math.round(rawCost));

    const points = stored.reduce(
      (sum, target) => sum + Math.max(0, target.toCondition - target.fromCondition),
      0,
    );
    const secondsPerPoint = repairSecondsPerPoint(rules, ship.location.zone);
    const durationSeconds = points * secondsPerPoint;

    // Per-part breakdown for the repair screen: each part's own share of the price and time, and
    // the workshop fee (the per-action maintenance charge) as whatever is left, so the lines
    // always add up to exactly the total that start() charges.
    const location = locationFactor(ship.location.isolation, relationKey, rules);
    const items = stored.map((target) => {
      const part = byId.get(target.partInstanceId)!;
      const lost = Math.max(0, target.toCondition - target.fromCondition);
      const itemCost = Math.round(
        Math.max(part.partCatalog.basePrice, rules.economy.repair_min_base_price) *
          (lost / 100) *
          rules.economy.repair_factor *
          (rules.economy.repair_price / rules.economy.repair_price_ref) *
          location,
      );
      return {
        partInstanceId: target.partInstanceId,
        cost: itemCost,
        durationSeconds: lost * secondsPerPoint,
      };
    });
    const fee = cost - items.reduce((sum, item) => sum + item.cost, 0);
    return { stored, cost, durationSeconds, items, fee };
  }

  async start(shipId: string, playerId: string, targets: readonly RepairTargetInput[]) {
    const { stored, cost, durationSeconds } = await this.plan(shipId, playerId, targets);
    const completesAt = new Date(Date.now() + durationSeconds * MS_PER_SECOND);

    let job: Awaited<ReturnType<typeof this.prisma.repairJob.create>>;
    try {
      job = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
        const locked = await tx.ship.findUnique({
          where: { id: shipId },
          select: { status: true },
        });
        if (!locked) throw new NotFoundException('ship not found');
        if (locked.status === 'ON_MISSION') {
          throw new ConflictException({ error: 'SHIP_ON_MISSION' });
        }
        if (locked.status !== 'IN_PORT') {
          throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
        }
        const active = await tx.repairJob.findFirst({
          where: { shipId, status: 'PENDING' },
          select: { id: true },
        });
        if (active) {
          throw new ConflictException({ error: 'ALREADY_REPAIRING' });
        }
        // Same spending guard as refuel and the market (GDD §14): while the balance is negative
        // only missions pay it back, so paying for a repair is refused outright.
        const player = await tx.player.findUnique({
          where: { id: playerId },
          select: { credits: true },
        });
        if (player && player.credits < 0) {
          throw new ConflictException({ error: 'BALANCE_NEGATIVE' });
        }
        await this.wallet.debit(playerId, cost, `repair.start:${shipId}`, tx);
        const created = await tx.repairJob.create({
          data: {
            shipId,
            playerId,
            targets: toJsonInput(stored),
            cost,
            durationSeconds,
            completesAt,
          },
        });
        await this.events.record(
          {
            playerId,
            type: REPAIR_STARTED_EVENT,
            payload: {
              repairJobId: created.id,
              shipId,
              cost,
              durationSeconds,
              targets: stored as unknown as Record<string, unknown>[],
            } as unknown as Prisma.InputJsonValue,
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      // Unique partial index (migration 0015): a peer that lost the FOR UPDATE race
      // still cannot insert a second PENDING row for this ship.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'ALREADY_REPAIRING' });
      }
      // The wallet refuses a debit the balance cannot cover: a client error (409), never a 500.
      if (error instanceof InsufficientFundsError) {
        throw new ConflictException({ error: 'INSUFFICIENT_FUNDS' });
      }
      throw error;
    }

    // Enqueue after commit (same pattern as dispatch): a Redis blip must not undo a
    // paid repair — the reconciler re-enqueues lost PENDING jobs by completesAt.
    try {
      await this.repairs.add(
        REPAIR_JOB_NAME,
        { repairJobId: job.id },
        { jobId: job.id, delay: durationSeconds * MS_PER_SECOND },
      );
    } catch (error) {
      this.logger.warn(
        `enqueue of repair ${job.id} failed; reconciler will complete it: ${String(error)}`,
      );
    }

    return {
      repairJobId: job.id,
      shipId,
      cost,
      durationSeconds,
      completesAt,
      targets: stored,
    };
  }

  // Idempotent: only a PENDING → COMPLETED claim applies part conditions; a replayed
  // job (double delivery, reconciler + worker race) sees count 0 and no-ops. Targets
  // use updateMany so a part sold after start (removed row) cannot wedge the job.
  async complete(repairJobId: string): Promise<{ applied: boolean }> {
    const job = await this.prisma.repairJob.findUnique({ where: { id: repairJobId } });
    if (!job) return { applied: false };

    const targets = parseTargets(job.targets);
    const applied = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.repairJob.updateMany({
        where: { id: repairJobId, status: 'PENDING' },
        data: { status: 'COMPLETED' },
      });
      if (claim.count === 0) return false;
      for (const target of targets) {
        await tx.partInstance.updateMany({
          where: { id: target.partInstanceId },
          data: { condition: target.toCondition },
        });
      }
      await this.events.record(
        {
          playerId: job.playerId,
          type: REPAIR_COMPLETED_EVENT,
          payload: {
            repairJobId,
            shipId: job.shipId,
            targets: targets as unknown as Record<string, unknown>[],
          } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      return true;
    });
    return { applied };
  }
}
