import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { stableUnit } from '../../../src/economy/deterministic.js';
import {
  fieldTypeOf,
  scavengeOutcome,
  type CatalogEntry,
  type DropTier,
  type FieldType,
  type ScavengeRollInput,
} from '../../../src/economy/scavenging.service.js';

const SEED = GAME_CONFIG_DEFAULTS.world.seed;
const TIERS: DropTier[] = [
  { tier: 'COMMON', chance: 0.6 },
  { tier: 'UNCOMMON', chance: 0.3 },
  { tier: 'RARE', chance: 0.1 },
];
const CATALOG: CatalogEntry[] = [
  { partType: 'battery_small', rarity: 'COMMON' },
  { partType: 'hull', rarity: 'COMMON' },
  { partType: 'cargo', rarity: 'COMMON' },
  { partType: 'sensor_probe', rarity: 'UNCOMMON' },
  { partType: 'engine_plasma', rarity: 'RARE' },
];

function input(overrides: Partial<ScavengeRollInput> = {}): ScavengeRollInput {
  return {
    seed: SEED,
    playerId: 'player-1',
    locationId: 'drift',
    attempt: 0,
    fieldType: 'pirate',
    chance: GAME_CONFIG_DEFAULTS.scavenging.chance,
    qualityMin: GAME_CONFIG_DEFAULTS.scavenging.quality_min,
    qualityMax: GAME_CONFIG_DEFAULTS.scavenging.quality_max,
    tiers: TIERS,
    catalog: CATALOG,
    ...overrides,
  };
}

describe('S8.5 — field type (GDD §14 chance by field)', () => {
  it('maps a pirate-held debris field to the 75% tier', () => {
    expect(fieldTypeOf({ type: 'scrap_field', factionId: 'pirates' })).toBe('pirate');
  });

  it('maps everything else (ports, friendly fields) to the 25% tier', () => {
    expect(fieldTypeOf({ type: 'scrap_field', factionId: 'luna' })).toBe('common');
    expect(fieldTypeOf({ type: 'port', factionId: 'luna' })).toBe('common');
    expect(fieldTypeOf({ type: 'dead_zone', factionId: 'pirates' })).toBe('common');
  });

  it('pins the three configured chances (mission tier reserved for missions)', () => {
    expect(GAME_CONFIG_DEFAULTS.scavenging.chance).toEqual({
      common: 0.25,
      mission: 0.55,
      pirate: 0.75,
    });
    expect(GAME_CONFIG_DEFAULTS.scavenging.quality_min).toBe(30);
    expect(GAME_CONFIG_DEFAULTS.scavenging.quality_max).toBe(70);
    expect(GAME_CONFIG_DEFAULTS.scavenging.cooldown_seconds).toBe(300);
  });
});

describe('S8.5 — scavenge outcome (seed-deterministic)', () => {
  it('is deterministic: same seed/player/location/attempt → same loot', () => {
    const a = scavengeOutcome(input());
    const b = scavengeOutcome(input());
    expect(a).toEqual(b);
  });

  it('never drops when the field chance is 0, always drops when it is 1', () => {
    const never: FieldType[] = ['common', 'mission', 'pirate'];
    for (const fieldType of never) {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        expect(scavengeOutcome(input({ fieldType, chance: { [fieldType]: 0 } }))).toEqual({
          dropped: false,
        });
        expect(scavengeOutcome(input({ fieldType, chance: { [fieldType]: 1 } })).dropped).toBe(
          true,
        );
      }
    }
  });

  it('picks parts only from the rolled rarity tier (falling back to COMMON)', () => {
    // Single tier always COMMON → the pick must come from the COMMON pool.
    const commonOnly = scavengeOutcome({
      ...input({ tiers: [{ tier: 'COMMON', chance: 1 }], fieldType: 'common' }),
      chance: { common: 1 },
    });
    expect(commonOnly.dropped).toBe(true);
    expect(['battery_small', 'hull', 'cargo']).toContain(commonOnly.partType);

    // A tier with no active catalog part falls back to COMMON instead of throwing.
    const emptyTier = scavengeOutcome({
      ...input({ tiers: [{ tier: 'EPIC', chance: 1 }] }),
      chance: { pirate: 1 },
    });
    expect(emptyTier.dropped).toBe(true);
    expect(['battery_small', 'hull', 'cargo']).toContain(emptyTier.partType);

    // Empty catalog yields nothing rather than crashing the roll.
    expect(scavengeOutcome(input({ catalog: [], chance: { pirate: 1 } }))).toEqual({
      dropped: false,
    });
  });

  it('always rolls damaged quality inside [quality_min, quality_max]', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const outcome = scavengeOutcome(input({ attempt, chance: { pirate: 1 } }));
      expect(outcome.dropped).toBe(true);
      expect(outcome.condition).toBeGreaterThanOrEqual(30);
      expect(outcome.condition).toBeLessThanOrEqual(70);
    }
  });

  it('applies the field chance as a pure threshold on the same roll', () => {
    // The drop roll does not hash the field type, so a drop on a common (25%)
    // field implies the same roll also drops on the pirate (75%) field — the
    // chance map is the only difference.
    let commonDrops = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const common = scavengeOutcome(input({ attempt, fieldType: 'common' }));
      const pirate = scavengeOutcome(input({ attempt, fieldType: 'pirate' }));
      if (common.dropped) {
        commonDrops += 1;
        expect(pirate.dropped).toBe(true);
      }
    }
    expect(commonDrops).toBeGreaterThan(0);
  });
});

describe('S8.5 — stableUnit', () => {
  it('stays in [0, 1] and is deterministic', () => {
    for (const key of ['a', 'drop:1', 'part:xyz', '']) {
      const value = stableUnit(key);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(stableUnit(key)).toBe(value);
    }
    expect(stableUnit('different')).not.toBe(stableUnit('keys'));
  });
});
