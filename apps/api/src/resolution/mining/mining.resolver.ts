import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { performance } from '../../parts/condition.js';

/** Environment key into `mining.richness` (open | radiation | gravitational | debris). */
export type MiningEnvKey = string;

/** Material rarity key into `mining.rarity` (common | uncommon | rare). */
export type MaterialRarityKey = string;

export interface MiningStop {
  readonly env: MiningEnvKey;
  readonly materialId: string;
  readonly materialRarity: MaterialRarityKey;
  /** A paid mining quest never comes back empty: at least this many units, whatever the rolls say. */
  readonly minimumYield?: number;
}

export interface MinerRig {
  /** Sheet MIN (sum of mining_rig `min` stats). */
  readonly min: number;
  /** Miner part condition (%) feeding the S4.2 performance table. */
  readonly condition: number;
}

export interface MiningYield {
  readonly materialId: string;
  readonly quantity: number;
}

/** Structured `loot` event carrying material ids (plan S5.6 / S5.9). */
export interface MiningLootEvent {
  readonly category: 'loot';
  readonly type: 'mining';
  readonly materialId: string;
  readonly quantity: number;
}

/**
 * Per-attempt find chance (Appendix E / D18):
 * `richness(env) × (1 − rarity(material)) × efficiency`,
 * `efficiency = MIN × performance(minerCondition)`, clamped to [0, 1].
 */
export function miningChance(stop: MiningStop, miner: MinerRig, rules: GameRules): number {
  const richness = rules.mining.richness[stop.env] ?? 0;
  const rarity = rules.mining.rarity[stop.materialRarity] ?? 1;
  const efficiency = miner.min * performance(miner.condition, rules);
  const chance = richness * (1 - rarity) * efficiency;
  return Math.min(1, Math.max(0, chance));
}

/**
 * One mining stop: `mining.attempts_per_stop` independent rolls at
 * `miningChance`. Returns a single yield entry when at least one attempt
 * succeeds (quantity = successful attempts), otherwise an empty array.
 *
 * RNG order: one `float()` per attempt, in attempt order.
 */
export function resolveMining(
  stop: MiningStop,
  miner: MinerRig,
  rules: GameRules,
  rng: Rng,
): readonly MiningYield[] {
  const chance = miningChance(stop, miner, rules);
  const attempts = rules.mining.attempts_per_stop;
  let quantity = 0;
  for (let i = 0; i < attempts; i += 1) {
    if (rng.float() < chance) {
      quantity += 1;
    }
  }
  quantity = Math.max(quantity, stop.minimumYield ?? 0);
  if (quantity === 0) {
    return [];
  }
  return [{ materialId: stop.materialId, quantity }];
}

/** Wraps a yield as structured `loot` events (one per non-empty yield entry). */
export function toMiningLootEvents(
  yieldEntries: readonly MiningYield[],
): readonly MiningLootEvent[] {
  return yieldEntries.map((entry) => ({
    category: 'loot',
    type: 'mining',
    materialId: entry.materialId,
    quantity: entry.quantity,
  }));
}

export type ContractedMiningStatus = 'paid' | 'partial_failure';

/**
 * Contracted mining settlement: paid only when the required quantity was
 * mined; otherwise partial failure (GDD §12 — insufficient ore, no pay).
 */
export function settleContractedMining(
  minedQuantity: number,
  requiredQuantity: number,
): { readonly status: ContractedMiningStatus; readonly settled: boolean } {
  const settled = minedQuantity >= requiredQuantity && requiredQuantity > 0;
  return { status: settled ? 'paid' : 'partial_failure', settled };
}
