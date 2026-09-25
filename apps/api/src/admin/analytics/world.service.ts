import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { summarizeCombat, summarizeZones, type ZoneTraffic } from './analytics.helpers.js';
import { countPirateFights } from './analytics.queries.js';
import type { AnalyticsWindow } from './window.js';

export interface RouteTraffic {
  readonly routeId: string;
  readonly crossings: number;
}

export interface WorldSummary {
  /** Ships crossing each route in the window, from RoutePresence overlap rows. */
  readonly traffic: RouteTraffic[];
  /** Fights against pirates resolved in the window (combat_win/combat_loss events). */
  readonly encounters: number;
  /** Offers generated (createdAt) vs taken (acceptedAt) per origin zone. */
  readonly zones: ZoneTraffic[];
}

// Screen C data (GDD §17): traffic per route, pirate encounters, mission generation ×
// consumption per zone. Traffic answers from the RoutePresence GiST index via an overlap
// predicate (`window && tstzrange(from, to)`); zone counts use the S11.3 time indexes.
@Injectable()
export class WorldService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(window: AnalyticsWindow): Promise<WorldSummary> {
    const range = { gte: window.from, lte: window.to };
    const [traffic, fights, generated, consumed, locations] = await Promise.all([
      this.prisma.$queryRaw<RouteTraffic[]>`
        SELECT p."routeId" AS "routeId", COUNT(*)::int AS "crossings"
        FROM "RoutePresence" p
        WHERE p."window" && tstzrange(
          ${window.from.toISOString()}::timestamptz,
          ${window.to.toISOString()}::timestamptz
        )
        GROUP BY p."routeId"
        ORDER BY "crossings" DESC, p."routeId" ASC
      `,
      countPirateFights(this.prisma, window),
      this.prisma.missionInstance.groupBy({
        by: ['originId'],
        where: { createdAt: range },
        _count: { _all: true },
      }),
      this.prisma.missionInstance.groupBy({
        by: ['originId'],
        where: { acceptedAt: range },
        _count: { _all: true },
      }),
      this.prisma.location.findMany({ select: { id: true, zone: true } }),
    ]);
    const zoneByOrigin = new Map(locations.map((location) => [location.id, location.zone]));
    return {
      traffic,
      encounters: summarizeCombat(fights.wins, fights.losses).encounters,
      zones: summarizeZones(
        generated.map((row) => ({ originId: row.originId, count: row._count._all })),
        consumed.map((row) => ({ originId: row.originId, count: row._count._all })),
        zoneByOrigin,
      ),
    };
  }
}
