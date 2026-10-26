/**
 * Repairing, priced exactly like `economy/repair.service.ts → start`: the batch is costed with
 * `repairCost` (the sim's `uma_vida` form), rounded once, and the clock advances by
 * `points × repairSecondsPerPoint(rules, zone)`. Condition changes only when the repair
 * "completes" — which, in the sim, is the same instant the clock advances past the duration.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { repairCost } from '../../src/economy/repair-cost.calculator.js';
import { shipTier } from '../../src/ships/ship-tier.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { FULL_CONDITION, repairSecondsAt } from '../core/fleet.js';
import { installedParts, type PlayerState } from '../core/state.js';
import { portFactsOf } from '../core/world.js';

export interface RepairTarget {
  readonly partId: string;
  /** Defaults to 100 (a full repair of that part). */
  readonly toCondition?: number;
}

export interface RepairResult {
  readonly points: number;
  readonly cost: number;
  readonly seconds: number;
  readonly repairedPartIds: readonly string[];
}

/** What repairing `targets` (default: every installed part) would cost and take, right here. */
export function repairQuote(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  locationId: string,
  targets?: readonly RepairTarget[],
): {
  points: number;
  cost: number;
  seconds: number;
  partIds: string[];
  /** Each repaired part's points and its share of the bill, plus the port's maintenance fee. */
  shares: { partId: string; points: number; cost: number }[];
  maintenanceCost: number;
} {
  const facts = portFactsOf(snapshot, locationId, state.factionId);
  const parts = state.ship.parts;
  const byId = new Map(parts.map((part) => [part.id, part]));
  const chosen =
    targets === undefined
      ? parts
      : targets.flatMap((target) => {
          const part = byId.get(target.partId);
          return part === undefined ? [] : [part];
        });

  let points = 0;
  const costInput: { basePrice: number; fromCondition: number; toCondition: number }[] = [];
  const partIds: string[] = [];
  const pointsById: number[] = [];
  for (const part of chosen) {
    const catalog = catalogByType.get(part.partType);
    if (catalog === undefined) continue;
    const to = Math.min(FULL_CONDITION, Math.max(part.condition, FULL_CONDITION));
    const gained = Math.max(0, to - part.condition);
    if (gained <= 0) continue;
    points += gained;
    costInput.push({
      basePrice: catalog.basePrice,
      fromCondition: part.condition,
      toCondition: to,
    });
    partIds.push(part.id);
    pointsById.push(gained);
  }

  const tier = shipTier(
    installedParts(state.ship, catalogByType).map((part) => ({ basePrice: part.catalog.basePrice })),
    rules,
  );
  const raw = repairCost(costInput, tier, facts.isolation, facts.factionRelation, rules);
  const cost = points <= 0 ? 0 : Math.max(1, Math.round(raw));
  const seconds = points * repairSecondsAt(snapshot, rules, locationId);
  // The bill split: the parts' own share (the same formula with no maintenance fee), the rest is the fee.
  const partsOnly = points <= 0 ? 0 : repairCost(costInput, 0, facts.isolation, facts.factionRelation, rules);
  const weights = costInput.map(
    (input) =>
      Math.max(input.basePrice, rules.economy.repair_min_base_price) *
      Math.max(0, input.toCondition - input.fromCondition),
  );
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const partsCost = Math.min(cost, Math.round(partsOnly));
  const shares = partIds.map((partId, index) => ({
    partId,
    points: pointsById[index] ?? 0,
    cost: weightSum <= 0 ? 0 : Math.round((partsCost * (weights[index] ?? 0)) / weightSum),
  }));
  // Rounding each share can leave a credit or two over or short: the biggest share takes it.
  const drift = (weightSum <= 0 ? 0 : partsCost) - shares.reduce((sum, share) => sum + share.cost, 0);
  const biggest = shares.reduce((top, share) => (share.cost > (top?.cost ?? -1) ? share : top), shares[0]);
  if (biggest !== undefined) biggest.cost += drift;
  return { points, cost, seconds, partIds, shares, maintenanceCost: cost - partsCost };
}

/**
 * Repair `targets` (default: every installed part, each to 100) at `locationId`, charging the
 * wallet and advancing the clock by the real workshop time. The ship must be in port.
 */
export function repair(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  locationId: string,
  targets?: readonly RepairTarget[],
): RepairResult {
  if (state.locationId !== locationId) {
    throw new Error(`cannot repair at ${locationId}: ship is at ${state.locationId}`);
  }
  const quote = repairQuote(state, snapshot, rules, catalogByType, locationId, targets);
  if (quote.points <= 0) {
    return { points: 0, cost: 0, seconds: 0, repairedPartIds: [] };
  }
  if (quote.cost > state.wallet) {
    throw new Error(
      `cannot repair ${quote.points} points at ${locationId}: costs ${quote.cost}, wallet ${state.wallet}`,
    );
  }
  state.wallet -= quote.cost;
  state.repairActions += 1;
  state.ledger.record('repair', -quote.cost);
  for (const share of quote.shares) {
    const part = state.ship.parts.find((entry) => entry.id === share.partId);
    const row = part === undefined ? undefined : catalogByType.get(part.partType);
    if (part === undefined || row === undefined) continue;
    state.partWearLog.push({
      kind: 'repair',
      seq: state.repairActions,
      partType: part.partType,
      partClass: row.partClass,
      rarity: row.rarity,
      loss: Math.round(share.points * 100) / 100,
      cost: share.cost,
    });
  }
  state.partWearLog.push({
    kind: 'repair',
    seq: state.repairActions,
    partType: 'maintenance',
    partClass: 'MAINT',
    rarity: '-',
    loss: 0,
    cost: quote.maintenanceCost,
  });
  const targetIds = new Set(quote.partIds);
  for (const part of state.ship.parts) {
    if (targetIds.has(part.id)) part.condition = FULL_CONDITION;
  }
  state.clock.advance(quote.seconds);
  return {
    points: quote.points,
    cost: quote.cost,
    seconds: quote.seconds,
    repairedPartIds: quote.partIds,
  };
}


