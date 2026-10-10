import type { GameRules } from '../config/game-config.types.js';

// eslint-disable-next-line no-magic-numbers
export type ShipTier = 1 | 2 | 3 | 4 | 5;

export type PricedPart = { basePrice: number };

export function shipTier(parts: readonly PricedPart[], rules: GameRules): ShipTier {
  const thresholds = rules.economy.ship_tier_thresholds;
  const totalValue = parts.reduce((sum, part) => sum + part.basePrice, 0);

  let tier: ShipTier = 1;
  for (const [t, threshold] of Object.entries(thresholds).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    if (totalValue >= threshold) {
      tier = Number(t) as ShipTier;
    }
  }

  return tier;
}
