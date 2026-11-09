import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart } from '../parts/part.types.js';
import {
  chanceToReach,
  findsPerTick,
  oreMix,
  oreSpace,
  type MineableOre,
} from '../resolution/mining/mining-yield.js';

const RARITY_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

/** The rarity of the best mining rig on the ship: it sets how the ore mix leans (COMMON when none). */
export function drillRarityOf(parts: readonly InstalledPart[]): string {
  let best = 'COMMON';
  for (const part of parts) {
    const rarity = part.catalog.rarity ?? 'COMMON';
    if (part.catalog.min <= 0) continue;
    if (RARITY_ORDER.indexOf(rarity) > RARITY_ORDER.indexOf(best)) best = rarity;
  }
  return best;
}

export interface ContractOdds {
  readonly required: number;
  readonly materialId: string;
  /** Mission seconds the ship's drill expects to need for the amount (capped). */
  readonly expectedSeconds: number;
  readonly capSeconds: number;
  /** Chance of reaching the whole amount inside the cap. */
  readonly successChance: number;
  readonly spaceUnits: number;
}

/** What a mining contract looks like for one ship's drill: time, odds and the ore space it must fit. */
export function contractOdds(
  args: {
    readonly materialId: string;
    readonly required: number;
    readonly ores: readonly MineableOre[];
    readonly richness: number;
    readonly drill: { readonly min: number; readonly condition: number; readonly crg: number };
    readonly drillRarity: string;
  },
  rules: GameRules,
): ContractOdds {
  const { materialId, required, ores, richness, drill } = args;
  const miner = { min: drill.min, condition: drill.condition, rigPower: 1 };
  const totalExpected = findsPerTick(miner, richness, rules);
  const shareOfTarget = oreMix(ores, args.drillRarity, rules).get(materialId) ?? 0;
  const targetExpected = totalExpected * shareOfTarget;
  const tick = rules.mining.job_duration_seconds;
  const capSeconds = rules.mining.contract_max_ticks * tick;
  return {
    required,
    materialId,
    expectedSeconds:
      targetExpected > 0 && required > 0
        ? Math.min(capSeconds, Math.round((required / targetExpected) * tick))
        : 0,
    capSeconds,
    successChance:
      required > 0
        ? chanceToReach(required, totalExpected, rules.mining.contract_max_ticks, shareOfTarget)
        : 1,
    spaceUnits: oreSpace(Math.max(0, drill.crg), rules),
  };
}

/**
 * The dig on top of a trip: its time, and the fuel a ship that burns fuel pays for it (an ion-only
 * ship digs for free). Ticks are whole, so the dig's fuel follows the time rounded up to a tick.
 */
export function digExtra(
  seconds: number,
  fuelUse: number,
  rules: GameRules,
): { readonly seconds: number; readonly fuel: number } {
  const ticks = Math.ceil(seconds / rules.mining.job_duration_seconds);
  return {
    seconds,
    fuel: fuelUse > 0 ? ticks * rules.mining.job_fuel_per_tick : 0,
  };
}
