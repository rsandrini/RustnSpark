import type { GameRules } from '../config/game-config.types.js';

/** A board never holds more than this share of one type (half, rounded up). */
const HALF_THE_BOARD = 2;

/**
 * How many live offers a board holds: by the size of the place on the map (`missions.board_min_by_detail`: main,
 * regional, local), the per-location minimum when the place has no size. A test pad keeps one offer (its way
 * back is the only thing it can offer), so its board is never padded with copies.
 */
export function boardSize(
  place: { readonly type: string; readonly detail?: string | null },
  rules: GameRules,
): number {
  if (place.type === 'test_pad') return 1;
  const bySize = rules.missions.board_min_by_detail[place.detail ?? ''];
  return bySize ?? rules.missions.board_min_per_location;
}

/**
 * The most offers of one type on a board: the configured cap, but at least half the board (rounded up), so a bigger
 * board is not squeezed by a cap meant for four offers.
 */
export function maxOffersOfOneType(size: number, rules: GameRules): number {
  return Math.max(rules.missions.board_max_same_type, Math.ceil(size / HALF_THE_BOARD));
}
