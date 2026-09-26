import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import { fuelUnits } from '../economy/fuel-cost.calculator.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkViability } from '../ships/viability.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { DispatchService, type DispatchResponse } from './dispatch.service.js';
import { missionDuration } from './duration.calculator.js';
import {
  buildAdjacency,
  legForRoute,
  shortestPath,
  type FillerWorld,
} from './generator/template.filler.js';
import { ACTIVE_STATUSES } from './missions.service.js';

export const TRAVEL_TEMPLATE_ID = 'travel_generic';
// A requested trip is created already accepted and dispatched at once; the offer window only
// has to outlive that call.
const MS_PER_HOUR = 3_600_000;
const TRAVEL_OFFER_TTL_MS = MS_PER_HOUR;

export type TravelBlocker =
  | 'NO_SHIP'
  | 'SAME_PLACE'
  | 'NO_ROUTE'
  | 'ACTIVE_MISSION_EXISTS'
  | 'SHIP_NOT_IN_PORT'
  | 'SHIP_REPAIRING'
  | 'SHIP_NOT_VIABLE'
  | 'NOT_ENOUGH_FUEL';

export interface TravelLeg {
  readonly routeId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly distance: number;
  readonly danger: number;
  readonly zone: number;
}

/** What a trip would cost and whether the ship can leave right now. Nothing is created. */
export interface TravelQuote {
  readonly originId: string;
  readonly destinationId: string;
  readonly legs: readonly TravelLeg[];
  readonly totalDistance: number;
  readonly durationSeconds: number;
  /** Fuel units the trip burns (never credits: fuel is bought at the pump). */
  readonly fuelNeeded: number;
  readonly fuelHave: number;
  readonly peakDanger: number;
  readonly blockers: readonly TravelBlocker[];
  readonly canDepart: boolean;
}

/**
 * Travel without a quest. A trip is an ordinary mission of type TRAVEL (no cargo, reward 0),
 * created already accepted and dispatched through the same DispatchService, so fuel, legs,
 * encounters, the in-transit lock, resolution and reports are exactly the ones every mission
 * uses. The only new rule: it burns fuel and pays nothing.
 */
@Injectable()
export class TravelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly dispatchService: DispatchService,
  ) {}

  async quote(playerId: string, destinationId: string): Promise<TravelQuote> {
    return (await this.plan(playerId, destinationId)).quote;
  }

  async travel(playerId: string, destinationId: string): Promise<DispatchResponse> {
    const { quote, shipId, factionId, legs } = await this.plan(playerId, destinationId);
    const blocker = quote.blockers[0];
    if (blocker === 'SHIP_NOT_VIABLE') {
      throw new BadRequestException({ error: blocker });
    }
    if (blocker !== undefined) {
      throw new ConflictException({ error: blocker });
    }

    const now = new Date();
    let missionId: string;
    try {
      const mission = await this.prisma.missionInstance.create({
        data: {
          templateId: TRAVEL_TEMPLATE_ID,
          type: 'TRAVEL',
          factionId,
          originId: quote.originId,
          destinationId: quote.destinationId,
          legs: legs as unknown as Prisma.InputJsonValue,
          cargo: {},
          reward: 0,
          expiresAt: new Date(now.getTime() + TRAVEL_OFFER_TTL_MS),
          status: 'ACCEPTED',
          playerId,
          shipId,
          acceptedAt: now,
          seed: `travel|${playerId}|${quote.originId}|${quote.destinationId}|${now.getTime()}`,
          version: 0,
        },
      });
      missionId = mission.id;
    } catch (error) {
      // The one-active-mission partial unique index: a double click loses here.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'ACTIVE_MISSION_EXISTS' });
      }
      throw error;
    }

    try {
      return await this.dispatchService.dispatch(shipId, missionId, playerId);
    } catch (error) {
      // Nothing left port: the trip never existed.
      await this.prisma.missionInstance.deleteMany({ where: { id: missionId } });
      throw error;
    }
  }

  private async plan(playerId: string, destinationId: string) {
    const destination = await this.prisma.location.findUnique({ where: { id: destinationId } });
    if (!destination) throw new NotFoundException('location not found');

    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
    });
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true },
    });
    const { rules } = this.config.snapshot();
    const blockers: TravelBlocker[] = [];

    const empty = (originId: string, extra: TravelBlocker[]): TravelQuote => ({
      originId,
      destinationId,
      legs: [],
      totalDistance: 0,
      durationSeconds: 0,
      fuelNeeded: 0,
      fuelHave: ship?.fuel ?? 0,
      peakDanger: 0,
      blockers: extra,
      canDepart: false,
    });
    if (!ship) {
      return { quote: empty('', ['NO_SHIP']), shipId: '', factionId: '', legs: [] };
    }
    if (ship.currentLocationId === destinationId) {
      return {
        quote: empty(ship.currentLocationId, ['SAME_PLACE']),
        shipId: ship.id,
        factionId: player.factionId ?? '',
        legs: [],
      };
    }

    const world = await this.loadWorld();
    const path = shortestPath(ship.currentLocationId, destinationId, buildAdjacency(world.routes));
    if (path === null) {
      return {
        quote: empty(ship.currentLocationId, ['NO_ROUTE']),
        shipId: ship.id,
        factionId: player.factionId ?? '',
        legs: [],
      };
    }
    const locationsById = new Map(world.locations.map((location) => [location.id, location]));
    const legs = path.map((route) => legForRoute(route, locationsById, world));

    // The far end of each leg, walking from the origin (routes are undirected).
    let at = ship.currentLocationId;
    const travelLegs: TravelLeg[] = legs.map((leg, index) => {
      const route = path[index]!;
      const from = at;
      at = route.nodeAId === at ? route.nodeBId : route.nodeAId;
      return {
        routeId: route.id,
        fromId: from,
        toId: at,
        distance: leg.distance,
        danger: leg.danger,
        zone: leg.zone,
      };
    });

    const rows = await this.parts.findPlayerParts(playerId);
    const installed = rows
      .filter((part) => part.location === 'INSTALLED' && part.shipId === ship.id)
      .map((part) => ({ instance: part, catalog: pickCatalogStats(part.partCatalog) }));
    const sheet = deriveSheet(installed, rules);
    const viability = checkViability(sheet, installed, rules);

    const [active, repairing] = await Promise.all([
      this.prisma.missionInstance.count({
        where: { playerId, status: { in: [...ACTIVE_STATUSES] } },
      }),
      this.prisma.repairJob.count({ where: { shipId: ship.id, status: 'PENDING' } }),
    ]);
    if (active > 0) blockers.push('ACTIVE_MISSION_EXISTS');
    if (ship.status !== 'IN_PORT') blockers.push('SHIP_NOT_IN_PORT');
    if (repairing > 0) blockers.push('SHIP_REPAIRING');
    if (!viability.viable) blockers.push('SHIP_NOT_VIABLE');

    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const fuelNeeded = legs.reduce(
      (sum, leg) =>
        sum +
        fuelUnits({
          fuelUse: sheet.fuelUse,
          distance: leg.distance,
          envFuelMult: leg.env.fuelMult,
        }),
      0,
    );
    if (viability.viable && fuelNeeded > ship.fuel) blockers.push('NOT_ENOUGH_FUEL');

    const durationSeconds =
      sheet.mob > 0
        ? missionDuration({
            totalDistance,
            mobility: sheet.mob,
            durationK: rules.missions.duration_k,
            timeScale: rules.missions.time_scale,
            classCutoffs: rules.missions.duration_class_cutoffs,
          }).durationSeconds
        : 0;

    const quote: TravelQuote = {
      originId: ship.currentLocationId,
      destinationId,
      legs: travelLegs,
      totalDistance,
      durationSeconds,
      fuelNeeded,
      fuelHave: ship.fuel,
      peakDanger: legs.reduce((peak, leg) => Math.max(peak, leg.danger), 0),
      blockers,
      canDepart: blockers.length === 0,
    };
    return { quote, shipId: ship.id, factionId: player.factionId ?? '', legs };
  }

  private async loadWorld(): Promise<FillerWorld> {
    const [locations, routes, routeEnvironments, environments] = await Promise.all([
      this.prisma.location.findMany(),
      this.prisma.route.findMany(),
      this.prisma.routeEnvironment.findMany(),
      this.prisma.environment.findMany(),
    ]);
    return {
      locations,
      routes,
      routeEnvironments,
      environments,
      templates: [],
      materials: [],
    };
  }
}
