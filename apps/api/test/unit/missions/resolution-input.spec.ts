import { describe, expect, it } from '@jest/globals';
import { buildResolveInput } from '../../../src/missions/resolution-input.js';
import type { DispatchSnapshot } from '../../../src/missions/dispatch.service.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';

function catalog(overrides: Partial<DispatchSnapshot['parts'][number]['catalog']> = {}) {
  return {
    partType: 'x',
    partClass: 'UTILITY' as const,
    w: 1,
    h: 1,
    mass: 5,
    structureCost: 3,
    partHp: 10,
    basePrice: 100,
    pot: 7,
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
    ...overrides,
  };
}

describe('buildResolveInput', () => {
  it("a disconnected part's functional stats are already zeroed in the resolved sheet (Connectors v0.1, via the dispatch snapshot)", () => {
    const snapshot: DispatchSnapshot = {
      shipId: 'ship-1',
      fuel: 100,
      currentLocationId: 'ceres',
      stance: 'NEUTRAL',
      energyMode: 'FULL',
      parts: [
        {
          id: 'p-bridge',
          partType: 'bridge',
          condition: 100,
          catalog: catalog({ partClass: 'BRIDGE', mass: 10, structureCost: 10, partHp: 20, pot: 0 }),
          connected: true,
        },
        {
          id: 'p-disconnected-engine',
          partType: 'engine',
          condition: 100,
          // pot already zeroed here, exactly as dispatch.service.ts's applyConnectivity call
          // would have left it before storing the snapshot — mass/structureCost/partHp are
          // untouched (structural), pot (functional) is zero. This test asserts
          // buildResolveInput does no further processing of its own: it trusts the snapshot.
          catalog: catalog({ mass: 5, structureCost: 3, partHp: 10, pot: 0 }),
          connected: false,
        },
      ],
      legs: [],
    };
    const input = buildResolveInput({
      missionId: 'm-1',
      missionType: 'DELIVERY',
      seed: 'seed-1',
      snapshot,
      context: {
        isolation: 1,
        factionRelation: 'neutral',
        preset: 'CRUISE',
        missionOwner: null,
        missionForcesFlee: false,
        client: null,
      },
      rules: GAME_CONFIG_DEFAULTS,
    });
    expect(input.snapshot.sheet.pot).toBe(0);
    expect(input.snapshot.sheet.mass).toBe(15); // 10 (bridge) + 5 (disconnected engine, still structural)
  });

  it("a connected part's pot still counts normally (baseline, no regression)", () => {
    const snapshot: DispatchSnapshot = {
      shipId: 'ship-1',
      fuel: 100,
      currentLocationId: 'ceres',
      stance: 'NEUTRAL',
      energyMode: 'FULL',
      parts: [
        {
          id: 'p-bridge',
          partType: 'bridge',
          condition: 100,
          catalog: catalog({ partClass: 'BRIDGE', mass: 10, structureCost: 10, partHp: 20, pot: 0 }),
          connected: true,
        },
        {
          id: 'p-connected-engine',
          partType: 'engine',
          condition: 100,
          catalog: catalog({ mass: 5, structureCost: 3, partHp: 10, pot: 7 }),
          connected: true,
        },
      ],
      legs: [],
    };
    const input = buildResolveInput({
      missionId: 'm-1',
      missionType: 'DELIVERY',
      seed: 'seed-1',
      snapshot,
      context: {
        isolation: 1,
        factionRelation: 'neutral',
        preset: 'CRUISE',
        missionOwner: null,
        missionForcesFlee: false,
        client: null,
      },
      rules: GAME_CONFIG_DEFAULTS,
    });
    expect(input.snapshot.sheet.pot).toBe(7);
  });
});
