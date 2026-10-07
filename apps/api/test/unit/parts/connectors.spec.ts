import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { defaultConnectorRules } from '../../../src/parts/connector-rules.js';
import {
  authoredSideAt,
  compatible,
  rollConnectors,
  rotateSide,
  sideKindAt,
  worldToAuthoredCell,
  type ConnectorKind,
  type ConnectorLayout,
  type ConnectorSide,
} from '../../../src/parts/connectors.js';

describe('compatible', () => {
  it('matches central with central or universal, never with split', () => {
    expect(compatible('central', 'central')).toBe(true);
    expect(compatible('central', 'universal')).toBe(true);
    expect(compatible('central', 'split')).toBe(false);
  });

  it('matches split with split or universal, never with central', () => {
    expect(compatible('split', 'split')).toBe(true);
    expect(compatible('split', 'universal')).toBe(true);
    expect(compatible('split', 'central')).toBe(false);
  });

  it('matches universal with anything but none', () => {
    expect(compatible('universal', 'universal')).toBe(true);
    expect(compatible('universal', 'central')).toBe(true);
    expect(compatible('universal', 'split')).toBe(true);
    expect(compatible('universal', 'none')).toBe(false);
  });

  it('none never matches anything, including another none', () => {
    expect(compatible('none', 'none')).toBe(false);
    expect(compatible('none', 'universal')).toBe(false);
  });
});

describe('sideKindAt', () => {
  it('returns universal for every side when the layout is null (the fallback)', () => {
    expect(sideKindAt(null, 0, 0, 'N')).toBe('universal');
    expect(sideKindAt(null, 3, -2, 'W')).toBe('universal');
  });

  it('returns the listed kind for a cell/side that is present', () => {
    const layout: ConnectorLayout = { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] };
    expect(sideKindAt(layout, 0, 0, 'S')).toBe('central');
  });

  it('returns none for a cell/side not listed, when the layout is non-null', () => {
    const layout: ConnectorLayout = { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] };
    expect(sideKindAt(layout, 0, 0, 'N')).toBe('none');
    expect(sideKindAt(layout, 1, 0, 'S')).toBe('none');
  });
});

describe('rotateSide', () => {
  it('leaves sides unchanged at rot 0', () => {
    expect(rotateSide('N', 0)).toBe('N');
    expect(rotateSide('S', 0)).toBe('S');
  });

  it('rotates one step clockwise at rot 90 (N->E->S->W->N)', () => {
    expect(rotateSide('N', 90)).toBe('E');
    expect(rotateSide('E', 90)).toBe('S');
    expect(rotateSide('S', 90)).toBe('W');
    expect(rotateSide('W', 90)).toBe('N');
  });
});

describe('rollConnectors', () => {
  const tank = { w: 1, h: 1 };

  it('returns null (the universal fallback) when the part type has no rules', () => {
    expect(rollConnectors({ ...tank, connectorRules: null })).toBeNull();
    expect(rollConnectors({ ...tank, connectorRules: { sides: {} } })).toBeNull();
  });

  it('generates from the rules, deterministically for a given seed', () => {
    const rules = defaultConnectorRules('TANK');
    const first = rollConnectors({ ...tank, connectorRules: rules }, 'listing-1');
    expect(first?.cells).toHaveLength(4);
    expect(rollConnectors({ ...tank, connectorRules: rules }, 'listing-1')).toEqual(first);
  });
});

// Shared with the web mirror (apps/web/src/features/hangar/connectors.spec.ts): the same vectors
// pin both implementations, so client marks and server connectivity cannot drift apart.
describe('shared connector vectors', () => {
  const vectors = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../packages/contract/fixtures/connector-vectors.json', import.meta.url),
      ),
      'utf8',
    ),
  ) as {
    compatible: [ConnectorKind, ConnectorKind, boolean][];
    rotateSide: { side: ConnectorSide; rot: number; world: ConnectorSide }[];
    cells: { w: number; h: number; rot: number; authored: [number, number]; world: [number, number] }[];
  };

  it('compatible matches every pair', () => {
    for (const [a, b, expected] of vectors.compatible) expect(compatible(a, b)).toBe(expected);
  });

  it('rotateSide / authoredSideAt match at all four angles', () => {
    for (const v of vectors.rotateSide) {
      expect(rotateSide(v.side, v.rot)).toBe(v.world);
      expect(authoredSideAt(v.world, v.rot)).toBe(v.side);
    }
  });

  it('worldToAuthoredCell inverts the placement for every footprint and angle', () => {
    for (const v of vectors.cells) {
      expect(worldToAuthoredCell(v.world[0], v.world[1], v.w, v.h, v.rot)).toEqual({
        dx: v.authored[0],
        dy: v.authored[1],
      });
    }
  });
});
