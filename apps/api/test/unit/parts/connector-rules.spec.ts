import { describe, expect, it } from '@jest/globals';
import {
  defaultConnectorRules,
  enumerateCombos,
  expandCombo,
  generateConnectors,
  parseConnectorRules,
  previewConnectorRules,
  validateConnectorRules,
  type ConnectorRules,
} from '../../../src/parts/connector-rules.js';

const kinds = (list: Array<[string, number]>) =>
  list.map(([kind, weight]) => ({ kind, weight })) as ConnectorRules['sides']['N'];
const fixed = (kind: string) => kinds([[kind, 100]]);
const coords = (cells: { dx: number; dy: number }[]) =>
  cells.map((c) => `${c.dx},${c.dy}`).sort();

describe('connector rules generation', () => {
  it('returns null for missing or malformed rules (universal fallback)', () => {
    expect(generateConnectors(null, 1, 1, 's')).toBeNull();
    expect(generateConnectors({ sides: {} }, 1, 1, 's')).toBeNull();
  });

  it('is deterministic for a seed', () => {
    const both = kinds([
      ['central', 50],
      ['split', 50],
    ]);
    const rules = { sides: { N: both, E: both, S: both, W: both } };
    expect(generateConnectors(rules, 2, 2, 'abc')).toEqual(generateConnectors(rules, 2, 2, 'abc'));
  });

  it('honours weights roughly over many seeds', () => {
    const rules = {
      sides: {
        N: kinds([
          ['central', 80],
          ['split', 20],
        ]),
        E: fixed('central'),
        S: fixed('central'),
        W: fixed('central'),
      },
    };
    let split = 0;
    for (let i = 0; i < 2000; i += 1) {
      const layout = generateConnectors(rules, 1, 1, `seed-${i}`)!;
      if (layout.cells.find((c) => c.side === 'N')?.kind === 'split') split += 1;
    }
    expect(split / 2000).toBeGreaterThan(0.15);
    expect(split / 2000).toBeLessThan(0.25);
  });

  it('never violates maxConnected, maxSplit or the blacklist', () => {
    const any = kinds([
      ['none', 1],
      ['central', 1],
      ['split', 1],
    ]);
    const rules: ConnectorRules = {
      sides: { N: any, E: any, S: any, W: any },
      maxConnected: 3,
      maxSplit: 1,
      forbidden: [
        { N: 'split', S: 'split' },
        { E: 'none', W: 'none' },
      ],
    };
    const combos = enumerateCombos(rules);
    expect(combos.length).toBeGreaterThan(0);
    for (const { combo } of combos) {
      const values = Object.values(combo);
      expect(values.filter((k) => k !== 'none').length).toBeLessThanOrEqual(3);
      expect(values.filter((k) => k === 'split').length).toBeLessThanOrEqual(1);
      expect(combo.N === 'split' && combo.S === 'split').toBe(false);
      expect(combo.E === 'none' && combo.W === 'none').toBe(false);
    }
  });

  it('rejects rules with no valid combination', () => {
    const rules: ConnectorRules = {
      sides: { N: fixed('split'), E: fixed('split'), S: fixed('central'), W: fixed('central') },
      maxSplit: 1,
    };
    expect(validateConnectorRules(rules)).toMatch(/no side combination/);
  });

  it('requires none on the facing side W for ENGINE and WEAPON only', () => {
    const rules: ConnectorRules = {
      sides: { N: fixed('central'), E: fixed('central'), S: fixed('central'), W: fixed('central') },
    };
    expect(validateConnectorRules(rules, 'ENGINE')).toMatch(/W side/);
    expect(validateConnectorRules(rules, 'WEAPON')).toMatch(/W side/);
    expect(validateConnectorRules(rules, 'TANK')).toBeNull();
    expect(validateConnectorRules(defaultConnectorRules('ENGINE'), 'ENGINE')).toBeNull();
  });

  it('writes only perimeter edges for a 2x2 and nothing for none sides', () => {
    const layout = expandCombo({ N: 'central', E: 'split', S: 'none', W: 'central' }, 2, 2);
    expect(layout.cells).toHaveLength(6);
    expect(layout.cells.filter((c) => c.side === 'S')).toHaveLength(0);
    expect(coords(layout.cells.filter((c) => c.side === 'N'))).toEqual(['0,0', '1,0']);
    expect(coords(layout.cells.filter((c) => c.side === 'E'))).toEqual(['1,0', '1,1']);
  });

  it('a 1x1 part gets its sides on its single cell; defaults give an engine no W cell', () => {
    const engine = generateConnectors(defaultConnectorRules('ENGINE'), 1, 1, 'x')!;
    expect(engine.cells.map((c) => c.side).sort()).toEqual(['E', 'N', 'S']);
    const tank = generateConnectors(defaultConnectorRules('TANK'), 1, 1, 'x')!;
    expect(tank.cells).toHaveLength(4);
  });

  it('oneKindPerPart: every connected side of a part shares one kind, and each kind occurs about equally', () => {
    const rules = defaultConnectorRules('TANK');
    expect(rules.oneKindPerPart).toBe(true);
    for (const { combo } of enumerateCombos(rules)) {
      expect(new Set(Object.values(combo).filter((k) => k !== 'none')).size).toBeLessThanOrEqual(1);
    }
    const counts: Record<string, number> = { central: 0, split: 0, universal: 0 };
    for (let i = 0; i < 3000; i += 1) {
      const kind = generateConnectors(rules, 1, 1, `seed-${i}`)!.cells[0]!.kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    for (const count of Object.values(counts)) {
      expect(count / 3000).toBeGreaterThan(0.29);
      expect(count / 3000).toBeLessThan(0.38);
    }
  });

  it('without oneKindPerPart, sides may mix kinds', () => {
    const mixed = { ...defaultConnectorRules('TANK'), oneKindPerPart: undefined };
    expect(enumerateCombos(mixed).some(({ combo }) => new Set(Object.values(combo)).size > 1)).toBe(true);
  });

  it('parses the default rules', () => {
    expect(parseConnectorRules(defaultConnectorRules('TANK'))).not.toBeNull();
  });

  it('allowedKinds (kits) never rolls split, and falls back to the rules when nothing is left', () => {
    const rules = defaultConnectorRules('TANK');
    for (let i = 0; i < 500; i += 1) {
      const kind = generateConnectors(rules, 1, 1, `kit-${i}`, ['central', 'universal'])!.cells[0]!.kind;
      expect(kind).not.toBe('split');
    }
    const splitOnly: ConnectorRules = { sides: { N: fixed('split'), E: fixed('split'), S: fixed('split'), W: fixed('split') } };
    expect(generateConnectors(splitOnly, 1, 1, 'x', ['central'])!.cells[0]!.kind).toBe('split');
  });

  it('previewConnectorRules: exact chances that sum to 1, samples drawn by the real generator, problems reported', () => {
    const preview = previewConnectorRules(defaultConnectorRules('TANK'), 1, 1, 'TANK', 4, 'p');
    expect(preview.problem).toBeNull();
    expect(preview.combos).toHaveLength(3); // all-central / all-split / all-universal
    expect(preview.combos.reduce((sum, c) => sum + c.probability, 0)).toBeCloseTo(1, 10);
    for (const entry of preview.combos) expect(entry.probability).toBeCloseTo(1 / 3, 10);
    expect(preview.samples).toHaveLength(4);

    const engineBad = previewConnectorRules(
      { sides: { N: fixed('central'), E: fixed('central'), S: fixed('central'), W: fixed('central') } },
      1, 1, 'ENGINE', 3, 'p',
    );
    expect(engineBad.problem).toMatch(/W side/);
    expect(engineBad.samples).toEqual([]);
    expect(previewConnectorRules({ nope: true }, 1, 1, 'TANK', 3, 'p').problem).toMatch(/shape/);
  });

  it('a side can be "no port" with a chance, but at least one side always has a port (default min 1)', () => {
    const maybe = kinds([
      ['none', 1],
      ['central', 3],
    ]);
    const rules: ConnectorRules = { sides: { N: maybe, E: maybe, S: maybe, W: maybe } };
    const combos = enumerateCombos(rules);
    expect(combos.some(({ combo }) => Object.values(combo).every((k) => k === 'none'))).toBe(false);
    expect(combos.some(({ combo }) => Object.values(combo).includes('none'))).toBe(true);
    expect(combos.reduce((sum, c) => sum + c.weight, 0)).toBeGreaterThan(0);
    // every roll has >= 1 port, and some rolls leave a side bare
    let bare = 0;
    for (let i = 0; i < 400; i += 1) {
      const layout = generateConnectors(rules, 1, 1, `m-${i}`)!;
      expect(layout.cells.length).toBeGreaterThanOrEqual(1);
      if (layout.cells.length < 4) bare += 1;
    }
    expect(bare).toBeGreaterThan(100);
  });

  it('minConnected raises the floor, and rules that cannot meet it are rejected', () => {
    const maybe = kinds([
      ['none', 1],
      ['central', 1],
    ]);
    const base: ConnectorRules = { sides: { N: maybe, E: maybe, S: maybe, W: maybe }, minConnected: 3 };
    for (const { combo } of enumerateCombos(base)) {
      expect(Object.values(combo).filter((k) => k !== 'none').length).toBeGreaterThanOrEqual(3);
    }
    const impossible: ConnectorRules = {
      sides: { N: fixed('none'), E: fixed('none'), S: maybe, W: maybe },
      minConnected: 3,
    };
    expect(validateConnectorRules(impossible)).toMatch(/no side combination/);
  });
});
