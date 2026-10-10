import type { GameRules } from '../config/game-config.types.js';

/** What the pilot must hand over for an upgrade, besides money. `material` is 'scrap' for any scrap. */
export interface MaterialNeed {
  readonly material: string;
  readonly quantity: number;
}

/** Size steps: up to this many cells, the factor (parts bigger than the last step use `BIGGEST_FACTOR`). */
const SIZE_STEPS = [
  { upTo: 2, factor: 1 },
  { upTo: 4, factor: 2 },
  { upTo: 9, factor: 3 },
] as const;
const BIGGEST_FACTOR = 4;

/** A part's size in cells (width × height) as a small factor: 1 up to 2 cells, 2 up to 4, 3 up to 9, 4 beyond. */
export function sizeFactor(cells: number): number {
  return SIZE_STEPS.find((step) => cells <= step.upTo)?.factor ?? BIGGEST_FACTOR;
}

/**
 * The materials an upgrade asks for, from `economy.upgrade_materials` by the part's CURRENT rarity:
 * `gap` rules scale with the square root of the price gap to the next tier (so small parts ask for a
 * few units and big ones for a few more, not for a mountain), `size` rules with the part's cells.
 */
export function upgradeNeeds(
  rarity: string,
  priceGap: number,
  cells: number,
  rules: GameRules,
): MaterialNeed[] {
  const wanted = rules.economy.upgrade_materials[rarity] ?? [];
  return wanted.map((rule) => ({
    material: rule.material,
    quantity: Math.max(
      1,
      rule.mode === 'gap'
        ? Math.ceil(Math.sqrt(Math.max(0, priceGap)) / rule.k)
        : Math.ceil(rule.k * sizeFactor(cells)),
    ),
  }));
}
