import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BOARD_ICON, FALLBACK_BOARD_ICON, boardIcon } from './board-icons';
import { BOARDS } from './rankings.page';

const markup = (node: React.ReactNode): string => render(<>{node}</>).container.innerHTML;

describe('board icons', () => {
  it('has an aria-hidden glyph for every board the page lists, and no extra', () => {
    expect(Object.keys(BOARD_ICON).sort()).toEqual([...BOARDS].sort());
    for (const board of BOARDS) {
      const { container } = render(<>{BOARD_ICON[board]}</>);
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('draws every board differently from the fallback and from each other', () => {
    const all = [...BOARDS.map((board) => markup(BOARD_ICON[board])), markup(FALLBACK_BOARD_ICON)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('falls back for an unknown board', () => {
    expect(boardIcon('mystery')).toBe(FALLBACK_BOARD_ICON);
    expect(boardIcon('distance')).toBe(BOARD_ICON.distance);
  });
});
