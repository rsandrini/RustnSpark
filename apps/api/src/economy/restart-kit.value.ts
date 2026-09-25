import type { GameRules } from '../config/game-config.types.js';
import { sellPrice } from './price.calculator.js';

/**
 * S8.6's exploit ceiling: the restart kit is granted free at rescue (GDD §14 — "peças de
 * recomeço = sucata grátis") and is strictly additive (old parts are kept), so if the kit
 * can sell for rescue_cost or more, rescue → kit → sell prints credits on a hostile
 * high-isolation port. This computes the worst case the *config* can express: highest
 * isolation multiplier, most hostile faction multiplier, highest mood, and the kit at
 * `parts.restart_condition_max`, summed with the same per-part 1¢ floor the wallet
 * requires. The admin tuning layer rejects any ruleset where this reaches
 * `economy.rescue_cost`.
 */
export function worstCaseRestartKitValue(
  rules: GameRules,
  basePriceOf: (partType: string) => number,
): number {
  const economy = rules.economy;
  const isolation = Math.max(...Object.values(economy.isolation_mult));
  const [factionRelation] = Object.entries(economy.faction_mult).reduce(
    (worst, [relation, mult]) => (mult > worst[1] ? [relation, mult] : worst),
    ['neutral', economy.faction_mult['neutral'] ?? 1] as [string, number],
  );
  const condition = rules.parts.restart_condition_max;
  const starterParts = rules.onboarding.starter_parts as string[];
  return starterParts.reduce(
    (total, partType) =>
      total +
      sellPrice(
        {
          basePrice: basePriceOf(partType),
          isolation,
          factionRelation,
          mood: economy.mood_max,
          condition,
        },
        rules,
      ),
    0,
  );
}
