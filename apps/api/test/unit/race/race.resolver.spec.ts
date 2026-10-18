import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  fieldFor,
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
        expect(rival.mobility).toBeGreaterThanOrEqual(
          rules.race.reference_mob * (1 - rules.race.speed_spread) - 0.01,
        );
        expect(rival.mobility).toBeLessThanOrEqual(
          rules.race.reference_mob * (1 + rules.race.speed_spread) + 0.01,
        );
      }
    }
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });

  it('is deterministic for a seed', () => {
    expect(generateCompetitors(createRng('s'), rules)).toEqual(
      generateCompetitors(createRng('s'), rules),
    );
  });
});

describe('resolveRace', () => {
  const field = [
    { id: 'rival-1', name: 'Slow', mobility: 2 },
    { id: 'rival-2', name: 'Mid', mobility: 3 },
    { id: 'rival-3', name: 'Quick', mobility: 4 },
  ];
  const calm = {
    ...rules,
    race: { ...rules.race, time_jitter: 0, mishap_chance: 0, field_follow: 0 },
  };

  it('ranks by speed: a ship faster than everyone wins and takes the biggest share', () => {
    const result = resolveRace({
      competitors: field,
      playerMobility: 6,
      legDistances: [800],
      rules: calm,
      rng: createRng('r'),
    });
    expect(result.place).toBe(1);
    expect(result.prizeShare).toBe(rules.race.prize_share_1);
    expect(result.standings.map((s) => s.you)).toEqual([true, false, false, false]);
  });

  it('pays 2nd and 3rd less, and nothing from 4th down', () => {
    const at = (mobility: number) =>
      resolveRace({
        competitors: field,
        playerMobility: mobility,
        legDistances: [800],
        rules: calm,
        rng: createRng('r'),
      });
    expect(at(3.5).place).toBe(2);
    expect(at(3.5).prizeShare).toBe(rules.race.prize_share_2);
    expect(at(2.5).place).toBe(3);
    expect(at(2.5).prizeShare).toBe(rules.race.prize_share_3);
    expect(at(1).place).toBe(4);
    expect(at(1).prizeShare).toBe(0);
  });

  it('a tie goes to the rival, and the result is deterministic', () => {
    const tie = resolveRace({
      competitors: field,
      playerMobility: 4,
      legDistances: [800],
      rules: calm,
      rng: createRng('r'),
    });
    expect(tie.place).toBe(2);
    const again = resolveRace({
      competitors: field,
      playerMobility: 4,
      legDistances: [800],
      rules,
      rng: createRng('same'),
    });
    expect(
      resolveRace({
        competitors: field,
        playerMobility: 4,
        legDistances: [800],
        rules,
        rng: createRng('same'),
      }),
    ).toEqual(again);
  });

  it('days differ: with luck and trouble on, different seeds give different fields', () => {
    const close = [
      { id: 'rival-1', name: 'A', mobility: 3 },
      { id: 'rival-2', name: 'B', mobility: 3.1 },
      { id: 'rival-3', name: 'C', mobility: 3.2 },
    ];
    const run = (seed: string) =>
      resolveRace({
        competitors: close,
        playerMobility: 3,
        legDistances: [800],
        rules,
        rng: createRng(seed),
      });
    const outcomes = new Set(
      Array.from({ length: 30 }, (_, i) =>
        run(`day-${i}`)
          .standings.map((s) => s.name)
          .join('>'),
      ),
    );
    expect(outcomes.size).toBeGreaterThan(5);
  });

  it('every ship rolls the same trouble chance, the player included; real push failures add on their leg', () => {
    const noisy = {
      ...rules,
      race: { ...rules.race, mishap_chance: 1, time_jitter: 0 },
    };
    const base = resolveRace({
      competitors: field,
      playerMobility: 3,
      legDistances: [800],
      rules: noisy,
      rng: createRng('t'),
    });
    expect(base.standings.every((s) => s.trouble === 'mishap')).toBe(true);
    const pushed = resolveRace({
      competitors: field,
      playerMobility: 3,
      legDistances: [800],
      rules: noisy,
      rng: createRng('t'),
      playerPushLegs: [0, 0],
    });
    const you = pushed.standings.find((s) => s.you)!;
    expect(you.trouble).toBe('overheat');
    // the base failure (chance 1) plus two push failures: three times the penalty on the one leg
    expect(you.seconds).toBe(
      Math.round(raceSeconds(800, 3, noisy) * (1 + 3 * noisy.race.mishap_penalty)),
    );
  });

  it('the board window brackets the expected time with a best and a worst day', () => {
    const w = raceWindow({
      distance: 800,
      mobility: 3,
      rules,
      canHaveTrouble: true,
    });
    expect(w.expected).toBe(raceSeconds(800, 3, rules));
    expect(w.best).toBeLessThan(w.expected);
    expect(w.worst).toBeGreaterThan(w.expected);
    const sure = raceWindow({ distance: 800, mobility: 3, rules, canHaveTrouble: false });
    expect(sure.worst).toBeLessThan(w.worst);
  });

  it('uses the same distance / mobility formula as the mission duration', () => {
    expect(raceSeconds(900, 3, rules)).toBe(Math.round((900 / 3) * rules.missions.duration_k));
  });
});

describe('resolveRace, leg by leg (one rule for every ship)', () => {
  const field = [
    { id: 'rival-1', name: 'Slow', mobility: 2 },
    { id: 'rival-2', name: 'Mid', mobility: 3 },
    { id: 'rival-3', name: 'Quick', mobility: 4 },
  ];
  const calm = {
    ...rules,
    race: { ...rules.race, time_jitter: 0, mishap_chance: 0, field_follow: 0 },
  };
  const legs = [300, 500, 200];

  it('keeps a standing after every leg, and the last one is the final order', () => {
    const result = resolveRace({
      competitors: field,
      playerMobility: 3.5,
      legDistances: legs,
      rules,
      rng: createRng('legs'),
    });
    expect(result.legs).toHaveLength(legs.length);
    for (const leg of result.legs) expect(leg.standings).toHaveLength(field.length + 1);
    const last = result.legs[legs.length - 1]!.standings;
    expect(last.map((row) => row.you)).toEqual(result.standings.map((row) => row.you));
    expect(last.map((row) => row.totalSeconds)).toEqual(result.standings.map((row) => row.seconds));
  });

  it('a ship total is the sum of its leg times', () => {
    const result = resolveRace({
      competitors: field,
      playerMobility: 3.5,
      legDistances: legs,
      rules,
      rng: createRng('sum'),
    });
    const you = result.legs.map((leg) => leg.standings.find((row) => row.you)!);
    expect(you.reduce((sum, row) => sum + row.legSeconds, 0)).toBe(
      you[legs.length - 1]!.totalSeconds,
    );
  });

  it('without luck or trouble the same speed means the same time on every leg (ties go to the rival)', () => {
    const result = resolveRace({
      competitors: [{ id: 'rival-1', name: 'Twin', mobility: 3 }],
      playerMobility: 3,
      legDistances: legs,
      rules: calm,
      rng: createRng('twin'),
    });
    for (const leg of result.legs) {
      const [first, second] = leg.standings;
      expect(first!.totalSeconds).toBe(second!.totalSeconds);
      expect(first!.you).toBe(false);
    }
    expect(result.place).toBe(2);
  });

  it('luck is drawn per leg: equal ships swap places between legs on some seeds', () => {
    const twin = [{ id: 'rival-1', name: 'Twin', mobility: 3 }];
    let swapped = false;
    for (let seed = 0; seed < 60 && !swapped; seed += 1) {
      const result = resolveRace({
        competitors: twin,
        playerMobility: 3,
        legDistances: [300, 300, 300, 300],
        rules: { ...rules, race: { ...rules.race, mishap_chance: 0, field_follow: 0 } },
        rng: createRng(`swap-${seed}`),
      });
      const leaders = result.legs.map((leg) => leg.standings[0]!.you);
      swapped = new Set(leaders).size > 1;
    }
    expect(swapped).toBe(true);
  });

  it('a push failure of the player costs time on the leg it happened on', () => {
    const run = (pushLegs: number[]) =>
      resolveRace({
        competitors: field,
        playerMobility: 3,
        legDistances: legs,
        rules: calm,
        rng: createRng('push'),
        playerPushLegs: pushLegs,
      });
    const clean = run([]).legs.map((leg) => leg.standings.find((row) => row.you)!.legSeconds);
    const hit = run([1]).legs.map((leg) => leg.standings.find((row) => row.you)!.legSeconds);
    expect(hit[0]).toBe(clean[0]);
    expect(hit[2]).toBe(clean[2]);
    expect(hit[1]!).toBeGreaterThan(clean[1]!);
    expect(hit[1]).toBe(Math.round(clean[1]! * (1 + rules.race.mishap_penalty)));
  });

  it('a pushed rival is faster by its level', () => {
    // no push failures here, so the time is exactly the leg formula at the pushed speed
    const steady = { ...calm, engine: { ...calm.engine, mishap_at_max: 0 } };
    const rival = (level: number | undefined) => [
      { id: 'rival-1', name: 'R', mobility: 3, ...(level === undefined ? {} : { level }) },
    ];
    const time = (level: number | undefined) =>
      resolveRace({
        competitors: rival(level),
        playerMobility: 3,
        legDistances: legs,
        rules: steady,
        rng: createRng('lvl'),
      }).standings.find((row) => !row.you)!.seconds;
    expect(time(1.5)).toBeLessThan(time(undefined));
    expect(time(1.5)).toBe(
      Math.round(raceSeconds(300, 4.5, calm)) +
        Math.round(raceSeconds(500, 4.5, calm)) +
        Math.round(raceSeconds(200, 4.5, calm)),
    );
  });

  it('pushed rivals fail more often than steady ones', () => {
    const fails = (level: number): number => {
      let count = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const result = resolveRace({
          competitors: [{ id: 'rival-1', name: 'R', mobility: 3, level }],
          playerMobility: 3,
          legDistances: [300, 300],
          rules: { ...rules, race: { ...rules.race, time_jitter: 0, field_follow: 0 } },
          rng: createRng(`f-${level}-${seed}`),
        });
        if (result.standings.find((row) => !row.you)!.trouble !== undefined) count += 1;
      }
      return count;
    };
    expect(fails(rules.engine.chem_level_max)).toBeGreaterThan(fails(1));
  });

  it('is deterministic: the same seed replays the same race', () => {
    const run = () =>
      resolveRace({
        competitors: field,
        playerMobility: 3.3,
        legDistances: legs,
        rules,
        rng: createRng('replay'),
      });
    expect(run()).toEqual(run());
  });
});

describe('generateCompetitors: engine levels', () => {
  it('some rivals push, most do not, and a level stays inside the chemical range', () => {
    let pushed = 0;
    let total = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      for (const rival of generateCompetitors(createRng(`lv-${seed}`), rules)) {
        total += 1;
        if (rival.level !== undefined) {
          pushed += 1;
          expect(rival.level).toBeGreaterThan(1);
          expect(rival.level).toBeLessThanOrEqual(rules.engine.chem_level_max + 1e-9);
        }
      }
    }
    expect(pushed / total).toBeGreaterThan(rules.race.rival_push_chance * 0.7);
    expect(pushed / total).toBeLessThan(rules.race.rival_push_chance * 1.3);
  });

  it('none push when the chance is 0', () => {
    const none = { ...rules, race: { ...rules.race, rival_push_chance: 0 } };
    for (let seed = 0; seed < 50; seed += 1) {
      for (const rival of generateCompetitors(createRng(`z-${seed}`), none)) {
        expect(rival.level).toBeUndefined();
      }
    }
  });
});

describe('fieldFor: the rivals follow the player speed part of the way', () => {
  const field = [
    { id: 'r1', name: 'A', mobility: 2.6 },
    { id: 'r2', name: 'B', mobility: 3.9 },
  ];

  it('a ship at the reference speed meets the field as drawn', () => {
    expect(fieldFor(field, rules.race.reference_mob, rules)).toEqual(field);
  });

  it('a much faster ship still leads, but the gap is bounded by field_follow', () => {
    const fast = rules.race.reference_mob * 2.5;
    const scaled = fieldFor(field, fast, rules);
    const factor = 1 + rules.race.field_follow * (fast / rules.race.reference_mob - 1);
    expect(scaled[1]!.mobility).toBeCloseTo(3.9 * factor, 1);
    expect(scaled[1]!.mobility).toBeGreaterThan(3.9);
    expect(scaled[1]!.mobility).toBeLessThan(fast * 1.1);
    // at 0 the field does not move, at 1 it is as fast as the player
    const fixed = fieldFor(field, fast, { ...rules, race: { ...rules.race, field_follow: 0 } });
    expect(fixed).toEqual(field);
  });

  it('a slower ship meets a slower field, never below the floor', () => {
    const slow = fieldFor(field, 1, rules);
    expect(slow[0]!.mobility).toBeLessThan(2.6);
    expect(slow[0]!.mobility).toBeGreaterThanOrEqual(0.5);
  });
});
