import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import type { ConnectorLayout } from '../../../src/parts/connectors.js';
import type { PartCatalog, Placement } from '../../../src/parts/part.types.js';
import { directionErrors, facingSide, withDirectionProblems } from '../../../src/ships/direction.js';

const BASE: PartCatalog = {
  partType: 'x', partClass: 'UTILITY', w: 1, h: 1, mass: 0, structureCost: 0, partHp: 0, basePrice: 0,
  pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0,
  fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false, lifeSupport: false,
};

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../../packages/contract/fixtures/direction-vectors.json', import.meta.url)),
    'utf8',
  ),
) as {
  facingOf: Record<string, string>;
  scenarios: {
    name: string;
    parts: Record<string, { class: string; w: number; h: number }>;
    layout: { id: string; gx: number; gy: number; rot: number }[];
    expected: { id: string; code: string }[];
  }[];
};

describe('direction rules — shared vectors (parity with the web)', () => {
  for (const scenario of vectors.scenarios) {
    it(scenario.name, () => {
      const catalog = new Map(
        Object.entries(scenario.parts).map(([id, p]): [string, PartCatalog] => [
          id,
          { ...BASE, partClass: p.class, w: p.w, h: p.h },
        ]),
      );
      const placements: Placement[] = scenario.layout.map((p) => ({
        partInstanceId: p.id, gx: p.gx, gy: p.gy, rot: p.rot,
      }));
      const found = directionErrors(placements, catalog)
        .map((e) => ({ id: e.partInstanceId!, code: e.code }))
        .sort((a, b) => a.id.localeCompare(b.id) || a.code.localeCompare(b.code));
      expect(found).toEqual(scenario.expected);
    });
  }

  it('facingSide matches the table at all four angles', () => {
    for (const [rot, side] of Object.entries(vectors.facingOf)) expect(facingSide(Number(rot))).toBe(side);
  });
});

describe('facing-side connector rule', () => {
  const catalog = new Map<string, PartCatalog>([['e', { ...BASE, partClass: 'ENGINE', w: 2, h: 1 }]]);
  const at = (rot: number): Placement[] => [{ partInstanceId: 'e', gx: 0, gy: 0, rot }];
  const noneOnW: ConnectorLayout = {
    cells: [
      { dx: 0, dy: 0, side: 'N', kind: 'central' },
      { dx: 1, dy: 0, side: 'E', kind: 'central' },
    ],
  };
  const centralOnW: ConnectorLayout = { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] };

  it('accepts none on the facing side, rejects a connector there, at every rotation', () => {
    for (const rot of [0, 90, 180, 270]) {
      expect(directionErrors(at(rot), catalog, new Map([['e', noneOnW]]))).toEqual([]);
      const codes = directionErrors(at(rot), catalog, new Map([['e', centralOnW]])).map((e) => e.code);
      // authored W connector faces the facing side at every rot: facing = rotate(W, rot)
      expect(codes).toEqual(['FACING_CONNECTOR']);
    }
  });

  it('skips parts with no stored layout (legacy)', () => {
    expect(directionErrors(at(0), catalog, new Map([['e', null]]))).toEqual([]);
    expect(directionErrors(at(0), catalog, new Map([['e', { cells: [] }]]))).toEqual([]);
    expect(directionErrors(at(0), catalog)).toEqual([]);
  });
});

describe('withDirectionProblems', () => {
  const catalog = new Map<string, PartCatalog>([
    ['e', { ...BASE, partClass: 'ENGINE' }],
    ['p', BASE],
    ['f', { ...BASE, partClass: 'ENGINE' }],
  ]);
  const ok = { viable: true, problems: [], warnings: [] };

  it('leaves a clean layout viable and untouched', () => {
    const layout: Placement[] = [
      { partInstanceId: 'p', gx: 2, gy: 0, rot: 0 },
      { partInstanceId: 'e', gx: 1, gy: 0, rot: 0 },
    ];
    expect(withDirectionProblems(ok, layout, catalog, new Map())).toBe(ok);
  });

  it('makes a blocked engine a flight warning, once per code however many engines are blocked', () => {
    const layout: Placement[] = [
      { partInstanceId: 'p', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'e', gx: 1, gy: 0, rot: 0 },
      { partInstanceId: 'f', gx: 1, gy: 1, rot: 0 },
    ];
    const result = withDirectionProblems(ok, layout, catalog, new Map());
    expect(result.viable).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.warnings.map((problem) => problem.code)).toEqual(['EXHAUST_BLOCKED']);
  });

  it('blocks flight on them only when asked to be strict (mining)', () => {
    const layout: Placement[] = [
      { partInstanceId: 'p', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'e', gx: 1, gy: 0, rot: 0 },
    ];
    const result = withDirectionProblems(ok, layout, catalog, new Map(), { strict: true });
    expect(result.viable).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toEqual(['EXHAUST_BLOCKED']);
    expect(result.warnings).toEqual([]);
  });
});
