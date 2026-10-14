import { describe, expect, it } from '@jest/globals';
import { autoLayout } from '../../../src/ships/auto-layout.js';
import { defaultConnectorRules, generateConnectors } from '../../../src/parts/connector-rules.js';
import { KIT_KINDS, type ConnectorLayout } from '../../../src/parts/connectors.js';
import { connectedPartIds, incorrectPortPartIds, validateLayout } from '../../../src/ships/geometry.js';
import { buildInstalled, catalogByInstanceId, CATALOG_BY_TYPE } from './fixtures/catalog.js';

describe('autoLayout', () => {
  /** A part type's admin-authored rules with no kit restriction — the sparse, typed layouts the
      market hands out. The inverse of KIT_KINDS below: whole sides carry no port at all, so a
      neighbour parked on one puts a port against a blank wall (PORT_INCORRECT). */
  const rolled = (types: readonly string[], seed: string) =>
    buildInstalled(types).map((part, index) => ({
      ...part,
      instance: {
        ...part.instance,
        connectors: generateConnectors(
          defaultConnectorRules(part.catalog.partClass),
          part.catalog.w,
          part.catalog.h,
          `${seed}-${index}`,
        ),
      },
    }));

  const connectorsOf = (parts: readonly { instance: { id: string; connectors?: unknown } }[]) =>
    new Map<string, ConnectorLayout | null>(
      parts.map((p) => [p.instance.id, p.instance.connectors as ConnectorLayout | null]),
    );

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
            KIT_KINDS, // a kit: central/universal only, every side ported: every part can join
            true,
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

  it('never leaves a red port or a disconnected part for rolled (non-kit) connectors', () => {
    const types = [
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'cargo',
      'hull',
      'mining_rig',
    ];
    for (let seed = 0; seed < 50; seed += 1) {
      const parts = rolled(types, `rolled-${seed}`);
      const catalog = catalogByInstanceId(parts);
      const connectors = connectorsOf(parts);
      const placements = autoLayout(parts, catalog);

      expect(validateLayout(placements, catalog)).toEqual([]);
      expect(incorrectPortPartIds(placements, catalog, connectors).size).toBe(0);
      expect(connectedPartIds(placements, catalog, connectors).size).toBe(placements.length);
      // Every ship has a bridge, and the retry loop always reaches at least one neighbour.
      expect(placements.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('fits the starter kit plus two rolled market parts as one connected ship', () => {
    // What a fresh pilot actually assembles: the five onboarding kit parts (KIT_KINDS, every
    // side ported) plus the two parts bought off the market, whose rolled layouts are not.
    const kitTypes = ['bridge', 'engine_chem_small', 'tank_small', 'cargo', 'hull'];
    for (let seed = 0; seed < 25; seed += 1) {
      const kit = buildInstalled(kitTypes).map((part, index) => ({
        ...part,
        instance: {
          ...part.instance,
          connectors: generateConnectors(
            defaultConnectorRules(part.catalog.partClass),
            part.catalog.w,
            part.catalog.h,
            `kit-${seed}-${index}`,
            KIT_KINDS,
            true,
          ),
        },
      }));
      const parts = [...kit, ...rolled(['mining_rig', 'reactor_solar'], `market-${seed}`)];
      const catalog = catalogByInstanceId(parts);
      const connectors = connectorsOf(parts);
      const placements = autoLayout(parts, catalog);

      expect(placements).toHaveLength(parts.length);
      expect(validateLayout(placements, catalog)).toEqual([]);
      expect(incorrectPortPartIds(placements, catalog, connectors).size).toBe(0);
      expect(connectedPartIds(placements, catalog, connectors).size).toBe(parts.length);
    }
  });
});
