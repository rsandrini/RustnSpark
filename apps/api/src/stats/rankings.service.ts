import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StatKey } from './stat-keys.js';
import type {
  RaceRoutesResponse,
  RankingBoard,
  RankingEntry,
  RankingResponse,
  RankingWindow,
} from './rankings.types.js';
import { weekStartOf } from './week.js';

const TOP_ENTRIES = 50;

// The counter each counter board ranks. Race time is not a counter: it comes from RaceResult.
const COUNTER_OF: Readonly<Record<Exclude<RankingBoard, 'race_time'>, StatKey>> = {
  distance: 'flight.distance',
  fights_won: 'fights.won',
  race_wins: 'races.won',
};

interface RankedRow {
  id: string;
  name: string;
  factionId: string | null;
  value: Prisma.Decimal | number;
  rank: bigint | number;
  total: bigint | number;
}

/** Live boards over the recorded stats: top 50 plus the asking pilot's own position. */
@Injectable()
export class RankingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async board(
    playerId: string,
    board: RankingBoard,
    window: RankingWindow,
    route?: string,
  ): Promise<RankingResponse> {
    const weekStart = window === 'weekly' ? weekStartOf(this.clock.now()) : null;
    const source =
      board === 'race_time'
        ? this.raceSource(route ?? '', weekStart)
        : this.counterSource(COUNTER_OF[board], weekStart);
    // A faster time ranks higher; for every counter the bigger number does.
    const order = board === 'race_time' ? Prisma.raw('ASC') : Prisma.raw('DESC');

    const rows = await this.prisma.$queryRaw<RankedRow[]>`
      WITH source AS (${source}),
      ranked AS (
        SELECT p.id, p.name, p."factionId", source.value,
          ROW_NUMBER() OVER (ORDER BY source.value ${order}, p."createdAt" ASC, p.name ASC) AS rank,
          COUNT(*) OVER () AS total
        FROM source
        JOIN "Player" p ON p.id = source."playerId"
        JOIN "Account" a ON a.id = p."accountId"
        WHERE a.status = 'ACTIVE' AND source.value > 0
      )
      SELECT * FROM ranked WHERE rank <= ${TOP_ENTRIES} OR id = ${playerId} ORDER BY rank
    `;

    const entries: RankingEntry[] = rows
      .filter((row) => Number(row.rank) <= TOP_ENTRIES)
      .map((row) => ({
        rank: Number(row.rank),
        name: row.name,
        factionId: row.factionId,
        value: Number(row.value),
        isMe: row.id === playerId,
      }));
    const own = rows.find((row) => row.id === playerId);
    return {
      board,
      window,
      route: board === 'race_time' ? (route ?? null) : null,
      weekStart: weekStart?.toISOString() ?? null,
      entries,
      me: own === undefined ? null : { rank: Number(own.rank), value: Number(own.value) },
      total: rows[0] === undefined ? 0 : Number(rows[0].total),
    };
  }

  /** The races that have at least one result, with how many pilots raced each. */
  async raceRoutes(): Promise<RaceRoutesResponse> {
    const rows = await this.prisma.$queryRaw<
      { routeKey: string; originId: string; destinationId: string; pilots: bigint }[]
    >`
      SELECT "routeKey", MIN("originId") AS "originId", MIN("destinationId") AS "destinationId",
        COUNT(DISTINCT "playerId") AS pilots
      FROM "RaceResult"
      GROUP BY "routeKey"
      ORDER BY pilots DESC, "routeKey" ASC
    `;
    return {
      routes: rows.map((row) => ({
        routeKey: row.routeKey,
        originId: row.originId,
        destinationId: row.destinationId,
        pilots: Number(row.pilots),
      })),
    };
  }

  // Lifetime reads the pilot's totals; weekly adds up the daily rows since Monday.
  private counterSource(key: StatKey, weekStart: Date | null): Prisma.Sql {
    if (weekStart === null) {
      return Prisma.sql`
        SELECT "playerId", (totals ->> ${key}::text)::numeric AS value FROM "PlayerStats"`;
    }
    return Prisma.sql`
      SELECT "playerId", SUM((totals ->> ${key}::text)::numeric) AS value
      FROM "PlayerStatsDaily" WHERE day >= ${weekStart}::date GROUP BY "playerId"`;
  }

  // One entry per pilot: their best (smallest) time on the route.
  private raceSource(route: string, weekStart: Date | null): Prisma.Sql {
    const since = weekStart === null ? Prisma.empty : Prisma.sql`AND day >= ${weekStart}::date`;
    return Prisma.sql`
      SELECT "playerId", MIN(seconds)::numeric AS value
      FROM "RaceResult" WHERE "routeKey" = ${route} ${since} GROUP BY "playerId"`;
  }
}
