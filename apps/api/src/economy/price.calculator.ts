import type { GameRules } from '../config/game-config.types.js';

export interface PartPriceInput {
  readonly basePrice: number;
  readonly isolation: number;
  readonly factionRelation: string;
  readonly mood: number;
  /** 0–100. Catalog listings use 100; used offers roll 40–90 (D25). */
  readonly condition: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * GDD §13: condition multiplies part value linearly (100% → 1.0, 40% → 0.4).
 * Distinct from the wear performance curve (`0.5 + 0.5 × condition/100`).
 */
export function conditionMultiplier(condition: number): number {
  return clamp(condition, 0, 100) / 100;
}

/**
 * S8.1: `value = base × isolation × faction × mood × conditionMultiplier`.
 * `factionRelation` is the player's relation to the location's owning faction
 * (`ally` | `neutral` | `hostile`), keyed through `rules.economy.faction_mult`.
 */
export function partValue(input: PartPriceInput, rules: GameRules): number {
  const e = rules.economy;
  const faction = e.faction_mult[input.factionRelation] ?? 1;
  return (
    input.basePrice * input.isolation * faction * input.mood * conditionMultiplier(input.condition)
  );
}

function toCredits(value: number): number {
  return Math.max(0, Math.round(value));
}

/** Buy price: full local value, rounded to integer credits. */
export function buyPrice(input: PartPriceInput, rules: GameRules): number {
  return toCredits(partValue(input, rules));
}

/** Sell price: `sell_ratio` (default 0.6) × local value. */
export function sellPrice(input: PartPriceInput, rules: GameRules): number {
  return toCredits(partValue(input, rules) * rules.economy.sell_ratio);
}
