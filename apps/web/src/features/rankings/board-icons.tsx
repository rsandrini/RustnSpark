import type { ReactNode } from 'react';
import type { RankingBoard } from '../../api/generated';

// One small glyph per ranking board on a 20x20 grid, drawn with the current text colour so the kit's tab states
// colour them (same style as the part-class glyphs). A board with no glyph gets the fallback.
const glyph = (...paths: string[]): ReactNode => (
  <svg
    viewBox="0 0 20 20"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

export const FALLBACK_BOARD_ICON = glyph(
  'M10 3l2 5 5 .5-4 3.500 1.200 5L10 14l-4.200 3 1.200-5L3 8.500 8 8z',
);

export const BOARD_ICON: Record<RankingBoard, ReactNode> = {
  distance: glyph('M3 10h14', 'M13 6l4 4-4 4', 'M3 5v10'),
  fights_won: glyph('M4 16l9-9', 'M13 4h3v3', 'M16 16l-9-9', 'M7 4H4v3'),
  race_wins: glyph('M6 3h8v5a4 4 0 0 1-8 0z', 'M10 12v3', 'M7 17h6'),
  race_time: glyph(
    'M10 4a6.500 6.500 0 1 0 0 13 6.500 6.500 0 0 0 0-13z',
    'M10 7.500V11l2.500 1.500',
    'M8 2h4',
  ),
  ship_power: glyph('M11 2.500L5 11h4.500L9 17.500 15 9h-4.500z'),
  ship_speed: glyph('M3 14a7 7 0 0 1 14 0', 'M10 14l3.500-4.500', 'M5 14h1.500', 'M13.500 14H15'),
};

export const boardIcon = (board: string): ReactNode =>
  (BOARD_ICON as Record<string, ReactNode>)[board] ?? FALLBACK_BOARD_ICON;
