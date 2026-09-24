import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  fillMission,
  MissionGenerationError,
  type FillMissionInput,
  type FillerEnvironment,
  type FillerLocation,
  type FillerMaterial,
  type FillerRoute,
  type FillerRouteEnvironment,
  type FillerTemplate,
} from '../../../src/missions/generator/template.filler.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const rules: GameRules = GAME_CONFIG_DEFAULTS;

// Fixture graph: alpha —— beta —— gamma (no direct alpha—gamma edge, so multi-hop
// paths are exercised). alpha is a luna port (delivery+rescue eligible), beta a
// luna outpost (delivery only), gamma an explorers scrap_field (mining only).
const LOC_ALPHA: FillerLocation = { id: 'alpha', type: 'port', zone: 0, factionId: 'luna' };
const LOC_BETA: FillerLocation = { id: 'beta', type: 'outpost', zone: 1, factionId: 'luna' };
const LOC_GAMMA: FillerLocation = {
  id: 'gamma',
  type: 'scrap_field',
  zone: 2,
  factionId: 'explorers',
};

const ROUTE_AB: FillerRoute = {
  id: 'alpha-beta',
  nodeAId: 'alpha',
  nodeBId: 'beta',
  distance: 500,
  danger: 3,
};
const ROUTE_BG: FillerRoute = {
  id: 'beta-gamma',
  nodeAId: 'beta',
  nodeBId: 'gamma',
  distance: 700,
  danger: 6,
};

const ENVELOPES: FillerEnvironment[] = [
  { id: 'open', level: 1, fuelMult: 1 },
  { id: 'debris', level: 2, fuelMult: 1.2 },
];
const ROUTE_ENVIRONMENTS: FillerRouteEnvironment[] = [
  { routeId: 'alpha-beta', environmentId: 'open', order: 0 },
  { routeId: 'beta-gamma', environmentId: 'debris', order: 0 },
];

const DELIVERY_LUNA: FillerTemplate = {
  id: 'delivery_luna',
  type: 'DELIVERY',
  factionId: 'luna',
  active: true,
  requirements: { originFactions: ['luna'] },
};
const RESCUE_LUNA: FillerTemplate = {
  id: 'rescue_luna',
  type: 'RESCUE',
  factionId: 'luna',
  active: true,
  requirements: { originFactions: ['luna'], originTypes: ['port'] },
};
const MINING_EXPLORERS: FillerTemplate = {
  id: 'mining_explorers',
  type: 'MINING',
  factionId: 'explorers',
  active: true,
  requirements: { originFactions: ['explorers'] },
};

const MATERIALS: FillerMaterial[] = [{ id: 'iron' }, { id: 'copper' }];

interface FixtureWorld {
  readonly locations: readonly FillerLocation[];
  readonly routes: readonly FillerRoute[];
  readonly routeEnvironments: readonly FillerRouteEnvironment[];
  readonly environments: readonly FillerEnvironment[];
  readonly templates: readonly FillerTemplate[];
  readonly materials: readonly FillerMaterial[];
}

function world(
  templates: readonly FillerTemplate[] = [DELIVERY_LUNA, RESCUE_LUNA, MINING_EXPLORERS],
): FixtureWorld {
  return {
    locations: [LOC_ALPHA, LOC_BETA, LOC_GAMMA],
    routes: [ROUTE_AB, ROUTE_BG],
    routeEnvironments: ROUTE_ENVIRONMENTS,
    environments: ENVELOPES,
    templates,
    materials: MATERIALS,
  };
}

function fill(
  seed: string,
  origin: FillerLocation,
  templates?: readonly FillerTemplate[],
  now: Date = NOW,
): ReturnType<typeof fillMission> {
  const input: FillMissionInput = { seed, origin, world: world(templates), rules, now };
  return fillMission(input);
}

interface TestLeg {
  readonly routeId?: string;
  readonly distance: number;
  readonly danger: number;
  readonly zone: number;
  readonly env: { readonly id: string; readonly level: number; readonly fuelMult: number };
}

function legsOf(draft: ReturnType<typeof fillMission>): TestLeg[] {
  return draft.legs as unknown as TestLeg[];
}

interface MiningCargo {
  readonly materialId?: string;
  readonly contracted?: boolean;
  readonly quantity?: number;
}

describe('S6.2 — template filler (pure generation)', () => {
  it('is deterministic for the same seed and world', () => {
    const a = fill('alpha|2|v1', LOC_ALPHA);
    const b = fill('alpha|2|v1', LOC_ALPHA);
    expect(a).toEqual(b);
  });

  it('produces different content for different seeds', () => {
    const a = fill('alpha|0|v0', LOC_ALPHA);
    const b = fill('alpha|1|v0', LOC_ALPHA);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('only offers templates whose origin requirements the location satisfies', () => {
    // gamma is explorers/scrap_field: only the mining template is eligible there.
    for (let epoch = 0; epoch < 5; epoch += 1) {
      const draft = fill(`gamma|${epoch}|v0`, LOC_GAMMA);
      expect(draft.type).toBe('MINING');
      expect(draft.templateId).toBe('mining_explorers');
      expect(draft.factionId).toBe('explorers');
    }
    // beta is a luna outpost: delivery fits, rescue requires a port, mining another faction.
    for (let epoch = 0; epoch < 5; epoch += 1) {
      const draft = fill(`beta|${epoch}|v0`, LOC_BETA);
      expect(draft.type).toBe('DELIVERY');
      expect(draft.templateId).toBe('delivery_luna');
    }
  });

  it('excludes inactive templates', () => {
    const activeOnly = [RESCUE_LUNA];
    const draft = fill('alpha|0|v0', LOC_ALPHA, activeOnly);
    expect(draft.templateId).toBe('rescue_luna');

    const inactive = [{ ...RESCUE_LUNA, active: false }];
    expect(() => fill('alpha|0|v0', LOC_ALPHA, inactive)).toThrow(MissionGenerationError);
  });

  it('builds a connected leg chain from origin to destination and leaves non-rescue deadlines unset', () => {
    const draft = fill('alpha|0|v0', LOC_ALPHA, [DELIVERY_LUNA]);
    const legs = legsOf(draft);
    expect(legs.length).toBeGreaterThanOrEqual(1);
    expect(draft.deadlineAt).toBeNull();
    expect(draft.originId).toBe('alpha');
    expect(draft.destinationId).not.toBe('alpha');
    for (const leg of legs) {
      expect(leg.distance).toBeGreaterThan(0);
      expect(leg.env.level).toBeGreaterThanOrEqual(1);
      // S7.2 dispatch writes RoutePresence rows keyed by the generating route.
      expect(typeof leg.routeId).toBe('string');
      expect(leg.routeId).not.toBe('');
    }
    // Fixture edges only ever carry these distances.
    for (const leg of legs) {
      expect([ROUTE_AB.distance, ROUTE_BG.distance]).toContain(leg.distance);
    }
  });

  it('gives rescue missions an out-and-back leg plan and a deadline inside the Appendix E window', () => {
    const draft = fill('alpha|9|v0', LOC_ALPHA, [RESCUE_LUNA]);
    expect(draft.type).toBe('RESCUE');
    const legs = legsOf(draft);
    expect(legs.length % 2).toBe(0);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    const half = legs.length / 2;
    const outbound = legs.slice(0, half);
    const returning = legs.slice(half);
    expect(returning).toEqual([...outbound].reverse());

    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const roundTripSeconds =
      (totalDistance / rules.rescue.reference_mob) * rules.missions.duration_k;
    const minMs = roundTripSeconds * rules.rescue.deadline_factor_min * 1000;
    const maxMs = roundTripSeconds * rules.rescue.deadline_factor_max * 1000;
    expect(draft.deadlineAt).not.toBeNull();
    const budgetMs = new Date(draft.deadlineAt!).getTime() - NOW.getTime();
    // ±2ms slack for the integer-ms rounding of the stored timestamp.
    expect(budgetMs).toBeGreaterThanOrEqual(minMs - 2);
    expect(budgetMs).toBeLessThanOrEqual(maxMs + 2);
  });

  it('names a material on every mining mission and a quantity whenever it is contracted', () => {
    const materialIds = MATERIALS.map((m) => m.id);
    const contracts: boolean[] = [];
    for (let epoch = 0; epoch < 20; epoch += 1) {
      const draft = fill(`gamma|${epoch}|v0`, LOC_GAMMA, [MINING_EXPLORERS]);
      const cargo = draft.cargo as MiningCargo;
      expect(materialIds).toContain(cargo.materialId);
      expect(typeof cargo.contracted).toBe('boolean');
      if (cargo.contracted === true) {
        expect(Number.isInteger(cargo.quantity)).toBe(true);
        expect(cargo.quantity!).toBeGreaterThanOrEqual(1);
      }
      contracts.push(cargo.contracted === true);
    }
    // Both modes must actually occur across the deterministic seed range.
    expect(contracts.some((c) => c)).toBe(true);
    expect(contracts.some((c) => !c)).toBe(true);
  });

  it('sets board expiry inside the prototype window (6–40 minutes)', () => {
    const sixMinutesMs = 6 * 60 * 1000;
    const fortyMinutesMs = 40 * 60 * 1000;
    for (let epoch = 0; epoch < 10; epoch += 1) {
      const draft = fill(`alpha|${epoch}|v0`, LOC_ALPHA);
      const ttlMs = new Date(draft.expiresAt).getTime() - NOW.getTime();
      expect(ttlMs).toBeGreaterThanOrEqual(sixMinutesMs);
      expect(ttlMs).toBeLessThan(fortyMinutesMs);
    }
  });

  it('returns a ready-to-insert AVAILABLE draft with a positive integer reward', () => {
    const draft = fill('alpha|0|v0', LOC_ALPHA);
    expect(draft.status).toBe('AVAILABLE');
    expect(draft.version).toBe(0);
    expect(draft.playerId).toBeNull();
    expect(draft.shipId).toBeNull();
    expect(draft.acceptedAt).toBeNull();
    expect(draft.arrivalAt).toBeNull();
    expect(draft.seed).toBe('alpha|0|v0');
    expect(Number.isInteger(draft.reward)).toBe(true);
    expect(draft.reward).toBeGreaterThan(0);
  });

  it('throws MissionGenerationError when no template is eligible', () => {
    // A luna-only fixture board read at an explorers location: no eligible template.
    expect(() => fill('gamma|0|v0', LOC_GAMMA, [DELIVERY_LUNA])).toThrow(MissionGenerationError);
  });
});
