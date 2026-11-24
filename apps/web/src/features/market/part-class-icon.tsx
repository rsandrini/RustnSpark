import type { ReactNode } from 'react';

// One small glyph per part class / shop group, drawn on a 20x20 grid with the current text colour so
// the kit's tab states (muted, selected) colour them. A class with no glyph falls back to its
// first letters, so a new class never renders an empty button.
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

const HULL = glyph('M10 2.5 16.5 5v5c0 3.5-2.8 6-6.5 7.5C6.3 16 3.5 13.5 3.5 10V5z');
const ENGINE = glyph('M7 3h6l1 5H6z', 'M6 8l-2 9h12l-2-9', 'M10 11v4');
const WEAPON = glyph('M3 10h14', 'M10 3v14', 'M6 6l8 8', 'M14 6l-8 8');

export const PART_CLASS_ICON: Record<string, ReactNode> = {
  HULL,
  ARMOR: glyph('M4 4h12v12H4z', 'M4 10h12', 'M10 4v12'),
  SHIELD: glyph(
    'M10 2.5c2 1.8 4.2 2.5 6.5 2.5 0 6-2.2 10.5-6.5 12.5C5.700 15.500 3.500 11 3.500 5c2.300 0 4.500-.7 6.500-2.500z',
  ),
  DEFENSE: HULL,
  ENGINE,
  ENGINE_CHEM: ENGINE,
  ENGINE_ION: glyph('M10 3v14', 'M6 6l4-3 4 3', 'M6 11l4-3 4 3', 'M6 16l4-3 4 3'),
  WEAPON,
  WEAPON_BALLISTIC: glyph('M10 3v6', 'M8 9h4v8H8z', 'M8 12h4'),
  WEAPON_LASER: glyph('M3 10h8', 'M13 10h4', 'M11 7l2 3-2 3'),
  WEAPON_MISSILE: glyph(
    'M10 2.5c2 2 2.500 4.500 2.500 8h-5c0-3.500.5-6 2.500-8z',
    'M7.500 10.500 5 14h2.500',
    'M12.500 10.500 15 14h-2.500',
    'M10 14v3.500',
  ),
  TANK: glyph('M6 4h8v13H6z', 'M8 4V2.500h4V4', 'M6 10h8'),
  BATTERY: glyph('M5 6h9v8H5z', 'M14 8.500h1.500v3H14', 'M8 8.500v3'),
  REACTOR: glyph(
    'M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M10 3.500c3.600 0 6.500 2.900 6.500 6.500S13.600 16.500 10 16.500 3.500 13.600 3.500 10 6.400 3.500 10 3.500z',
  ),
  CARGO: glyph(
    'M3.500 6.500 10 3.500l6.500 3v7L10 16.500l-6.500-3z',
    'M3.500 6.500 10 9.500l6.500-3',
    'M10 9.500v7',
  ),
  SENSOR: glyph('M4 14a8 8 0 0 1 12 0', 'M6.500 12a5 5 0 0 1 7 0', 'M10 15.500v.01'),
  UTILITY: glyph(
    'M5 15l6-6',
    'M12.500 3.500a3.500 3.500 0 0 0-3.500 4.500L4 13l3 3 5-5a3.500 3.500 0 0 0 4.500-3.500l-2 2-2-.5-.5-2z',
  ),
};

/** The tab's face: the class glyph, or the label's first letters when the class has none. */
export function partClassIcon(group: string, label: string): ReactNode {
  return (
    PART_CLASS_ICON[group] ?? (
      <span className="kit-tab-text" aria-hidden="true">
        {label.slice(0, 2)}
      </span>
    )
  );
}

export const ALL_ICON: ReactNode = glyph(
  'M4 4h5v5H4z',
  'M11 4h5v5h-5z',
  'M4 11h5v5H4z',
  'M11 11h5v5h-5z',
);
