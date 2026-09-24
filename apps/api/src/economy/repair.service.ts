import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import { REPAIR_JOB_NAME, REPAIR_QUEUE_NAME } from '../jobs/queues.js';
import { PartsService } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { shipTier } from '../ships/ship-tier.js';
import { repairCost } from './repair-cost.calculator.js';

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

@Injectable()
export class RepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    @InjectQueue(REPAIR_QUEUE_NAME) private readonly repairs: Queue<{ repairJobId: string }>,
  ) {}

  async start(shipId: string, playerId: string, targets: readonly RepairTargetInput[]) {
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

    const active = await this.prisma.repairJob.findFirst({
      where: { shipId, status: 'PENDING' },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException({ error: 'ALREADY_REPAIRING' });
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
      if (target.toCondition < part.condition) {
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
    const completesAt = new Date(Date.now() + durationSeconds * MS_PER_SECOND);

    const job = await this.prisma.$transaction(async (tx) => {
      await this.wallet.debit(playerId, cost, `repair.start:${shipId}`, tx);
      const created = await tx.repairJob.create({
        data: {
          shipId,
          playerId,
          targets: stored as unknown as never,
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

    await this.repairs.add(
      REPAIR_JOB_NAME,
      { repairJobId: job.id },
      { jobId: job.id, delay: durationSeconds * MS_PER_SECOND },
    );

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
  // job (double delivery, reconciler + worker race) sees count 0 and no-ops.
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
        await tx.partInstance.update({
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
