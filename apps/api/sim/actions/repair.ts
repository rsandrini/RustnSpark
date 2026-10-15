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
): { points: number; cost: number; seconds: number; partIds: string[] } {
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
  }

  const tier = shipTier(
    installedParts(state.ship, catalogByType).map((part) => ({ basePrice: part.catalog.basePrice })),
    rules,
  );
  const raw = repairCost(costInput, tier, facts.isolation, facts.factionRelation, rules);
  const cost = points <= 0 ? 0 : Math.max(1, Math.round(raw));
  const seconds = points * repairSecondsAt(snapshot, rules, locationId);
  return { points, cost, seconds, partIds };
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


