import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  generateCompetitors,
  raceSeconds,
  resolveRace,
} from '../../../src/resolution/race/race.resolver.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('generateCompetitors', () => {
  it('draws 3 to 5 rivals with unique names and speeds around the reference', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const field = generateCompetitors(createRng(`field-${seed}`), rules);
      counts.add(field.length);
      expect(field.length).toBeGreaterThanOrEqual(3);
      expect(field.length).toBeLessThanOrEqual(5);
      expect(new Set(field.map((rival) => rival.name)).size).toBe(field.length);
      for (const rival of field) {
        expect(rival.mobility).toBeGreaterThanOrEqual(rules.race.reference_mob * (1 - rules.race.speed_spread) - 0.01);
        expect(rival.mobility).toBeLessThanOrEqual(rules.race.reference_mob * (1 + rules.race.speed_spread) + 0.01);
      }
    }
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });

  it('is deterministic for a seed', () => {
    expect(generateCompetitors(createRng('s'), rules)).toEqual(generateCompetitors(createRng('s'), rules));
  });
});

describe('resolveRace', () => {
  const field = [
    { id: 'rival-1', name: 'Slow', mobility: 2 },
    { id: 'rival-2', name: 'Mid', mobility: 3 },
    { id: 'rival-3', name: 'Quick', mobility: 4 },
  ];
  const calm = { ...rules, race: { ...rules.race, time_jitter: 0 } };

  it('ranks by speed: a ship faster than everyone wins and takes the biggest share', () => {
    const result = resolveRace({ competitors: field, playerMobility: 6, totalDistance: 800, rules: calm, rng: createRng('r') });
    expect(result.place).toBe(1);
    expect(result.prizeShare).toBe(rules.race.prize_share_1);
    expect(result.standings.map((s) => s.you)).toEqual([true, false, false, false]);
  });

  it('pays 2nd and 3rd less, and nothing from 4th down', () => {
    const at = (mobility: number) =>
      resolveRace({ competitors: field, playerMobility: mobility, totalDistance: 800, rules: calm, rng: createRng('r') });
    expect(at(3.5).place).toBe(2);
    expect(at(3.5).prizeShare).toBe(rules.race.prize_share_2);
    expect(at(2.5).place).toBe(3);
    expect(at(2.5).prizeShare).toBe(rules.race.prize_share_3);
    expect(at(1).place).toBe(4);
    expect(at(1).prizeShare).toBe(0);
  });

  it('a tie goes to the rival, and the result is deterministic', () => {
    const tie = resolveRace({ competitors: field, playerMobility: 4, totalDistance: 800, rules: calm, rng: createRng('r') });
    expect(tie.place).toBe(2);
    const again = resolveRace({ competitors: field, playerMobility: 4, totalDistance: 800, rules, rng: createRng('same') });
    expect(resolveRace({ competitors: field, playerMobility: 4, totalDistance: 800, rules, rng: createRng('same') })).toEqual(again);
  });

  it('uses the same distance / mobility formula as the mission duration', () => {
    expect(raceSeconds(900, 3, rules)).toBe(Math.round((900 / 3) * rules.missions.duration_k));
  });
});
