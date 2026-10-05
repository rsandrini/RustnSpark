import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  fillMission,
  isMiningEligible,
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

  it('never contracts for more ore than a single stop can possibly yield', () => {
    // One mining stop rolls rules.mining.attempts_per_stop independent attempts, at most
    // one unit each — a contract above that cap is mechanically unfulfillable no matter
    // how good the ship's mining rig is (owner playtest: mining contracts "almost always
    // fail").
    for (let epoch = 0; epoch < 50; epoch += 1) {
      const draft = fill(`gamma|${epoch}|v1`, LOC_GAMMA, [MINING_EXPLORERS]);
      const cargo = draft.cargo as MiningCargo;
      if (cargo.contracted === true) {
        expect(cargo.quantity!).toBeLessThanOrEqual(rules.mining.attempts_per_stop);
      }
    }
  });

  it('caps contracted quantity at an achievable 1-3 units', () => {
    // A starter rig (MIN 1) in open space has a ~14% find chance per attempt, so the
    // expected yield per mission is ~1.4 units. Asking for 5-10 made contracts fail
    // most of the time; the calibrated cap keeps common-rarity contracts winnable
    // while rarer materials still reward upgrading the rig.
    for (let epoch = 0; epoch < 50; epoch += 1) {
      const draft = fill(`gamma|${epoch}|v2`, LOC_GAMMA, [MINING_EXPLORERS]);
      const cargo = draft.cargo as MiningCargo;
      if (cargo.contracted === true) {
        expect(cargo.quantity!).toBeGreaterThanOrEqual(1);
        expect(cargo.quantity!).toBeLessThanOrEqual(3);
      }
    }
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

  describe('D43 start-safe constraint', () => {
    const starter = (seed: string, maxZone: number, origin: FillerLocation = LOC_ALPHA) =>
      fillMission({
        seed,
        origin,
        world: world(),
        rules,
        now: NOW,
        starter: { types: ['DELIVERY'], maxZone },
      });

    it('only ever yields a DELIVERY whose legs all stay inside the allowed zones', () => {
      for (let epoch = 0; epoch < 40; epoch += 1) {
        const draft = starter(`starter|p1|alpha|${epoch}`, 1);
        expect(draft.type).toBe('DELIVERY');
        expect(draft.destinationId).toBe('beta'); // gamma is zone 2
        for (const leg of legsOf(draft)) expect(leg.zone).toBeLessThanOrEqual(1);
      }
    });

    it('is deterministic for the same seed', () => {
      expect(starter('starter|p1|alpha|0', 1)).toEqual(starter('starter|p1|alpha|0', 1));
    });

    it('fails with MissionGenerationError when no route fits the zone limit', () => {
      // beta is zone 1: with maxZone 0 nothing is reachable from alpha (a zone-0 port).
      expect(() => starter('starter|p1|alpha|0', 0)).toThrow(MissionGenerationError);
    });

    it('never asks for a route safer than the port the player already lives in', () => {
      // gamma is zone 2 and beta zone 1: from gamma, even maxZone 0 must allow beta (zone 1 is
      // safer than home), while a hard limit would leave a zone-2 home with no route at all.
      const draft = starter('starter|p1|gamma|0', 0, {
        id: 'gamma',
        type: 'port',
        zone: 2,
        factionId: 'luna',
      });
      expect(draft.type).toBe('DELIVERY');
      for (const leg of legsOf(draft)) expect(leg.zone).toBeLessThanOrEqual(2);
    });

    it('fails when the constraint excludes every eligible template type', () => {
      expect(() =>
        fillMission({
          seed: 'starter|p1|alpha|0',
          origin: LOC_ALPHA,
          world: world(),
          rules,
          now: NOW,
          starter: { types: ['ESCORT'], maxZone: 1 },
        }),
      ).toThrow(MissionGenerationError);
    });

    it('does not change ordinary generation (no constraint, same seed, same result)', () => {
      const plain = fill('alpha|3|v1', LOC_ALPHA);
      expect(plain).toEqual(fill('alpha|3|v1', LOC_ALPHA));
    });
  });
});

// Round-10 owner request: "add independent mining missions at minable locations" — a
// location only counts as minable when an active MINING template would actually be offered
// there, the exact same eligibility a board offer already uses (never a second, drifting
// definition of "minable").
describe('S6.2 — isMiningEligible (round 10, independent mining jobs)', () => {
  it('is eligible where a MINING template already matches the origin', () => {
    expect(isMiningEligible(LOC_GAMMA, [MINING_EXPLORERS])).toBe(true);
  });

  it('is not eligible where no MINING template matches (wrong faction)', () => {
    expect(isMiningEligible(LOC_ALPHA, [MINING_EXPLORERS])).toBe(false);
  });

  it('is not eligible when the only matching template is inactive', () => {
    expect(isMiningEligible(LOC_GAMMA, [{ ...MINING_EXPLORERS, active: false }])).toBe(false);
  });

  it('ignores templates of other types even if they match the origin', () => {
    expect(isMiningEligible(LOC_GAMMA, [{ ...MINING_EXPLORERS, type: 'DELIVERY' }])).toBe(false);
  });
});
