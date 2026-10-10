import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { createRng } from '../common/rng/rng.js';
import { GameConfigService } from '../config/game-config.service.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import type { Placement } from '../parts/part.types.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyConnectivity } from '../ships/connectivity.js';
import { withDirectionProblems } from '../ships/direction.js';
import { connectedPartIds } from '../ships/geometry.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { loadHold, withHoldProblem } from '../ships/hold.js';
import { checkViability } from '../ships/viability.js';
import { DispatchService, type DispatchResponse } from './dispatch.service.js';
import {
  isMiningEligible,
  legForRoute,
  type FillerLocation,
  type FillerWorld,
} from './generator/template.filler.js';
import { ACTIVE_STATUSES } from './missions.service.js';

export const MINING_JOB_TEMPLATE_ID = 'mining_job_generic';
const MS_PER_HOUR = 3_600_000;
// A dig around the ship's own location burns no fuel: it never leaves.
const MINING_FUEL_MULT = 0;

/**
 * Independent mining, as a timed job (round 10 owner request — same shape as
 * ScavengeJobService's own timed job): a free (uncontracted) MINING mission created at the
 * ship's own location, dispatched through the same DispatchService, that starts and ends in
 * the same place and pays nothing up front — its yield (round 2 of the leg resolver, already
 * wired for any mission of type MINING via mission.cargo) is whatever the dig actually turns
 * up. Gated on two things a board-generated mining contract never had to check client-side:
 * the location must be minable at all, and the ship must carry a mining rig.
 */
@Injectable()
export class MiningJobService {
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

    const templates = await this.prisma.missionTemplate.findMany({
      where: { type: 'MINING', active: true },
      select: { id: true, type: true, factionId: true, active: true, requirements: true },
    });
    const origin: FillerLocation = {
      id: location.id,
      type: location.type,
      zone: location.zone,
      factionId: location.factionId,
    };
    if (!isMiningEligible(origin, templates)) {
      throw new ConflictException({ error: 'NOT_MINABLE' });
    }

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
    const installedRows = rows.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    const installed = installedRows.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(
      (ship.layout as unknown as Placement[]) ?? [],
      catalogForConnectivity,
      connectorsByInstance,
    );
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    // Mining flies the ship out to the field, so the part direction rules (nothing behind an
    // engine's exhaust / a weapon's firing line) apply, like dispatch and travel.
    const viability = withHoldProblem(
      withDirectionProblems(
        checkViability(sheet, installedConnected, rules),
        (ship.layout as unknown as Placement[]) ?? [],
        catalogForConnectivity,
        connectorsByInstance,
        { strict: true },
      ),
      await loadHold(this.prisma, playerId, rules.ship.spare_part_slots, sheet.crg),
    );
    if (!viability.viable) {
      throw new BadRequestException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
    }
    // A mining rig is the whole point of the trip — the chance formula (mining.resolver.ts)
    // already yields 0 without one, but that would waste the fixed duration for nothing.
    if (sheet.min < 1) {
      throw new BadRequestException({ error: 'NO_MINING_RIG' });
    }

    const materials = await this.prisma.material.findMany({
      // ores only: the scrap materials have a fixed price and are found by scavenging, not dug up
      where: { active: true, fixedPrice: false },
      select: { id: true },
    });
    if (materials.length === 0) throw new ConflictException({ error: 'NOT_MINABLE' });

    const now = this.clock.now();

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
    // A distance that makes the dig last job_duration_seconds for THIS ship (mission time) —
    // same trick ScavengeJobService uses for its own fixed duration.
    const distance = Math.max(
      1,
      Math.round(
        (rules.mining.job_duration_seconds /
          (rules.missions.duration_k * rules.missions.time_scale)) *
          sheet.mob,
      ),
    );
    const leg = {
      ...base,
      distance,
      danger,
      zone: location.zone,
      env: { ...base.env, fuelMult: MINING_FUEL_MULT },
    };

    const seed = `mining|${playerId}|${locationId}|${now.getTime()}`;
    const materialId = createRng(seed).child('mining-pick').pick(materials).id;

    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true },
    });
    let missionId: string;
    try {
      const mission = await this.prisma.missionInstance.create({
        data: {
          templateId: MINING_JOB_TEMPLATE_ID,
          type: 'MINING',
          factionId: player.factionId ?? location.factionId,
          originId: locationId,
          destinationId: locationId,
          legs: [leg],
          // Free mode (contracted: false) — no required quantity, no pay/fail gate; keep
          // whatever the dig turns up, same as a board-generated free mining mission.
          cargo: { materialId, contracted: false },
          reward: 0,
          expiresAt: new Date(now.getTime() + MS_PER_HOUR),
          status: 'ACCEPTED',
          playerId,
          shipId: ship.id,
          acceptedAt: now,
          seed,
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
      return await this.dispatchService.dispatch(ship.id, missionId, playerId);
    } catch (error) {
      await this.prisma.missionInstance.deleteMany({ where: { id: missionId } });
      throw error;
    }
  }
}
