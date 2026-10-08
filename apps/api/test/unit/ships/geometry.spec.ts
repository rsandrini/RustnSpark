import { describe, expect, it } from '@jest/globals';
import { cellKey, connectedPartIds, validateLayout } from '../../../src/ships/geometry.js';
import { directionErrors } from '../../../src/ships/direction.js';
import type { ConnectorLayout } from '../../../src/parts/connectors.js';
import type { PartCatalog, Placement } from '../../../src/parts/part.types.js';

describe('validateLayout', () => {
  const catalog: ReadonlyMap<string, PartCatalog> = new Map([
    [
      'bridge',
      {
        partType: 'bridge',
        partClass: 'BRIDGE',
        w: 1,
        h: 1,
        mass: 0,
        structureCost: 0,
        partHp: 0,
        basePrice: 0,
        pot: 0,
        pdf: 0,
        bli: 0,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        energyCont: 0,
        energyCombat: 0,
        fuelCap: 0,
        fuelUse: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
        pressurized: false,
        lifeSupport: false,
      },
    ],
    [
      'hull',
      {
        partType: 'hull',
        partClass: 'DEFENSE',
        w: 2,
        h: 1,
        mass: 0,
        structureCost: 0,
        partHp: 0,
        basePrice: 0,
        pot: 0,
        pdf: 0,
        bli: 0,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        energyCont: 0,
        energyCombat: 0,
        fuelCap: 0,
        fuelUse: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
        pressurized: false,
        lifeSupport: false,
      },
    ],
  ]);

  // Reproduces the exact old GRID_HALF_SIZE=10 bound every one of these 6 tests was written
  // against — in particular "rejects parts placed out of bounds" needs x=15/16 to actually be
  // outside this set, so a wider square (e.g. [-20,20)) would silently make that test's
  // placements fit and break the assertion. None of the other 5 tests need anything beyond
  // +/-10 either.
  function wideSquareCells(): Set<string> {
    const cells = new Set<string>();
    for (let y = -10; y < 10; y += 1) {
      for (let x = -10; x < 10; x += 1) {
        cells.add(cellKey(x, y));
      }
    }
    return cells;
  }
  const cells = wideSquareCells();
  const noConnectors = new Map<string, ConnectorLayout | null>();

  it('accepts a valid connected layout', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 1, gy: 0, rot: 0 },
    ];
    expect(validateLayout(placements, catalog, cells, noConnectors)).toEqual([]);
  });

  it('rejects overlapping parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells, noConnectors);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });

  it('accepts distant parts (no more DISCONNECTED)', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 5, gy: 5, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells, noConnectors);
    expect(errors).toEqual([]);
  });

  it('rejects parts placed out of bounds', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 15, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 16, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells, noConnectors);
    expect(errors.map((e) => e.code)).toContain('OUT_OF_BOUNDS');
  });

  it('supports 90-degree rotation swapping dimensions', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: -2, rot: 90 },
    ];
    expect(validateLayout(placements, catalog, cells, noConnectors)).toEqual([]);
  });

  it('detects overlap caused by rotation', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 90 },
    ];
    const errors = validateLayout(placements, catalog, cells, noConnectors);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });
});

describe('validateLayout — format cell bounds', () => {
  const bridgeOnly: ReadonlyMap<string, PartCatalog> = new Map([
    [
      'p-bridge',
      {
        partType: 'bridge',
        partClass: 'BRIDGE',
        w: 1,
        h: 1,
        mass: 1,
        structureCost: 10,
        partHp: 10,
        basePrice: 0,
        pot: 0,
        pdf: 0,
        bli: 0,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        energyCont: 0,
        energyCombat: 0,
        fuelCap: 0,
        fuelUse: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
        pressurized: false,
        lifeSupport: false,
      },
    ],
  ]);
  // A small cross: (0,0) is the bridge's own cell, plus the four neighbors.
  const CROSS_CELLS = new Set(['0,0', '1,0', '-1,0', '0,1', '0,-1']);
  const noConnectors = new Map<string, ConnectorLayout | null>();

  it('accepts a part inside the format shape', () => {
    const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 }];
    expect(validateLayout(placements, bridgeOnly, CROSS_CELLS, noConnectors)).toEqual([]);
  });

  it('rejects a cell outside the format shape, even though it would fit a plain square', () => {
    // (1,1) is inside a 20x20 square but NOT one of the cross's cells.
    const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx: 1, gy: 1, rot: 0 }];
    const errors = validateLayout(placements, bridgeOnly, CROSS_CELLS, noConnectors);
    expect(errors).toEqual([
      { code: 'OUT_OF_BOUNDS', partInstanceId: 'p-bridge', message: expect.any(String) },
    ]);
  });

  it('accepts every arm of the cross', () => {
    for (const [gx, gy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx, gy, rot: 0 }];
      expect(validateLayout(placements, bridgeOnly, CROSS_CELLS, noConnectors)).toEqual([]);
    }
  });
});

describe('connectedPartIds', () => {
  // 1x1 bridge at (0,0), 1x1 "pod" at (1,0) — adjacent cells sharing the edge between
  // bridge's E side and pod's W side.
  const POD: PartCatalog = {
    partType: 'pod',
    partClass: 'UTILITY',
    w: 1,
    h: 1,
    mass: 0,
    structureCost: 0,
    partHp: 0,
    basePrice: 0,
    pot: 0,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
    fuelCap: 0,
    fuelUse: 0,
    batCharge: 0,
    batOutput: 0,
    batInput: 0,
    pressurized: false,
    lifeSupport: false,
  };
  const BRIDGE: PartCatalog = { ...POD, partType: 'bridge', partClass: 'BRIDGE' };
  const twoPartCatalog = new Map([
    ['p-bridge', BRIDGE],
    ['p-pod', POD],
  ]);
  const placements: Placement[] = [
    { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
    { partInstanceId: 'p-pod', gx: 1, gy: 0, rot: 0 },
  ];

  it('connects two parts whose facing sides both have a compatible connector', () => {
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'E', kind: 'central' }] }],
      ['p-pod', { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] }],
    ]);
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge', 'p-pod']));
  });

  it('does not connect when one side has no connector at all', () => {
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'E', kind: 'central' }] }],
      ['p-pod', { cells: [] }], // pod's W side explicitly has nothing
    ]);
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge'])); // the bridge is always connected to itself
  });

  it('follows a rotated multi-cell part: the authored cell/side maps to the right world cell', () => {
    // 2x1 "wide" authored left->right, placed rot 90 (clockwise) below the bridge, so it runs
    // top->bottom: authored cell (0,0) is the top world cell, (1,0) the bottom one, and the
    // authored E edge of (1,0) faces world SOUTH. A tank sits below it.
    const WIDE: PartCatalog = { ...POD, partType: 'wide', w: 2, h: 1 };
    const catalog = new Map([
      ['p-bridge', BRIDGE],
      ['p-wide', WIDE],
      ['p-tank', POD],
    ]);
    const layout: Placement[] = [
      { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'p-wide', gx: 0, gy: 1, rot: 90 },
      { partInstanceId: 'p-tank', gx: 0, gy: 3, rot: 0 },
    ];
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] }],
      [
        'p-wide',
        {
          cells: [
            { dx: 0, dy: 0, side: 'W', kind: 'central' }, // -> world N of the top cell
            { dx: 1, dy: 0, side: 'E', kind: 'central' }, // -> world S of the bottom cell
          ],
        },
      ],
      ['p-tank', { cells: [{ dx: 0, dy: 0, side: 'N', kind: 'central' }] }],
    ]);
    expect(connectedPartIds(layout, catalog, connectors)).toEqual(
      new Set(['p-bridge', 'p-wide', 'p-tank']),
    );
  });

  it('does not connect central to split', () => {
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'E', kind: 'central' }] }],
      ['p-pod', { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'split' }] }],
    ]);
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge']));
  });

  it('connects when a part has no entry in the map at all (treated as the universal fallback)', () => {
    const connectors = new Map<string, ConnectorLayout | null>(); // neither part has an entry
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge', 'p-pod']));
  });

  it('respects rotation: a connector on W becomes N after a 90-degree rotation', () => {
    // Pod placed to the SOUTH of the bridge instead of east, rotated 90 so its originally-W
    // connector now faces north (back toward the bridge).
    const rotatedPlacements: Placement[] = [
      { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'p-pod', gx: 0, gy: 1, rot: 90 },
    ];
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] }],
      ['p-pod', { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] }], // rotates to N
    ]);
    const result = connectedPartIds(rotatedPlacements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge', 'p-pod']));
  });
});

describe('validateLayout — no more DISCONNECTED', () => {
  it('saves a layout with a disconnected part instead of rejecting it', () => {
    const catalog = new Map([
      [
        'p-bridge',
        {
          partType: 'bridge',
          partClass: 'BRIDGE',
          w: 1,
          h: 1,
          mass: 0,
          structureCost: 0,
          partHp: 0,
          basePrice: 0,
          pot: 0,
          pdf: 0,
          bli: 0,
          esc: 0,
          sen: 0,
          crg: 0,
          min: 0,
          energyCont: 0,
          energyCombat: 0,
          fuelCap: 0,
          fuelUse: 0,
          batCharge: 0,
          batOutput: 0,
          batInput: 0,
          pressurized: false,
          lifeSupport: false,
        },
      ],
      [
        'p-far',
        {
          partType: 'hull',
          partClass: 'DEFENSE',
          w: 1,
          h: 1,
          mass: 0,
          structureCost: 0,
          partHp: 0,
          basePrice: 0,
          pot: 0,
          pdf: 0,
          bli: 0,
          esc: 0,
          sen: 0,
          crg: 0,
          min: 0,
          energyCont: 0,
          energyCombat: 0,
          fuelCap: 0,
          fuelUse: 0,
          batCharge: 0,
          batOutput: 0,
          batInput: 0,
          pressurized: false,
          lifeSupport: false,
        },
      ],
    ]);
    const wideCells = new Set<string>();
    for (let y = -20; y < 20; y += 1) for (let x = -20; x < 20; x += 1) wideCells.add(`${x},${y}`);
    const placements: Placement[] = [
      { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'p-far', gx: 5, gy: 5, rot: 0 }, // not adjacent to anything
    ];
    const errors = validateLayout(placements, catalog, wideCells, new Map());
    expect(errors).toEqual([]); // no DISCONNECTED, no error at all — it just won't be "connected"
  });
});

describe('cellKey', () => {
  it('matches the key format used to build a format cell set', () => {
    expect(cellKey(3, -2)).toBe('3,-2');
  });
});

describe('direction rules are not part of validateLayout (free placement) but of flight viability', () => {
  const base: PartCatalog = {
    partType: 'x', partClass: 'UTILITY', w: 1, h: 1, mass: 0, structureCost: 0, partHp: 0, basePrice: 0,
    pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0,
    fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false, lifeSupport: false,
  };
  const catalog = new Map<string, PartCatalog>([
    ['e', { ...base, partClass: 'ENGINE' }],
    ['p', base],
  ]);

  it('reports EXHAUST_BLOCKED when a part is behind the engine, and clears it once the engine is turned', () => {
    const behind: Placement[] = [
      { partInstanceId: 'p', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'e', gx: 1, gy: 0, rot: 0 },
    ];
    // saving is never blocked: the geometry check stays clean even with a part behind the engine
    expect(validateLayout(behind, catalog)).toEqual([]);
    expect(directionErrors(behind, catalog).map((e) => e.code)).toEqual(['EXHAUST_BLOCKED']);
    expect(
      directionErrors([behind[0]!, { ...behind[1]!, rot: 180 }], catalog).map((e) => e.code),
    ).toEqual([]);
  });

  it('reports FACING_CONNECTOR for a connector on the facing side but not for a legacy part', () => {
    const layout: Placement[] = [{ partInstanceId: 'e', gx: 0, gy: 0, rot: 0 }];
    const bad = new Map<string, ConnectorLayout | null>([
      ['e', { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] }],
    ]);
    expect(directionErrors(layout, catalog, bad).map((e) => e.code)).toEqual(['FACING_CONNECTOR']);
    expect(directionErrors(layout, catalog, new Map([['e', null]]))).toEqual([]);
  });

  it('treats 180 as a non-swapping rotation for footprints', () => {
    const wide = new Map<string, PartCatalog>([['w', { ...base, w: 2, h: 1 }]]);
    const cells = new Set(['0,0', '1,0']);
    expect(validateLayout([{ partInstanceId: 'w', gx: 0, gy: 0, rot: 180 }], wide, cells)).toEqual([]);
    expect(
      validateLayout([{ partInstanceId: 'w', gx: 0, gy: 0, rot: 90 }], wide, cells).map((e) => e.code),
    ).toEqual(['OUT_OF_BOUNDS']);
  });
});
