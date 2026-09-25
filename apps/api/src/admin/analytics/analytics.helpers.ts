// S11.3 pure aggregation helpers — the arithmetic behind screens A–C stays here, thin of
// I/O, so unit tests pin the exact numbers while the services only fetch windowed rows.

// GDD §17 screen A: "winrate real vs 55% do sweep" — the simulation baseline the live
// combat winrate is compared against.
export const SWEEP_WINRATE_BASELINE = 0.55;

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface NamedTotal {
  readonly reason: string;
  readonly total: number;
}

/** One SQL group: credits that entered / left wallets for one reason head (`repair.start`, …). */
export interface WalletFlowRow {
  readonly reason: string;
  readonly entering: number;
  readonly leaving: number;
}

export interface WalletFlows {
  /** Credits earned or minted by the game's own mechanics (support adjustments excluded). */
  readonly entering: number;
  /** Credits spent or removed by the game's own mechanics (support adjustments excluded). */
  readonly leaving: number;
  /** entering − leaving: positive means inflation. */
  readonly net: number;
  readonly sources: NamedTotal[];
  readonly sinks: NamedTotal[];
  /** Manual support adjustments (grant / remove / reset / clear-balance): NOT organic flow. */
  readonly adjustments: { readonly granted: number; readonly removed: number };
}

/** Buckets a reason (dynamic ids already stripped in SQL, but tolerated here) onto a stable category. */
export function normalizeWalletReason(reason: string): string {
  if (/^mission:[^:]+:payout$/.test(reason)) return 'mission.payout';
  if (reason.startsWith('onboarding')) return 'onboarding';
  const head = reason.split(':')[0] ?? reason;
  if (head === 'repair.start') return 'repair';
  if (head.startsWith('market.sell')) return 'market.sell';
  return head;
}

const SUPPORT_REASON_PREFIX = 'support.';

function toSortedTotals(totals: Map<string, number>): NamedTotal[] {
  return [...totals.entries()]
    .map(([reason, total]) => ({ reason, total }))
    .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));
}

/**
 * Folds SQL-grouped wallet rows into the economy screen: organic flow (sources/sinks) is kept
 * apart from support adjustments, so an admin grant never shows up as game inflation.
 */
export function sumWalletFlows(rows: readonly WalletFlowRow[]): WalletFlows {
  const sourceTotals = new Map<string, number>();
  const sinkTotals = new Map<string, number>();
  let entering = 0;
  let leaving = 0;
  let granted = 0;
  let removed = 0;
  for (const row of rows) {
    const reason = normalizeWalletReason(row.reason);
    if (reason.startsWith(SUPPORT_REASON_PREFIX)) {
      granted += row.entering;
      removed += row.leaving;
      continue;
    }
    if (row.entering > 0) {
      entering += row.entering;
      sourceTotals.set(reason, (sourceTotals.get(reason) ?? 0) + row.entering);
    }
    if (row.leaving > 0) {
      leaving += row.leaving;
      sinkTotals.set(reason, (sinkTotals.get(reason) ?? 0) + row.leaving);
    }
  }
  return {
    entering,
    leaving,
    net: entering - leaving,
    sources: toSortedTotals(sourceTotals),
    sinks: toSortedTotals(sinkTotals),
    adjustments: { granted, removed },
  };
}

export interface MissionOutcomeCounts {
  readonly total: number;
  readonly success: number;
  readonly partialFailure: number;
  readonly failed: number;
  readonly adrift: number;
  /** success / total (GDD "taxa de sucesso"); 0 when the window holds no resolved mission. */
  readonly successRate: number;
}

export interface OutcomeRow {
  readonly outcome: string;
  readonly count: number;
}

/** MissionLog.outcome union from mission.resolver.ts: 'success' | 'failed' | 'adrift' | 'partial_failure'. */
export function summarizeOutcomes(rows: readonly OutcomeRow[]): MissionOutcomeCounts {
  const count = (name: string): number =>
    rows.filter((row) => row.outcome === name).reduce((sum, row) => sum + row.count, 0);
  const success = count('success');
  const partialFailure = count('partial_failure');
  const failed = count('failed');
  const adrift = count('adrift');
  const total = success + partialFailure + failed + adrift;
  return {
    total,
    success,
    partialFailure,
    failed,
    adrift,
    successRate: total === 0 ? 0 : round4(success / total),
  };
}

export interface CombatSummary {
  /** Fights against pirates (sweep baseline combat) inside the window. */
  readonly encounters: number;
  readonly wins: number;
  readonly losses: number;
  /** wins / encounters, rounded to 4 decimals; 0 when no fight happened. */
  readonly winrate: number;
}

/**
 * Pirate fights are counted in SQL (`combat_win` / `combat_loss` events whose `actors.enemy` is
 * `pirate` — PvP `pvp_encounter` markers never count toward the sweep baseline); this only turns
 * the two counts into the screen's numbers.
 */
export function summarizeCombat(wins: number, losses: number): CombatSummary {
  const encounters = wins + losses;
  return {
    encounters,
    wins,
    losses,
    winrate: encounters === 0 ? 0 : round4(wins / encounters),
  };
}

export interface TierHistogram {
  /** Ship count per tier (GDD "distribuição por tier"). */
  readonly tiers: Record<number, number>;
  readonly ships: number;
}

export function tierHistogram(tiers: readonly number[]): TierHistogram {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const tier of tiers) counts[tier] = (counts[tier] ?? 0) + 1;
  return { tiers: counts, ships: tiers.length };
}

export interface OriginCount {
  readonly originId: string;
  readonly count: number;
}

export interface ZoneTraffic {
  readonly zone: number;
  readonly generated: number;
  readonly consumed: number;
}

/**
 * Offers generated per origin zone vs offers taken (accepted) per origin zone — the
 * generation×consumption map on screen C. Origins with no known zone are dropped
 * (shouldn't happen: originId is an FK to Location).
 */
export function summarizeZones(
  generated: readonly OriginCount[],
  consumed: readonly OriginCount[],
  zoneByOrigin: ReadonlyMap<string, number>,
): ZoneTraffic[] {
  const zones = new Map<number, { generated: number; consumed: number }>();
  const bucket = (zone: number): { generated: number; consumed: number } => {
    const existing = zones.get(zone);
    if (existing) return existing;
    const fresh = { generated: 0, consumed: 0 };
    zones.set(zone, fresh);
    return fresh;
  };
  const add = (rows: readonly OriginCount[], key: 'generated' | 'consumed'): void => {
    for (const row of rows) {
      const zone = zoneByOrigin.get(row.originId);
      if (zone === undefined) continue;
      bucket(zone)[key] += row.count;
    }
  };
  add(generated, 'generated');
  add(consumed, 'consumed');
  return [...zones.entries()]
    .map(([zone, totals]) => ({ zone, generated: totals.generated, consumed: totals.consumed }))
    .sort((a, b) => a.zone - b.zone);
}
