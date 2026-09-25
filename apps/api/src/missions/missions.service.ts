import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, type MissionInstance, type Ship } from '@prisma/client';
import type { Queue } from 'bullmq';
import { GameConfigService } from '../config/game-config.service.js';
import { OwnershipResolverRegistry } from '../common/guards/ownership-resolver.registry.js';
import { MISSION_QUEUE_NAME } from '../jobs/queues.js';
import { pickCatalogStats, PartsService } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { shipTier } from '../ships/ship-tier.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability } from '../ships/viability.js';
import { BoardService, type BoardMission } from './board.service.js';
import { rebuildDispatchData, type DispatchJobData } from './dispatch.service.js';
import { missionReward } from './mission.reward.js';
import { missionStatusAfter } from './mission.state-machine.js';
import { checkMissionRequirements } from './requirements.checker.js';
import { MissionResolveService } from './resolve.service.js';

// Two-int advisory-lock namespace for hold bookkeeping (class | hashtext(playerId)),
// next to the board's 6200: serializes one player's own hold/release/expire-count so
// hold_max can never be raced past, without touching other players' holds.
const HOLD_LOCK_CLASS = 6201;

const DEFAULT_VIEWER_TIER = 1;

const ACTIVE_STATUSES = ['ACCEPTED', 'IN_TRANSIT', 'RESOLVING'] as const;
const PLAYER_VISIBLE_STATUSES = ['HELD', 'ACCEPTED', 'IN_TRANSIT', 'RESOLVING'] as const;
const RESERVABLE_STATUSES = ['AVAILABLE', 'HELD'] as const;

// Resolve-on-read bound (S7.4): a player has at most one in-flight mission (partial
// unique index), so 1 is already generous — the cap documents "bounded" without a knob.
const RESOLVE_ON_READ_LIMIT = 1;

function unavailableError(mission: MissionInstance, playerId: string): string {
  if (mission.status === 'EXPIRED') return 'MISSION_EXPIRED';
  if (
    (mission.status === 'AVAILABLE' || mission.status === 'HELD') &&
    mission.expiresAt.getTime() <= Date.now()
  ) {
    return 'MISSION_EXPIRED';
  }
  if (mission.status === 'HELD' && mission.playerId !== playerId) return 'MISSION_HELD';
  return 'MISSION_NOT_AVAILABLE';
}

@Injectable()
export class MissionsService implements OnModuleInit {
  private readonly logger = new Logger(MissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly board: BoardService,
    private readonly resolveService: MissionResolveService,
    @InjectQueue(MISSION_QUEUE_NAME) private readonly missionQueue: Queue<DispatchJobData>,
    private readonly ownershipRegistry: OwnershipResolverRegistry,
  ) {}

  // Missions own 'mission' ownership (S9.3): reports resolve the owning player
  // through this resolver to answer 404 for foreign mission ids.
  onModuleInit(): void {
    this.ownershipRegistry.register('mission', async (missionId: string) => {
      const mission = await this.prisma.missionInstance.findUnique({
        where: { id: missionId },
        select: { playerId: true },
      });
      return mission?.playerId ? { ownerPlayerId: mission.playerId } : null;
    });
  }

  async getBoard(locationId: string, playerId: string): Promise<BoardMission[]> {
    const tier = await this.viewerTier(playerId, locationId);
    return this.board.getBoard(locationId, tier);
  }

  async getActive(playerId: string): Promise<MissionInstance[]> {
    // S7.4 "resolve on read": a past-arrival IN_TRANSIT mission is resolved synchronously
    // before the read, so the response never shows it still in transit. Bounded (1) and
    // best-effort: a failure logs and leaves the row for the background reconcile tick.
    await this.resolveDueOnRead(playerId);
    // The start deadline keeps running during a hold (design ux §7): a hold that
    // outlives it loses the reservation with no penalty beyond the missed offer.
    await this.prisma.missionInstance.updateMany({
      where: { playerId, status: 'HELD', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED', playerId: null },
    });
    return this.prisma.missionInstance.findMany({
      where: { playerId, status: { in: [...PLAYER_VISIBLE_STATUSES] } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async resolveDueOnRead(playerId: string): Promise<void> {
    const due = await this.prisma.missionInstance.findMany({
      where: { playerId, status: 'IN_TRANSIT', arrivalAt: { lte: new Date() } },
      take: RESOLVE_ON_READ_LIMIT,
      orderBy: { arrivalAt: 'asc' },
    });
    for (const mission of due) {
      try {
        const job = await this.missionQueue.getJob(mission.id);
        const data = job?.data ?? (await rebuildDispatchData(this.prisma, this.parts, mission));
        await this.resolveService.resolve(data);
      } catch (error) {
        this.logger.warn(
          `resolve-on-read failed for mission ${mission.id}; reconciler will retry: ${String(error)}`,
        );
      }
    }
  }

  async hold(missionId: string, playerId: string): Promise<MissionInstance> {
    const { rules } = this.config.snapshot();

    // Expired-target handling lives outside any transaction: throwing from inside one
    // would roll the EXPIRED flip back, and the row must stay flipped after the 409.
    const probe = await this.prisma.missionInstance.findUnique({ where: { id: missionId } });
    if (!probe) throw new NotFoundException('mission not found');
    if (
      (probe.status === 'AVAILABLE' || probe.status === 'HELD') &&
      probe.expiresAt.getTime() <= Date.now()
    ) {
      await this.expire(probe.id);
      throw new ConflictException({ error: 'MISSION_EXPIRED' });
    }

    return this.prisma.$transaction(async (tx) => {
      // ::text cast: pg_advisory_xact_lock returns void, which Prisma's deserializer
      // rejects on $queryRaw (the lock still taken before the cast is applied).
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(${HOLD_LOCK_CLASS}::int4, hashtext(${playerId}::text))::text
      `;

      await tx.missionInstance.updateMany({
        where: { playerId, status: 'HELD', expiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED', playerId: null },
      });

      const mission = await tx.missionInstance.findUnique({ where: { id: missionId } });
      if (!mission) throw new NotFoundException('mission not found');

      if (mission.status === 'HELD' && mission.playerId === playerId) {
        return mission;
      }

      if (missionStatusAfter(mission.status, 'HOLD') === null) {
        throw new ConflictException({ error: unavailableError(mission, playerId) });
      }

      // Expired holds are excluded from the count so a throw that rolls the sweep
      // back can never inflate (or deflate) the hold_max budget.
      const held = await tx.missionInstance.count({
        where: { playerId, status: 'HELD', expiresAt: { gt: new Date() } },
      });
      if (held >= rules.missions.hold_max) {
        throw new ConflictException({ error: 'HOLD_LIMIT' });
      }

      const updated = await tx.missionInstance.updateMany({
        where: { id: mission.id, status: 'AVAILABLE', expiresAt: { gt: new Date() } },
        data: { status: 'HELD', playerId },
      });
      if (updated.count === 0) {
        const fresh = await tx.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
        throw new ConflictException({ error: unavailableError(fresh, playerId) });
      }
      return tx.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    });
  }

  async release(missionId: string, playerId: string): Promise<MissionInstance> {
    const mission = await this.prisma.missionInstance.findUnique({ where: { id: missionId } });
    if (!mission) throw new NotFoundException('mission not found');

    if (mission.status === 'HELD' && mission.expiresAt.getTime() <= Date.now()) {
      await this.expire(mission.id);
      throw new ConflictException({ error: 'MISSION_EXPIRED' });
    }

    const released = await this.prisma.missionInstance.updateMany({
      where: { id: mission.id, status: 'HELD', playerId },
      data: { status: 'AVAILABLE', playerId: null },
    });
    if (released.count === 0) {
      throw new ConflictException({ error: 'HOLD_NOT_OWNED' });
    }
    return this.prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
  }

  async accept(missionId: string, playerId: string, shipId: string): Promise<MissionInstance> {
    const { rules } = this.config.snapshot();

    const mission = await this.prisma.missionInstance.findUnique({ where: { id: missionId } });
    if (!mission) throw new NotFoundException('mission not found');

    // Idempotent: a repeat accept by the same player replays the stored outcome (D29).
    if (mission.status === 'ACCEPTED' && mission.playerId === playerId) {
      return mission;
    }

    const now = new Date();
    if (
      (mission.status === 'AVAILABLE' || mission.status === 'HELD') &&
      mission.expiresAt.getTime() <= now.getTime()
    ) {
      await this.expire(mission.id);
      throw new ConflictException({ error: 'MISSION_EXPIRED' });
    }

    const canAccept =
      mission.status === 'AVAILABLE' ||
      (mission.status === 'HELD' && mission.playerId === playerId);
    if (!canAccept) {
      throw new ConflictException({ error: unavailableError(mission, playerId) });
    }

    const active = await this.prisma.missionInstance.count({
      where: { playerId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (active > 0) {
      throw new ConflictException({ error: 'ACTIVE_MISSION_EXISTS' });
    }

    const ship = await this.prisma.ship.findFirst({
      where: { id: shipId, ownerPlayerId: playerId },
    });
    if (!ship) throw new NotFoundException('ship not found');
    if (ship.currentLocationId !== mission.originId) {
      throw new ConflictException({ error: 'SHIP_NOT_AT_ORIGIN' });
    }

    const rows = await this.parts.findPlayerParts(playerId);
    const installedRows = rows.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    const installed = installedRows.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));

    const sheet = deriveSheet(installed, rules);
    const viability = checkViability(sheet, installed, rules);
    if (!viability.viable) {
      throw new BadRequestException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
    }

    const template = await this.prisma.missionTemplate.findUnique({
      where: { id: mission.templateId },
      select: { requirements: true },
    });
    const requirement = checkMissionRequirements(
      { missionType: mission.type, requirements: template?.requirements, sheet, parts: installed },
      rules,
    );
    if (!requirement.eligible) {
      throw new BadRequestException({
        error: 'MISSION_REQUIREMENTS_NOT_MET',
        reasons: requirement.reasons,
      });
    }

    // D29: the stored reward is provisional; accept finalizes it from this ship's tier.
    const tier = shipTier(
      installedRows.map((part) => ({ basePrice: part.partCatalog.basePrice })),
      rules,
    );
    const reward = missionReward(mission, tier, rules);

    // One active mission per player is a partial unique index (S6.1): a concurrent
    // accept of a second mission loses here with P2002, which must surface as 409.
    let updatedCount: number;
    try {
      const updated = await this.prisma.missionInstance.updateMany({
        where: {
          id: mission.id,
          expiresAt: { gt: new Date() },
          OR: [{ status: 'AVAILABLE' }, { status: 'HELD', playerId }],
        },
        data: { status: 'ACCEPTED', playerId, shipId, acceptedAt: new Date(), reward },
      });
      updatedCount = updated.count;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'ACTIVE_MISSION_EXISTS' });
      }
      throw error;
    }
    if (updatedCount === 0) {
      const fresh = await this.prisma.missionInstance.findUniqueOrThrow({
        where: { id: mission.id },
      });
      if (fresh.status === 'ACCEPTED' && fresh.playerId === playerId) {
        return fresh;
      }
      if (
        (fresh.status === 'AVAILABLE' || fresh.status === 'HELD') &&
        fresh.expiresAt.getTime() <= Date.now()
      ) {
        await this.expire(fresh.id);
        throw new ConflictException({ error: 'MISSION_EXPIRED' });
      }
      throw new ConflictException({ error: unavailableError(fresh, playerId) });
    }

    return this.prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
  }

  private async viewerTier(playerId: string, locationId: string): Promise<number> {
    const ships = await this.prisma.ship.findMany({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
    });
    const ship: Ship | undefined =
      ships.find((candidate) => candidate.currentLocationId === locationId) ?? ships[0];
    if (ship === undefined) return DEFAULT_VIEWER_TIER;

    const rows = await this.parts.findPlayerParts(playerId);
    const installed = rows.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    return shipTier(
      installed.map((part) => ({ basePrice: part.partCatalog.basePrice })),
      this.config.snapshot().rules,
    );
  }

  private async expire(missionId: string): Promise<void> {
    await this.prisma.missionInstance.updateMany({
      where: { id: missionId, status: { in: [...RESERVABLE_STATUSES] } },
      data: { status: 'EXPIRED', playerId: null },
    });
  }
}
