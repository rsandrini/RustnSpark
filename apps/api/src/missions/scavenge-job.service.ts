import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability } from '../ships/viability.js';
import { DispatchService, type DispatchResponse } from './dispatch.service.js';
import { legForRoute, type FillerWorld } from './generator/template.filler.js';
import { ACTIVE_STATUSES } from './missions.service.js';

export const SCAVENGE_TEMPLATE_ID = 'scavenge_generic';
const MS_PER_HOUR = 3_600_000;
const MS_PER_SECOND = 1000;
// A search around the port burns no fuel: the ship never leaves it.
const SCAVENGE_FUEL_MULT = 0;

/**
 * Scavenging as a timed job (owner decision, round 2): a mission of type SCAVENGE created at the
 * ship's own port, dispatched through the same DispatchService (ship locked, timer, encounters
 * from the place's danger, resolution, report), that starts and ends in the same place and pays
 * nothing. Its finds (used parts, some scrap) come out of the seeded resolver when it resolves.
 */
@Injectable()
export class ScavengeJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly dispatchService: DispatchService,
    private readonly clock: Clock,
  ) {}

  async start(playerId: string, locationId: string): Promise<DispatchResponse> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw new NotFoundException('location not found');
    const { rules } = this.config.snapshot();

    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId, currentLocationId: locationId },
    });
    if (!ship) throw new ConflictException({ error: 'SHIP_NOT_AT_LOCATION' });
    if (ship.status === 'ON_MISSION') throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    if (ship.status !== 'IN_PORT') throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });

    const [active, repairing] = await Promise.all([
      this.prisma.missionInstance.count({
        where: { playerId, status: { in: [...ACTIVE_STATUSES] } },
      }),
      this.prisma.repairJob.count({ where: { shipId: ship.id, status: 'PENDING' } }),
    ]);
    if (active > 0) throw new ConflictException({ error: 'ACTIVE_MISSION_EXISTS' });
    if (repairing > 0) throw new ConflictException({ error: 'SHIP_REPAIRING' });

    const rows = await this.parts.findPlayerParts(playerId);
    const installed = rows
      .filter((part) => part.location === 'INSTALLED' && part.shipId === ship.id)
      .map((part) => ({ instance: part, catalog: pickCatalogStats(part.partCatalog) }));
    const sheet = deriveSheet(installed, rules);
    const viability = checkViability(sheet, installed, rules);
    if (!viability.viable) {
      throw new BadRequestException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
    }

    const now = this.clock.now();
    const counter = await this.prisma.scavengeCounter.upsert({
      where: { playerId_locationId: { playerId, locationId } },
      create: { playerId, locationId, attemptCount: 0 },
      update: {},
    });
    const cooldown = rules.scavenging.cooldown_seconds;
    if (counter.attemptCount > 0 && counter.lastAttemptAt !== null && cooldown > 0) {
      const elapsed = Math.floor((now.getTime() - counter.lastAttemptAt.getTime()) / MS_PER_SECOND);
      if (cooldown - elapsed > 0) {
        throw new ConflictException({
          error: 'SCAVENGE_COOL_DOWN',
          retryAfterSeconds: cooldown - elapsed,
        });
      }
    }

    // The place's risk is the danger of the routes around it: the same number encounters use.
    const routes = await this.prisma.route.findMany({
      where: { OR: [{ nodeAId: locationId }, { nodeBId: locationId }] },
      orderBy: { id: 'asc' },
    });
    const route = routes[0];
    if (route === undefined) throw new ConflictException({ error: 'NO_ROUTE' });
    const [locations, routeEnvironments, environments] = await Promise.all([
      this.prisma.location.findMany(),
      this.prisma.routeEnvironment.findMany(),
      this.prisma.environment.findMany(),
    ]);
    const world: FillerWorld = {
      locations,
      routes,
      routeEnvironments,
      environments,
      templates: [],
      materials: [],
    };
    const base = legForRoute(route, new Map(locations.map((entry) => [entry.id, entry])), world);
    const danger = routes.reduce((peak, entry) => Math.max(peak, entry.danger), 0);
    // A distance that makes the flight last `duration_seconds` for THIS ship (mission time).
    const distance = Math.max(
      1,
      Math.round(
        (rules.scavenging.duration_seconds /
          (rules.missions.duration_k * rules.missions.time_scale)) *
          sheet.mob,
      ),
    );
    const leg = {
      ...base,
      distance,
      danger,
      zone: location.zone,
      env: { ...base.env, fuelMult: SCAVENGE_FUEL_MULT },
    };

    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true },
    });
    let missionId: string;
    try {
      const mission = await this.prisma.missionInstance.create({
        data: {
          templateId: SCAVENGE_TEMPLATE_ID,
          type: 'SCAVENGE',
          factionId: player.factionId ?? location.factionId,
          originId: locationId,
          destinationId: locationId,
          legs: [leg],
          cargo: {},
          reward: 0,
          expiresAt: new Date(now.getTime() + MS_PER_HOUR),
          status: 'ACCEPTED',
          playerId,
          shipId: ship.id,
          acceptedAt: now,
          seed: `scavenge|${playerId}|${locationId}|${counter.attemptCount}|${now.getTime()}`,
          version: 0,
        },
      });
      missionId = mission.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'ACTIVE_MISSION_EXISTS' });
      }
      throw error;
    }

    try {
      const response = await this.dispatchService.dispatch(ship.id, missionId, playerId);
      await this.prisma.scavengeCounter.update({
        where: { playerId_locationId: { playerId, locationId } },
        data: { attemptCount: counter.attemptCount + 1, lastAttemptAt: now },
      });
      return response;
    } catch (error) {
      await this.prisma.missionInstance.deleteMany({ where: { id: missionId } });
      throw error;
    }
  }
}
