import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RECORD_DIRECTION,
  type RecordKey,
  type StatDelta,
  type StatRecords,
  type StatTotals,
} from './stat-keys.js';

const DAY_LENGTH = 'YYYY-MM-DD'.length;

export interface PlayerStatsRead {
  totals: StatTotals;
  records: StatRecords;
  firstMissionAt: Date | null;
  lastActiveAt: Date | null;
}

/**
 * Per-pilot numbers, lifetime and per UTC day. Every write takes the caller's transaction and is a
 * single statement, so a failed action leaves no count behind and two actions at once cannot lose
 * one (the upsert locks the pilot's row). A read model: nothing here feeds back into resolution.
 */
@Injectable()
export class PlayerStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Today as a UTC calendar day (midnight UTC), the day the daily rows and race results are filed under. */
  today(): Date {
    return new Date(this.clock.now().toISOString().slice(0, DAY_LENGTH));
  }

  /** Adds each non-zero value of `delta` to the lifetime totals and to today's totals. */
  async add(playerId: string, delta: StatDelta, tx: Prisma.TransactionClient): Promise<void> {
    const entries = Object.entries(delta).filter(
      ([, value]) => typeof value === 'number' && Number.isFinite(value) && value !== 0,
    );
    if (entries.length === 0) return;
    const totals = JSON.stringify(Object.fromEntries(entries));
    const day = this.clock.now().toISOString().slice(0, DAY_LENGTH);
    await tx.$executeRaw`
      INSERT INTO "PlayerStats" ("playerId", "totals", "createdAt", "updatedAt")
      VALUES (${playerId}, ${totals}::jsonb, now(), now())
      ON CONFLICT ("playerId") DO UPDATE SET
        "totals" = ${mergedTotals(Prisma.raw('"PlayerStats"."totals"'))},
        "updatedAt" = now()
    `;
    await tx.$executeRaw`
      INSERT INTO "PlayerStatsDaily" ("playerId", "day", "totals")
      VALUES (${playerId}, ${day}::date, ${totals}::jsonb)
      ON CONFLICT ("playerId", "day") DO UPDATE SET
        "totals" = ${mergedTotals(Prisma.raw('"PlayerStatsDaily"."totals"'))}
    `;
  }

  /** Keeps `value` as the record for `key` when it beats the stored one (max or min per key). */
  async best(
    playerId: string,
    key: RecordKey,
    value: number,
    tx: Prisma.TransactionClient,
    meta: { missionId?: string } = {},
  ): Promise<void> {
    if (!Number.isFinite(value)) return;
    const at = this.clock.now().toISOString();
    const record = JSON.stringify({ [key]: { value, at, ...meta } });
    const beats = RECORD_DIRECTION[key] === 'max' ? Prisma.raw('<') : Prisma.raw('>');
    await tx.$executeRaw`
      INSERT INTO "PlayerStats" ("playerId", "records", "createdAt", "updatedAt")
      VALUES (${playerId}, ${record}::jsonb, now(), now())
      ON CONFLICT ("playerId") DO UPDATE SET
        "records" = CASE
          WHEN NOT jsonb_exists("PlayerStats"."records", ${key})
            OR ("PlayerStats"."records" -> ${key} ->> 'value')::numeric ${beats} ${value}
          THEN "PlayerStats"."records" || ${record}::jsonb
          ELSE "PlayerStats"."records"
        END,
        "updatedAt" = now()
    `;
  }

  /** Marks the pilot as active now; `markMission` also sets the time of the first mission, once. */
  async touch(
    playerId: string,
    tx?: Prisma.TransactionClient,
    options: { markMission?: boolean } = {},
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const now = this.clock.now();
    const first = options.markMission === true ? now : null;
    await client.$executeRaw`
      INSERT INTO "PlayerStats" ("playerId", "lastActiveAt", "firstMissionAt", "createdAt", "updatedAt")
      VALUES (${playerId}, ${now}, ${first}, now(), now())
      ON CONFLICT ("playerId") DO UPDATE SET
        "lastActiveAt" = ${now},
        "firstMissionAt" = COALESCE("PlayerStats"."firstMissionAt", ${first}),
        "updatedAt" = now()
    `;
  }

  /** Everything recorded for a pilot; empties for one with no row yet. */
  async read(playerId: string): Promise<PlayerStatsRead> {
    const row = await this.prisma.playerStats.findUnique({ where: { playerId } });
    if (row === null) {
      return { totals: {}, records: {}, firstMissionAt: null, lastActiveAt: null };
    }
    return {
      totals: row.totals as StatTotals,
      records: row.records as StatRecords,
      firstMissionAt: row.firstMissionAt,
      lastActiveAt: row.lastActiveAt,
    };
  }
}

/** SQL for "the stored totals plus the incoming ones, key by key". */
function mergedTotals(stored: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    SELECT COALESCE(jsonb_object_agg(merged.key, merged.total), '{}'::jsonb)
    FROM (
      SELECT parts.key, SUM(parts.value::numeric) AS total
      FROM (
        SELECT key, value FROM jsonb_each_text(${stored})
        UNION ALL
        SELECT key, value FROM jsonb_each_text(EXCLUDED."totals")
      ) AS parts
      GROUP BY parts.key
    ) AS merged
  )`;
}
