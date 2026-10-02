import { describe, expect, it } from '@jest/globals';
import { autoLayout } from '../../../src/ships/auto-layout.js';
import { cellKey, validateLayout } from '../../../src/ships/geometry.js';
import { buildInstalled, catalogByInstanceId, CATALOG_BY_TYPE } from './fixtures/catalog.js';

// Reproduces the exact old GRID_HALF_SIZE=10 bound — these tests already relied on that bound
// being reachable by autoLayout's own candidate search; a format is just data now, but the
// shape these tests exercise against is unchanged.
function classicSquareCells(): Set<string> {
  const cells = new Set<string>();
  for (let y = -10; y < 10; y += 1) {
    for (let x = -10; x < 10; x += 1) {
      cells.add(cellKey(x, y));
    }
  }
  return cells;
}
const cells = classicSquareCells();

describe('autoLayout', () => {
  it('places a single part at the origin', () => {
    const parts = buildInstalled(['bridge']);
    const placements = autoLayout(parts, catalogByInstanceId(parts), cells);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ partInstanceId: 'bridge-0', gx: 0, gy: 0, rot: 0 });
  });

  it('produces a valid layout for the starter build', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'cargo',
      'cargo',
      'hull',
    ]);
    const placements = autoLayout(parts, catalogByInstanceId(parts), cells);
    expect(validateLayout(placements, catalogByInstanceId(parts), cells)).toEqual([]);
  });

  it('produces a valid layout for random part subsets', () => {
    const allTypes = Array.from(CATALOG_BY_TYPE.keys()).filter((t) => t !== 'bridge');
    for (let seed = 1; seed <= 20; seed += 1) {
      const subset = allTypes.filter((_, index) => (index + seed) % 3 === 0);
      const parts = buildInstalled(['bridge', ...subset]);
      const placements = autoLayout(parts, catalogByInstanceId(parts), cells);
      expect(validateLayout(placements, catalogByInstanceId(parts), cells)).toEqual([]);
    }
  });
});
