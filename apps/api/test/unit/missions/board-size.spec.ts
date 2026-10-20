import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { boardSize, maxOffersOfOneType } from '../../../src/missions/board-size.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('boardSize', () => {
  it('follows the size of the place on the map: 8 on a main port, 6 regional, 4 on a small place', () => {
    expect(boardSize({ type: 'port', detail: 'main' }, rules)).toBe(8);
    expect(boardSize({ type: 'deep_field', detail: 'regional' }, rules)).toBe(6);
    expect(boardSize({ type: 'drydock', detail: 'local' }, rules)).toBe(4);
  });

  it('falls back to the per-location minimum for a place with no size', () => {
    expect(boardSize({ type: 'port' }, rules)).toBe(rules.missions.board_min_per_location);
    expect(boardSize({ type: 'port', detail: 'unknown' }, rules)).toBe(
      rules.missions.board_min_per_location,
    );
  });

  it('a test pad holds one offer (its way back), whatever its size', () => {
    expect(boardSize({ type: 'test_pad', detail: 'local' }, rules)).toBe(1);
  });

  it('is tunable: the Admin can change a size', () => {
    const tuned = {
      ...rules,
      missions: { ...rules.missions, board_min_by_detail: { main: 10, regional: 6, local: 2 } },
    };
    expect(boardSize({ type: 'port', detail: 'main' }, tuned)).toBe(10);
    expect(boardSize({ type: 'drydock', detail: 'local' }, tuned)).toBe(2);
  });
});

describe('maxOffersOfOneType', () => {
  it('is at least half the board (rounded up), never below the configured cap', () => {
    expect(maxOffersOfOneType(8, rules)).toBe(4);
    expect(maxOffersOfOneType(6, rules)).toBe(3);
    expect(maxOffersOfOneType(4, rules)).toBe(2);
    expect(maxOffersOfOneType(1, rules)).toBe(rules.missions.board_max_same_type);
  });
});
