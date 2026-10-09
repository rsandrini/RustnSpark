import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  generateCompetitors,
  raceSeconds,
  raceWindow,
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
  const calm = { ...rules, race: { ...rules.race, time_jitter: 0, form_spread: 0, mishap_chance: 0 } };

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

  it('days differ: with form, luck and trouble on, different seeds give different fields', () => {
    const close = [
      { id: 'rival-1', name: 'A', mobility: 3 },
      { id: 'rival-2', name: 'B', mobility: 3.1 },
      { id: 'rival-3', name: 'C', mobility: 3.2 },
    ];
    const run = (seed: string) =>
      resolveRace({ competitors: close, playerMobility: 3, totalDistance: 800, rules, rng: createRng(seed) });
    const outcomes = new Set(Array.from({ length: 30 }, (_, i) => run(`day-${i}`).standings.map((s) => s.name).join('>')));
    expect(outcomes.size).toBeGreaterThan(5);
  });

  it('rivals sometimes have trouble that costs them time; the player only when its engines failed', () => {
    const noisy = { ...rules, race: { ...rules.race, mishap_chance: 1, time_jitter: 0, form_spread: 0 } };
    const base = resolveRace({ competitors: field, playerMobility: 3, totalDistance: 800, rules: noisy, rng: createRng('t') });
    expect(base.standings.filter((s) => !s.you).every((s) => s.trouble === 'mishap')).toBe(true);
    expect(base.standings.find((s) => s.you)?.trouble).toBeUndefined();
    const pushed = resolveRace({ competitors: field, playerMobility: 3, totalDistance: 800, rules: noisy, rng: createRng('t'), playerMishaps: 2 });
    const you = pushed.standings.find((s) => s.you)!;
    expect(you.trouble).toBe('overheat');
    // every failure costs its share of the time: two failures, twice the penalty
    expect(you.seconds).toBe(Math.round(raceSeconds(800, 3, noisy) * (1 + 2 * noisy.race.mishap_penalty)));
  });

  it('the board window brackets the expected time with a best and a worst day', () => {
    const w = raceWindow({ distance: 800, mobility: 3, rules, form: rules.race.form_spread, canHaveTrouble: true });
    expect(w.expected).toBe(raceSeconds(800, 3, rules));
    expect(w.best).toBeLessThan(w.expected);
    expect(w.worst).toBeGreaterThan(w.expected);
    const sure = raceWindow({ distance: 800, mobility: 3, rules, form: 0, canHaveTrouble: false });
    expect(sure.worst).toBeLessThan(w.worst);
  });

  it('uses the same distance / mobility formula as the mission duration', () => {
    expect(raceSeconds(900, 3, rules)).toBe(Math.round((900 / 3) * rules.missions.duration_k));
  });
});
