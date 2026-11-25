import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RankingBoard } from '../../api/generated';
import { BOARD_ICON, FALLBACK_BOARD_ICON, boardIcon } from './board-icons';

const BOARDS: RankingBoard[] = [
  'distance',
  'fights_won',
  'race_wins',
  'race_time',
  'ship_power',
  'ship_speed',
];

describe('board icons', () => {
  it('has an aria-hidden glyph for every ranking board', () => {
    for (const board of BOARDS) {
      const { container } = render(<>{BOARD_ICON[board]}</>);
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('falls back for an unknown board', () => {
    expect(boardIcon('mystery')).toBe(FALLBACK_BOARD_ICON);
    expect(boardIcon('distance')).toBe(BOARD_ICON.distance);
  });
});
