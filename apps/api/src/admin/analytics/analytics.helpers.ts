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

export interface WalletFlowEvent {
  readonly creditsDelta: number | null;
  readonly payload: unknown;
}

export interface WalletFlows {
  /** Credits minted into player wallets in the window (sum of positive deltas). */
  readonly entering: number;
  /** Credits removed from player wallets in the window (sum of |negative deltas|). */
  readonly leaving: number;
  /** entering − leaving: positive means inflation. */
  readonly net: number;
  readonly sources: NamedTotal[];
  readonly sinks: NamedTotal[];
}

/** Wallet reasons are dynamic (`repair.start:{shipId}`, `mission:{id}:payout`, …) — bucket
 * them onto the stable category names the economy screen displays. */
export function normalizeWalletReason(reason: string): string {
  if (reason.startsWith('mission:') && reason.endsWith(':payout')) return 'mission.payout';
  if (reason === 'onboarding starter credits') return 'onboarding';
  const head = reason.split(':')[0] ?? reason;
  switch (head) {
    case 'repair.start':
      return 'repair';
    case 'market.sell':
    case 'market.sell_material':
      return 'market.sell';
    default:
      return head;
  }
}

function payloadReason(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'reason' in payload) {
    const reason = (payload as { reason?: unknown }).reason;
    if (typeof reason === 'string') return reason;
  }
  return 'unknown';
}

function toSortedTotals(totals: Map<string, number>): NamedTotal[] {
  return [...totals.entries()]
    .map(([reason, total]) => ({ reason, total }))
    .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));
}

export function sumWalletFlows(events: readonly WalletFlowEvent[]): WalletFlows {
  const sourceTotals = new Map<string, number>();
  const sinkTotals = new Map<string, number>();
  let entering = 0;
  let leaving = 0;
  for (const event of events) {
    const delta = event.creditsDelta ?? 0;
    const reason = normalizeWalletReason(payloadReason(event.payload));
    if (delta > 0) {
      entering += delta;
      sourceTotals.set(reason, (sourceTotals.get(reason) ?? 0) + delta);
    } else if (delta < 0) {
      const amount = -delta;
      leaving += amount;
      sinkTotals.set(reason, (sinkTotals.get(reason) ?? 0) + amount);
    }
  }
  return {
    entering,
    leaving,
    net: entering - leaving,
    sources: toSortedTotals(sourceTotals),
    sinks: toSortedTotals(sinkTotals),
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

/** MissionLog.outcome union from mission.resolver.ts: 'success' | 'failed' | 'adrift' | 'partial_failure'. */
export function summarizeOutcomes(outcomes: readonly string[]): MissionOutcomeCounts {
  let success = 0;
  let partialFailure = 0;
  let failed = 0;
  let adrift = 0;
  for (const outcome of outcomes) {
    if (outcome === 'success') success += 1;
    else if (outcome === 'partial_failure') partialFailure += 1;
    else if (outcome === 'failed') failed += 1;
    else if (outcome === 'adrift') adrift += 1;
  }
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
 * MissionLog.legs stores `{ legs, events }` (resolve.service / D36). combat_win and
 * combat_loss carry `actors.enemy`; leg.resolver only ever emits those for pirate fights,
 * so counting `enemy === 'pirate'` keeps PvP (pvp_encounter) out of the sweep baseline.
 */
export function summarizeCombat(legsBlobs: readonly unknown[]): CombatSummary {
  let wins = 0;
  let losses = 0;
  for (const blob of legsBlobs) {
    if (typeof blob !== 'object' || blob === null) continue;
    const events = (blob as { events?: unknown }).events;
    if (!Array.isArray(events)) continue;
    for (const raw of events) {
      if (typeof raw !== 'object' || raw === null) continue;
      const type = (raw as { type?: unknown }).type;
      if (type !== 'combat_win' && type !== 'combat_loss') continue;
      const actors = (raw as { actors?: unknown }).actors;
      const enemy =
        typeof actors === 'object' && actors !== null
          ? (actors as { enemy?: unknown }).enemy
          : undefined;
      if (enemy !== 'pirate') continue;
      if (type === 'combat_win') wins += 1;
      else losses += 1;
    }
  }
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
