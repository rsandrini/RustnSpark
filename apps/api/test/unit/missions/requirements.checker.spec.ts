import { describe, expect, it } from '@jest/globals';
import type { MissionType } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { checkMissionRequirements } from '../../../src/missions/requirements.checker.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import { buildInstalled } from '../ships/fixtures/catalog.js';

const rules = GAME_CONFIG_DEFAULTS;

function check(
  missionType: MissionType,
  parts: ReturnType<typeof buildInstalled>,
  requirements?: unknown,
): {
  eligible: boolean;
  reasons: { code: string }[];
  checklist: { code: string; message: string; met: boolean }[];
} {
  const sheet = deriveSheet(parts, rules);
  return checkMissionRequirements({ missionType, requirements, sheet, parts: parts }, rules);
}

function codes(result: { reasons: { code: string }[] }): string[] {
  return result.reasons.map((reason) => reason.code);
}

// Starter kit (game-config onboarding.starter_parts): crg 10, min 0, pdf 0, mob 2,
// no pressurized/life-support flags anywhere.
const STARTER = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'battery_small',
  'cargo',
  'cargo',
  'hull',
];

// No cargo capacity at all.
const NO_CARGO = ['bridge', 'engine_chem_small', 'tank_small', 'battery_small', 'hull'];

// Mining rig but zero cargo capacity.
const MINER_NO_CARGO = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'battery_small',
  'mining_rig',
  'hull',
];

// Armed and reasonably mobile: pdf 3, mob >= 2.
const ARMED_MOBILE = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'weapon_ballistic',
  'cargo',
  'hull',
];

// Armed but overloaded: mobility collapses to 1 (below the escort minimum).
const ARMED_SLOW = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'battery_small',
  'weapon_ballistic',
  'cargo',
  'hull',
  'hull',
  'hull',
  'hull',
  'hull',
  'hull',
];

// Twin ion + solar: very light and fast (mob 4 >= reference_mob 3), no cargo.
const FAST_NO_CARGO = ['bridge', 'engine_ion_micro', 'engine_ion_micro', 'reactor_solar', 'hull'];

// Large chem engine keeps mob at 3 (>= reference_mob) with one cargo hold aboard.
const RESCUE_OK = ['bridge', 'engine_chem_large', 'tank_small', 'battery_small', 'cargo', 'hull'];

// Eight cargo holds: crg 40 (structure 53 <= 100).
const DEEP_CARGO = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'battery_small',
  'cargo',
  'cargo',
  'cargo',
  'cargo',
  'cargo',
  'cargo',
  'cargo',
  'cargo',
  'hull',
];

// Stamps cabin flags on the hull, which every fixture build here includes.
function withCabinFlags(
  partTypes: readonly string[],
  flags: { pressurized?: boolean; lifeSupport?: boolean },
): ReturnType<typeof buildInstalled> {
  return buildInstalled(partTypes).map((part) => {
    if (part.catalog.partType === 'hull') {
      return {
        ...part,
        catalog: {
          ...part.catalog,
          pressurized: flags.pressurized === true,
          lifeSupport: flags.lifeSupport === true,
        },
      };
    }
    return part;
  });
}

describe('S6.3 — mission requirement checker (GDD §12 pass/fail table)', () => {
  it('passes DELIVERY for a ship with any cargo capacity', () => {
    const result = check('DELIVERY', buildInstalled(STARTER));
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails DELIVERY with CARGO_TYPE when cargo capacity is insufficient', () => {
    expect(codes(check('DELIVERY', buildInstalled(NO_CARGO)))).toEqual(['CARGO_TYPE']);
    expect(codes(check('DELIVERY', buildInstalled(STARTER), { cargo: 40 }))).toEqual([
      'CARGO_TYPE',
    ]);
  });

  it('passes DELIVERY when a template demands 40 cargo and the ship carries it', () => {
    expect(check('DELIVERY', buildInstalled(DEEP_CARGO), { cargo: 40 }).eligible).toBe(true);
  });

  it('passes TRANSPORT only with pressurized AND life support', () => {
    const full = withCabinFlags(STARTER, { pressurized: true, lifeSupport: true });
    expect(check('TRANSPORT', full).eligible).toBe(true);

    const pressurizedOnly = withCabinFlags(STARTER, { pressurized: true });
    expect(codes(check('TRANSPORT', pressurizedOnly))).toEqual(['PRESSURIZED_LIFE_SUPPORT']);

    const lifeSupportOnly = withCabinFlags(STARTER, { lifeSupport: true });
    expect(codes(check('TRANSPORT', lifeSupportOnly))).toEqual(['PRESSURIZED_LIFE_SUPPORT']);

    expect(codes(check('TRANSPORT', buildInstalled(STARTER)))).toEqual([
      'PRESSURIZED_LIFE_SUPPORT',
    ]);
  });

  it('passes ESCORT with weapons and mobility, failing each dimension separately', () => {
    expect(check('ESCORT', buildInstalled(ARMED_MOBILE)).eligible).toBe(true);

    // No weapons (starter has pdf 0) but mobility is fine.
    expect(codes(check('ESCORT', buildInstalled(STARTER)))).toEqual(['WEAPONS']);

    // Armed but too slow.
    expect(codes(check('ESCORT', buildInstalled(ARMED_SLOW)))).toEqual(['MIN_MOBILITY']);
  });

  it('passes MINING with a rig and cargo, failing miner and cargo separately', () => {
    const good = buildInstalled([
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'mining_rig',
      'cargo',
      'hull',
    ]);
    expect(check('MINING', good).eligible).toBe(true);

    expect(codes(check('MINING', buildInstalled(STARTER)))).toEqual(['MINER']);
    expect(codes(check('MINING', buildInstalled(MINER_NO_CARGO)))).toEqual(['CARGO_TYPE']);
  });

  it('passes RESCUE when the ship has cargo space and meets rescue.reference_mob', () => {
    expect(check('RESCUE', buildInstalled(RESCUE_OK)).eligible).toBe(true);
  });

  it('fails RESCUE with SPEED when mobility is below reference_mob despite cargo space', () => {
    // Starter carries cargo (space ok) but mob 2 < reference_mob 3.
    expect(codes(check('RESCUE', buildInstalled(STARTER)))).toEqual(['SPEED']);
  });

  it('passes RESCUE via pressurized cabin space when cargo is zero', () => {
    const cabin = withCabinFlags(FAST_NO_CARGO, { pressurized: true, lifeSupport: true });
    expect(check('RESCUE', cabin).eligible).toBe(true);
  });

  it('fails RESCUE with CARGO_TYPE when the ship has neither cargo nor a cabin', () => {
    expect(codes(check('RESCUE', buildInstalled(FAST_NO_CARGO)))).toEqual(['CARGO_TYPE']);
  });

  it('fails RESCUE with SPEED when mobility is below the gate', () => {
    // Heavy ship, cargo present, mobility 1.
    const heavySlow = [
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'cargo',
      'hull',
      'hull',
      'hull',
      'hull',
      'hull',
      'hull',
    ];
    expect(codes(check('RESCUE', buildInstalled(heavySlow)))).toEqual(['SPEED']);
  });

  it('reports eligible true exactly when reasons is empty, across all five types', () => {
    const types: MissionType[] = ['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE'];
    const builds = [STARTER, NO_CARGO, MINER_NO_CARGO, ARMED_MOBILE, ARMED_SLOW, FAST_NO_CARGO];
    for (const type of types) {
      for (const build of builds) {
        const result = check(type, buildInstalled(build));
        expect(result.eligible).toBe(result.reasons.length === 0);
      }
    }
  });

  it('ignores placement-filter keys mixed into the requirements JSON', () => {
    const mixed = { originFactions: ['luna'], originTypes: ['port'], cargo: 40 };
    expect(codes(check('DELIVERY', buildInstalled(STARTER), mixed))).toEqual(['CARGO_TYPE']);
    expect(
      check('DELIVERY', buildInstalled(DEEP_CARGO), {
        originFactions: ['luna'],
        originTypes: ['port'],
      }).eligible,
    ).toBe(true);
  });

  it('uses stable reason codes only (no free-text codes)', () => {
    const allowed = new Set([
      'CARGO_TYPE',
      'PRESSURIZED_LIFE_SUPPORT',
      'WEAPONS',
      'MIN_MOBILITY',
      'MINER',
      'SPEED',
    ]);
    const types: MissionType[] = ['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE'];
    for (const type of types) {
      for (const build of [STARTER, NO_CARGO, MINER_NO_CARGO, ARMED_SLOW, FAST_NO_CARGO]) {
        for (const code of codes(check(type, buildInstalled(build)))) {
          expect(allowed.has(code)).toBe(true);
        }
      }
    }
  });

  it('lets a template override the speed threshold (velocidade hint)', () => {
    // Starter mob is 2; rescue default gate is reference_mob (3). With speed: 2 it passes.
    expect(check('RESCUE', buildInstalled(STARTER), { speed: 2 }).eligible).toBe(true);
    expect(codes(check('RESCUE', buildInstalled(STARTER)))).toEqual(['SPEED']);
  });

  it('gives the starter kit exactly one eligible mission type: DELIVERY', () => {
    const types: MissionType[] = ['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE'];
    const eligible = types.filter((type) => check(type, buildInstalled(STARTER)).eligible);
    expect(eligible).toEqual(['DELIVERY']);
  });
});

// Round-10 owner request: "show the requirements for the mission, in a clear way, not only
// the text" — the board/accept flow only ever saw `reasons` (failures only), so a player who
// was ELIGIBLE never saw what the mission actually demanded. `checklist` is the same checks,
// always returned with a `met` flag, so the UI can render a full requirement list either way.
describe('S6.3 — full requirement checklist (met and unmet), round 10', () => {
  it('DELIVERY checklist reports cargo met or unmet, never omitted on success', () => {
    const ok = check('DELIVERY', buildInstalled(STARTER));
    expect(ok.checklist).toEqual([{ code: 'CARGO_TYPE', message: expect.any(String), met: true }]);

    const bad = check('DELIVERY', buildInstalled(NO_CARGO));
    expect(bad.checklist).toEqual([
      { code: 'CARGO_TYPE', message: expect.any(String), met: false },
    ]);
  });

  it('ESCORT checklist lists weapons and mobility as two independent entries', () => {
    const result = check('ESCORT', buildInstalled(STARTER));
    expect(result.checklist).toEqual([
      { code: 'WEAPONS', message: expect.any(String), met: false },
      { code: 'MIN_MOBILITY', message: expect.any(String), met: true },
    ]);
  });

  it('TRAVEL/SCAVENGE have nothing to check: an empty checklist, not a hidden one', () => {
    expect(check('TRAVEL', buildInstalled(STARTER)).checklist).toEqual([]);
    expect(check('SCAVENGE', buildInstalled(STARTER)).checklist).toEqual([]);
  });

  it('checklist and reasons always agree on exactly what is unmet', () => {
    const types: MissionType[] = ['DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE'];
    for (const type of types) {
      for (const build of [STARTER, NO_CARGO, MINER_NO_CARGO, ARMED_SLOW, FAST_NO_CARGO]) {
        const result = check(type, buildInstalled(build));
        const unmetCodes = result.checklist.filter((entry) => !entry.met).map((e) => e.code);
        expect(unmetCodes).toEqual(codes(result));
      }
    }
  });

  it('RACE needs the entry mobility: the starter ship (mob 2) is below the 2.5 default, a fast one is in', () => {
    expect(codes(check('RACE', buildInstalled(STARTER)))).toEqual(['RACE_SPEED']);
    expect(check('RACE', buildInstalled(RESCUE_OK)).eligible).toBe(true);
    // a template can raise (or lower) its own entry minimum
    expect(check('RACE', buildInstalled(RESCUE_OK), { minMobility: 99 }).eligible).toBe(false);
    expect(check('RACE', buildInstalled(STARTER), { minMobility: 1 }).eligible).toBe(true);
  });
});
