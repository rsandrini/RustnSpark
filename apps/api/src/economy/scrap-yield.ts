import type { Rng } from '../common/rng/rng.js';
import { conditionMultiplier } from './price.calculator.js';

export type ScrapRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export interface ScrapYieldInput {
  rarity: ScrapRarity;
  /** Footprint in cells (w * h). */
  cells: number;
  /** 0..100. */
  condition: number;
  /** The part's catalog base price. */
  basePrice: number;
}

export interface ScrapYieldRules {
  base: Record<ScrapRarity, number>;
  perExtraCell: number;
  bonusRolls: number;
  bonusChance: Record<ScrapRarity, number>;
  sellRatio: number;
  sellMinCondition: number;
  /** What one scrap sells for at a port. */
  scrapUnitPrice: number;
}

function baseOf(input: ScrapYieldInput, rules: ScrapYieldRules): number {
  return (
    (rules.base[input.rarity] ?? 0) + Math.floor(Math.max(0, input.cells - 1) * rules.perExtraCell)
  );
}

function chanceOf(input: ScrapYieldInput, rules: ScrapYieldRules): number {
  return (rules.bonusChance[input.rarity] ?? 0) * conditionMultiplier(input.condition);
}

/**
 * A sellable part (condition at or above `sellMinCondition`) never scraps for more than selling
 * it would pay at a port with no discount; at least one piece is always allowed. A part too
 * damaged to sell has no cap. `null` = uncapped.
 */
function capOf(input: ScrapYieldInput, rules: ScrapYieldRules): number | null {
  if (input.condition < rules.sellMinCondition || rules.scrapUnitPrice <= 0) return null;
  const bestSell = Math.floor(
    input.basePrice * conditionMultiplier(input.condition) * rules.sellRatio,
  );
  return Math.max(1, Math.floor(bestSell / rules.scrapUnitPrice));
}

/** What a scrap can give and the odds of each bonus roll: the quote never shows the rolled value. */
export function scrapYieldRange(
  input: ScrapYieldInput,
  rules: ScrapYieldRules,
): { min: number; max: number; chance: number } {
  const base = baseOf(input, rules);
  const cap = capOf(input, rules);
  const limit = (value: number): number => (cap === null ? value : Math.min(value, cap));
  return {
    min: limit(base),
    max: limit(base + rules.bonusRolls),
    chance: chanceOf(input, rules),
  };
}

/** The yield for one part. Seed the rng from the part instance so the result is fixed. */
export function rollScrapYield(
  input: ScrapYieldInput,
  rules: ScrapYieldRules,
  rng: Rng,
): { base: number; bonus: number; pieces: number } {
  const chance = chanceOf(input, rules);
  let bonus = 0;
  for (let i = 0; i < rules.bonusRolls; i += 1) {
    if (rng.float() < chance) bonus += 1;
  }
  const cap = capOf(input, rules);
  const total = baseOf(input, rules) + bonus;
  const pieces = cap === null ? total : Math.min(total, cap);
  const base = Math.min(baseOf(input, rules), pieces);
  return { base, bonus: pieces - base, pieces };
}
