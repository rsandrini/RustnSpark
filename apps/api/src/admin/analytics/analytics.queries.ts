import type { PrismaService } from '../../prisma/prisma.service.js';
import { WALLET_CREDIT_EVENT, WALLET_DEBIT_EVENT } from '../../players/wallet.service.js';
import type { WalletFlowRow } from './analytics.helpers.js';
import type { AnalyticsWindow } from './window.js';

// The heavy lifting of screens A–C, done in Postgres. The first version pulled every MissionLog
// `legs` blob and every wallet event of the window into Node just to count them; a busy week
// would have meant megabytes of JSON per dashboard refresh. These return a handful of grouped
// rows regardless of traffic, served by the S11.3 indexes (migration 0021).

/** Distinct players who DID something in the window: not merely had something happen to them. */
export async function countActivePlayers(
  prisma: PrismaService,
  window: AnalyticsWindow,
): Promise<number> {
  // Excluded: `mission.resolved` (the worker finishing a run while the player is offline) and
  // wallet movements caused by an admin (`support.*`), neither of which is player activity.
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(DISTINCT "playerId")::int AS n
    FROM "PlayerEvent"
    WHERE "at" >= ${window.from} AND "at" <= ${window.to}
      AND "type" <> 'mission.resolved'
      AND NOT (
        "type" IN (${WALLET_CREDIT_EVENT}, ${WALLET_DEBIT_EVENT})
        AND COALESCE("payload"->>'reason', '') LIKE 'support.%'
      )
  `;
  return rows[0]?.n ?? 0;
}

/** Pirate fights in the window (PvP `pvp_encounter` markers are not fights and never count). */
export async function countPirateFights(
  prisma: PrismaService,
  window: AnalyticsWindow,
): Promise<{ wins: number; losses: number }> {
  const rows = await prisma.$queryRaw<Array<{ type: string; n: number }>>`
    SELECT event->>'type' AS "type", COUNT(*)::int AS n
    FROM "MissionLog" log,
      jsonb_array_elements(
        CASE WHEN jsonb_typeof(log."legs"->'events') = 'array' THEN log."legs"->'events' ELSE '[]'::jsonb END
      ) AS event
    WHERE log."createdAt" >= ${window.from} AND log."createdAt" <= ${window.to}
      AND event->>'type' IN ('combat_win', 'combat_loss')
      AND event->'actors'->>'enemy' = 'pirate'
    GROUP BY 1
  `;
  const count = (type: string): number => rows.find((row) => row.type === type)?.n ?? 0;
  return { wins: count('combat_win'), losses: count('combat_loss') };
}

/**
 * Wallet movements grouped by reason head. Dynamic reasons carry ids
 * (`repair.start:{shipId}`, `mission:{id}:payout`); the CASE strips them in SQL so the number of
 * groups is the number of reason KINDS, not the number of events.
 */
export async function walletFlowRows(
  prisma: PrismaService,
  window: AnalyticsWindow,
): Promise<WalletFlowRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ reason: string; entering: bigint | number; leaving: bigint | number }>
  >`
    SELECT
      CASE
        WHEN reason LIKE 'mission:%:payout' THEN 'mission.payout'
        ELSE split_part(reason, ':', 1)
      END AS reason,
      COALESCE(SUM(GREATEST("creditsDelta", 0)), 0) AS entering,
      COALESCE(SUM(GREATEST(-"creditsDelta", 0)), 0) AS leaving
    FROM (
      SELECT COALESCE("payload"->>'reason', 'unknown') AS reason, "creditsDelta"
      FROM "PlayerEvent"
      WHERE "at" >= ${window.from} AND "at" <= ${window.to}
        AND "type" IN (${WALLET_CREDIT_EVENT}, ${WALLET_DEBIT_EVENT})
    ) events
    GROUP BY 1
  `;
  return rows.map((row) => ({
    reason: row.reason,
    entering: Number(row.entering),
    leaving: Number(row.leaving),
  }));
}
