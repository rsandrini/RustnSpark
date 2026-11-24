import type { ReactNode } from 'react';
import type { PartKind } from './part-kind';

// One small glyph per kind of part, on a 20x20 grid in the current text colour (same style as
// features/market/part-class-icon.tsx). `other` is a generic block.
const PATHS: Record<PartKind, string[]> = {
  bridge: ['M3.5 15.5h13', 'M5 15.5V9l5-5 5 5v6.5', 'M8.5 15.5v-4h3v4'],
  engine: ['M7 3h6l1 5H6z', 'M6 8l-2 9h12l-2-9', 'M10 11v4'],
  tank: ['M6 4h8v13H6z', 'M8 4V2.5h4V4', 'M6 10h8'],
  battery: ['M5 6h9v8H5z', 'M14 8.5h1.5v3H14', 'M8 8.5v3'],
  reactor: [
    'M10 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M10 3.5c3.6 0 6.5 2.9 6.5 6.5S13.6 16.5 10 16.5 3.5 13.6 3.5 10 6.4 3.5 10 3.5z',
  ],
  weapon: ['M3 10h14', 'M10 3v14', 'M6 6l8 8', 'M14 6l-8 8'],
  shield: [
    'M10 2.5c2 1.8 4.2 2.5 6.5 2.5 0 6-2.2 10.5-6.5 12.5C5.7 15.5 3.5 11 3.5 5c2.3 0 4.5-.7 6.5-2.5z',
  ],
  armor: ['M4 4h12v12H4z', 'M4 10h12', 'M10 4v12'],
  hull: ['M10 2.5 16.5 5v5c0 3.5-2.8 6-6.5 7.5C6.3 16 3.5 13.5 3.5 10V5z'],
  cargo: ['M3.5 6.5 10 3.5l6.5 3v7L10 16.5l-6.5-3z', 'M3.5 6.5 10 9.5l6.5-3', 'M10 9.5v7'],
  cabin: ['M10 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M5 16.5c0-3 2.2-5 5-5s5 2 5 5'],
  sensor: ['M4 14a8 8 0 0 1 12 0', 'M6.5 12a5 5 0 0 1 7 0', 'M10 15.5v.01'],
  life: ['M10 16.5C4 12.5 3.5 8 6 6c1.7-1.3 3.4-.6 4 .8.6-1.4 2.3-2.1 4-.8 2.5 2 2 6.5-4 10.5z'],
  mining: ['M4 6c3-3 9-3 12 0', 'M10 4v12', 'M7 16.5h6'],
  other: ['M4 4h12v12H4z', 'M8 8h4v4H8z'],
};

export function PartKindIcon({ kind, size = 20 }: { kind: PartKind; size?: number }): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {(PATHS[kind] ?? PATHS.other).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
