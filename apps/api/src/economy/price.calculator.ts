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

// Wallet movements must be positive integers (wallet.service's assertValidWalletOperation),
// and refuel already rounds purchases up with Math.max(1, …) rather than to free — the same
// floor applies here. So a 0-base part (bridge) or a cheap material whose local value rounds
// away is still worth exactly 1¢, never 0¢: a 0-credit buy would 500 on the debit and a
// 0-credit sale would 500 on the credit. buyPrice is floored too, which keeps the no-arbitrage
// invariant buy(c) ≥ sell(c) (round(0.6v) ≤ round(v), both clamped at 1).
function toCredits(value: number): number {
  return Math.max(1, Math.round(value));
}

/** Buy price: full local value, rounded to integer credits (never free). */
export function buyPrice(input: PartPriceInput, rules: GameRules): number {
  return toCredits(partValue(input, rules));
}

/** Sell price: `sell_ratio` (default 0.6) × local value (never worthless). */
export function sellPrice(input: PartPriceInput, rules: GameRules): number {
  return toCredits(partValue(input, rules) * rules.economy.sell_ratio);
}
