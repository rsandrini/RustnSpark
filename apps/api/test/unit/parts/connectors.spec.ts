import { describe, expect, it } from '@jest/globals';
import {
  compatible,
  rollConnectors,
  rotateSide,
  sideKindAt,
  type ConnectorLayout,
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
  it('returns null (the universal fallback) when connectorLayouts is empty, absent, or malformed', () => {
    expect(rollConnectors(null)).toBeNull();
    expect(rollConnectors(undefined)).toBeNull();
    expect(rollConnectors([])).toBeNull();
    expect(rollConnectors('not an array')).toBeNull();
  });

  it('picks one of the candidates when connectorLayouts has entries', () => {
    const candidates = [
      { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] },
      { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const result = rollConnectors(candidates);
      expect(result).not.toBeNull();
      seen.add(JSON.stringify(result));
    }
    // Over 50 rolls both candidates should show up — this is a randomness smoke test, not a
    // strict distribution check (astronomically unlikely to false-fail at 50 draws from 2).
    expect(seen.size).toBe(2);
  });
});
