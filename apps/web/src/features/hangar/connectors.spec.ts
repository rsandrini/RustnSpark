import { describe, expect, it } from 'vitest';
import type { ConnectorCell, PartCatalogStats, Placement } from '../../api/generated';
import vectors from '../../../../../packages/contract/fixtures/connector-vectors.json';
import {
  authoredSide,
  authoredToWorld,
  computePortMarks,
  kindCompatible,
  rotateSide,
  type Kind,
  type Rot,
  type Side,
} from './connectors';

function catalog(w: number, h: number): PartCatalogStats {
  return {
    partType: 'x', partClass: 'UTILITY', w, h, mass: 1, structureCost: 1, partHp: 1, basePrice: 0,
    pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0,
    fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false,
    lifeSupport: false,
  };
}

const cell = (dx: number, dy: number, side: Side, kind: Kind): ConnectorCell => ({ dx, dy, side, kind });

describe('shared connector vectors (parity with the API)', () => {
  it('kindCompatible matches every pair', () => {
    for (const [a, b, expected] of vectors.compatible as [Kind, Kind, boolean][]) {
      expect(kindCompatible(a, b)).toBe(expected);
    }
  });

  it('rotateSide / authoredSide match at all four angles', () => {
    for (const v of vectors.rotateSide as { side: Side; rot: Rot; world: Side }[]) {
      expect(rotateSide(v.side, v.rot)).toBe(v.world);
      expect(authoredSide(v.world, v.rot)).toBe(v.side);
    }
  });

  it('authoredToWorld matches the cell vectors for every footprint and angle', () => {
    for (const v of vectors.cells as {
      w: number; h: number; rot: Rot; authored: [number, number]; world: [number, number];
    }[]) {
      expect(authoredToWorld(v.authored[0], v.authored[1], v.w, v.h, v.rot)).toEqual({
        x: v.world[0],
        y: v.world[1],
      });
    }
  });
});

describe('computePortMarks', () => {
  const one = catalog(1, 1);
  const central = (sides: Side[]) => sides.map((side) => cell(0, 0, side, 'central'));
  const catalogs = new Map([
    ['a', one],
    ['b', one],
    ['wide', catalog(2, 1)],
  ]);

  it('marks a lone part available on every connector side', () => {
    const marks = computePortMarks(
      [{ partInstanceId: 'a', gx: 0, gy: 0, rot: 0 }],
      catalogs,
      new Map([['a', central(['N', 'E', 'S', 'W'])]]),
    );
    expect(marks.map((m) => `${m.side}:${m.state}`).sort()).toEqual([
      'E:available', 'N:available', 'S:available', 'W:available',
    ]);
  });

  it('connects compatible facing sides and flags incompatible ones', () => {
    const layout: Placement[] = [
      { partInstanceId: 'a', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'b', gx: 1, gy: 0, rot: 0 },
    ];
    const ok = computePortMarks(layout, catalogs, new Map([
      ['a', [cell(0, 0, 'E', 'central')]],
      ['b', [cell(0, 0, 'W', 'central')]],
    ]));
    expect(ok.map((m) => m.state)).toEqual(['connected', 'connected']);

    const mismatch = computePortMarks(layout, catalogs, new Map([
      ['a', [cell(0, 0, 'E', 'central')]],
      ['b', [cell(0, 0, 'W', 'split')]],
    ]));
    expect(mismatch.map((m) => m.state)).toEqual(['incorrect', 'incorrect']);

    const against = computePortMarks(layout, catalogs, new Map([
      ['a', [cell(0, 0, 'E', 'central')]],
      ['b', [cell(0, 0, 'E', 'central')]], // b has nothing on W: that side is none
    ]));
    expect(against.find((m) => m.partInstanceId === 'a')?.state).toBe('incorrect');
  });

  it('treats a neighbour without stored connectors as universal and draws no marks for it', () => {
    const marks = computePortMarks(
      [
        { partInstanceId: 'a', gx: 0, gy: 0, rot: 0 },
        { partInstanceId: 'b', gx: 1, gy: 0, rot: 0 },
      ],
      catalogs,
      new Map([['a', [cell(0, 0, 'E', 'split')]]]),
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ partInstanceId: 'a', state: 'connected' });
  });

  it('draws nothing for legacy parts with empty connectors', () => {
    expect(
      computePortMarks([{ partInstanceId: 'a', gx: 0, gy: 0, rot: 0 }], catalogs, new Map([['a', []]])),
    ).toEqual([]);
  });

  it('skips none sides and edges between a part\'s own cells', () => {
    const marks = computePortMarks(
      [{ partInstanceId: 'wide', gx: 0, gy: 0, rot: 0 }],
      catalogs,
      new Map([
        ['wide', [cell(0, 0, 'E', 'central'), cell(0, 0, 'W', 'none'), cell(1, 0, 'W', 'central')]],
      ]),
    );
    // (0,0,E) faces its own second cell and (1,0,W) faces back: both are internal; W none draws nothing
    expect(marks).toEqual([]);
  });

  it('rotates sides and cell positions with the placement', () => {
    const marks = computePortMarks(
      [{ partInstanceId: 'wide', gx: 5, gy: 5, rot: 90 }],
      catalogs,
      new Map([['wide', [cell(1, 0, 'E', 'central')]]]), // authored east edge of the 2nd cell
    );
    // 90deg cw: authored (1,0) -> world (0,1); authored E -> world S
    expect(marks).toEqual([
      { partInstanceId: 'wide', x: 5, y: 6, side: 'S', kind: 'central', state: 'available' },
    ]);
  });
});
