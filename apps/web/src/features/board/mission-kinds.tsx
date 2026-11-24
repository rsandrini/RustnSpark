import type { ReactNode } from 'react';
import type { MissionType } from '../../api/generated';

// One registry for the mission kinds: a new kind is one entry here (plus its board.type.* label).
// Glyphs follow features/market/part-class-icon.tsx: 20x20 grid, current text colour, decorative.
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

export interface MissionKind {
  icon: ReactNode;
  labelKey: string;
}

const kind = (type: string, icon: ReactNode): MissionKind => ({
  icon,
  labelKey: `board.type.${type}`,
});

const FLAG = glyph('M5 17V3', 'M5 4h10l-2 3.500 2 3.500H5');

const KINDS: Record<MissionType, MissionKind> = {
  DELIVERY: kind(
    'DELIVERY',
    glyph('M3 6.500 10 3l7 3.500v7L10 17l-7-3.500z', 'M3 6.500l7 3.500 7-3.500', 'M10 10v7'),
  ),
  TRANSPORT: kind(
    'TRANSPORT',
    glyph('M3 5h9v8H3z', 'M12 8h3l2 2.500V13h-5', 'M6 15.500h.01', 'M14 15.500h.01'),
  ),
  ESCORT: kind(
    'ESCORT',
    glyph(
      'M10 2.500 16.500 5v5c0 3.500-2.800 6-6.500 7.500C6.300 16 3.500 13.500 3.500 10V5z',
      'M7.500 10l2 2 3.500-4',
    ),
  ),
  MINING: kind(
    'MINING',
    glyph(
      'M4 16l7-7',
      'M9 4c3-1 6 0 7.500 2.500-2-.5-4 0-5.500 1.500',
      'M9 4c-.5 1.500-.5 3 .5 4.500',
    ),
  ),
  RESCUE: kind('RESCUE', glyph('M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M10 6v8', 'M6 10h8')),
  TRAVEL: kind('TRAVEL', glyph('M3 10h14', 'M12 5l5 5-5 5')),
  SCAVENGE: kind(
    'SCAVENGE',
    glyph('M8.500 3a5.500 5.500 0 1 0 0 11 5.500 5.500 0 0 0 0-11z', 'M12.500 12.500 17 17'),
  ),
  RACE: kind('RACE', glyph('M5 17V3', 'M5 4h3v3H5', 'M8 4h3v3H8', 'M11 4h4v6H5', 'M8 7h3v3H8')),
};

const UNKNOWN: MissionKind = { icon: FLAG, labelKey: 'board.type.unknown' };

/** The filter order on the board. */
export const MISSION_KIND_ORDER: readonly MissionType[] = [
  'DELIVERY',
  'TRANSPORT',
  'ESCORT',
  'MINING',
  'RESCUE',
  'RACE',
];

/** Icon and label key for a mission type; an unknown type gets the generic flag. */
export function missionKind(type: string): MissionKind {
  return (KINDS as Record<string, MissionKind | undefined>)[type] ?? UNKNOWN;
}
