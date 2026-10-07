import { describe, expect, it } from '@jest/globals';
import { autoLayout } from '../../../src/ships/auto-layout.js';
import { defaultConnectorRules, generateConnectors } from '../../../src/parts/connector-rules.js';
import { KIT_KINDS } from '../../../src/parts/connectors.js';
import { connectedPartIds, validateLayout } from '../../../src/ships/geometry.js';
import { buildInstalled, catalogByInstanceId, CATALOG_BY_TYPE } from './fixtures/catalog.js';

describe('autoLayout', () => {
  it('places a single part at the origin', () => {
    const parts = buildInstalled(['bridge']);
    const placements = autoLayout(parts, catalogByInstanceId(parts));
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
    const placements = autoLayout(parts, catalogByInstanceId(parts));
    expect(validateLayout(placements, catalogByInstanceId(parts))).toEqual([]);
  });

  it('produces a valid layout for random part subsets', () => {
    const allTypes = Array.from(CATALOG_BY_TYPE.keys()).filter((t) => t !== 'bridge');
    for (let seed = 1; seed <= 20; seed += 1) {
      const subset = allTypes.filter((_, index) => (index + seed) % 3 === 0);
      const parts = buildInstalled(['bridge', ...subset]);
      const placements = autoLayout(parts, catalogByInstanceId(parts));
      expect(validateLayout(placements, catalogByInstanceId(parts))).toEqual([]);
    }
  });

  it('places every part connected to the bridge when parts carry real connectors (engine exhaust faces away)', () => {
    const rest = ['engine_chem_small', 'tank_small', 'battery_small', 'cargo', 'hull'];
    for (let seed = 0; seed < 25; seed += 1) {
      // vary the placement order too: the engine's neighbours (and so its facing) change with it
      const shift = seed % rest.length;
      const types = ['bridge', ...rest.slice(shift), ...rest.slice(0, shift)];
      const parts = buildInstalled(types).map((part, index) => ({
        ...part,
        instance: {
          ...part.instance,
          connectors: generateConnectors(
            defaultConnectorRules(part.catalog.partClass),
            part.catalog.w,
            part.catalog.h,
            `s${seed}-${index}`,
            KIT_KINDS, // a kit: central/universal only, so every part can join the bridge
          ),
        },
      }));
      const catalog = catalogByInstanceId(parts);
      const placements = autoLayout(parts, catalog);
      expect(placements).toHaveLength(parts.length);
      const connectors = new Map(parts.map((p) => [p.instance.id, p.instance.connectors as never]));
      expect(connectedPartIds(placements, catalog, connectors).size).toBe(parts.length);
    }
  });

  it('places engines and weapons so nothing sits behind their exhaust/muzzle (all four facings available)', () => {
    const rest = ['engine_chem_small', 'tank_small', 'battery_small', 'cargo', 'hull'];
    for (let shift = 0; shift < rest.length; shift += 1) {
      const types = ['bridge', ...rest.slice(shift), ...rest.slice(0, shift)];
      const parts = buildInstalled(types);
      const catalog = catalogByInstanceId(parts);
      const placements = autoLayout(parts, catalog);
      expect(placements).toHaveLength(parts.length);
      expect(validateLayout(placements, catalog).map((e) => e.code)).toEqual([]);
    }
  });
});
