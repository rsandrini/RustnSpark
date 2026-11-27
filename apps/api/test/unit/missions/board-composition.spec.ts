import { describe, expect, it } from '@jest/globals';
import type { MissionType } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  boardTarget,
  extraTypes,
  lengthBounds,
  nextSlot,
  requiredTypes,
  type BoardReach,
  type LiveOffer,
} from '../../../src/missions/board-composition.js';

const rules = GAME_CONFIG_DEFAULTS;

function reachOf(entries: Record<string, [number, number, number]>): BoardReach {
  return new Map(
    Object.entries(entries).map(([type, [destinations, nearestSeconds, farthestSeconds]]) => [
      type as MissionType,
      { destinations, nearestSeconds, farthestSeconds },
    ]),
  );
}

const MAIN: Record<string, [number, number, number]> = {
  DELIVERY: [37, 300, 8400],
  TRANSPORT: [39, 300, 8400],
  ESCORT: [36, 300, 1900],
  MINING: [18, 300, 1900],
  RACE: [37, 300, 1900],
  RESCUE: [36, 600, 3900],
};
const mainReach = reachOf(MAIN);
const set = (...types: string[]) => new Set(types as MissionType[]);
const offers = (...entries: [string, number][]): LiveOffer[] =>
  entries.map(([type, seconds]) => ({ type: type as MissionType, seconds }));
const withRules = (patch: Partial<GameRules['missions']>): GameRules => ({
  ...rules,
  missions: { ...rules.missions, ...patch },
});

describe('board composition', () => {
  it('an empty main-port board asks for DELIVERY long first, then TRANSPORT short', () => {
    const none = set();
    expect(nextSlot({ reach: mainReach, live: [], capped: none, rules })).toEqual({
      types: set('DELIVERY'),
      length: 'long',
    });
    expect(
      nextSlot({ reach: mainReach, live: offers(['DELIVERY', 8400]), capped: none, rules }),
    ).toEqual({ types: set('TRANSPORT'), length: 'short' });
  });

  it('asks for two races when the place has two race destinations, one when it has one, none when it has none', () => {
    expect(requiredTypes(mainReach, rules).slice(-2)).toEqual(['RACE', 'RACE']);
    const oneRace = reachOf({ ...MAIN, RACE: [1, 300, 1900] });
    expect(requiredTypes(oneRace, rules).filter((t) => t === 'RACE')).toEqual(['RACE']);
    const { RACE: _race, ...noRace } = MAIN;
    expect(requiredTypes(reachOf(noRace), rules)).not.toContain('RACE');
  });

  it('with every required type live but nothing long, asks for long among the types that reach it, never a capped one', () => {
    const reach = reachOf({
      DELIVERY: [37, 300, 8400],
      TRANSPORT: [39, 300, 8400],
      ESCORT: [36, 300, 1900],
      MINING: [18, 300, 1900],
      RACE: [37, 300, 1900],
    });
    const live = offers(
      ['DELIVERY', 300],
      ['TRANSPORT', 300],
      ['ESCORT', 300],
      ['MINING', 300],
      ['RACE', 300],
      ['RACE', 300],
    );
    expect(nextSlot({ reach, live, capped: set(), rules })).toEqual({
      types: set('DELIVERY', 'TRANSPORT'),
      length: 'long',
    });
    expect(nextSlot({ reach, live, capped: set('DELIVERY'), rules })).toEqual({
      types: set('TRANSPORT'),
      length: 'long',
    });
  });

  it('a capped required type is not asked for: the slot falls to the length need instead', () => {
    const live = offers(
      ['DELIVERY', 300],
      ['TRANSPORT', 300],
      ['ESCORT', 300],
      ['MINING', 300],
      ['RACE', 300],
    );
    const slot = nextSlot({ reach: mainReach, live, capped: set('RACE'), rules });
    expect(slot.types?.has('RACE') ?? false).toBe(false);
    expect(slot.length).toBe('long');
  });

  it('a need no uncapped type can serve is skipped, not turned into a slot the filler cannot meet', () => {
    const reach = reachOf({ DELIVERY: [37, 300, 8400], ESCORT: [36, 300, 1900] });
    const live = offers(['DELIVERY', 300], ['ESCORT', 300]);
    const rulesCore = withRules({ board_core_types: ['DELIVERY', 'ESCORT'], board_min_races: 0 });
    expect(nextSlot({ reach, live, capped: set('DELIVERY'), rules: rulesCore })).toEqual({});
  });

  it('a live offer of exactly 600 s is short and not long; exactly 3600 s is long', () => {
    const reach = reachOf({ DELIVERY: [37, 300, 8400] });
    const one = withRules({ board_core_types: ['DELIVERY'], board_min_races: 0 });
    expect(nextSlot({ reach, live: offers(['DELIVERY', 600]), capped: set(), rules: one })).toEqual(
      {
        types: set('DELIVERY'),
        length: 'long',
      },
    );
    expect(
      nextSlot({ reach, live: offers(['DELIVERY', 3600]), capped: set(), rules: one }),
    ).toEqual({
      types: set('DELIVERY'),
      length: 'short',
    });
  });

  it('a clamped short bound: with the nearest trip at 675 s an offer of 700 is not short', () => {
    const reach = reachOf({ DELIVERY: [3, 675, 8400] });
    const one = withRules({ board_core_types: ['DELIVERY'], board_min_races: 0 });
    expect(
      nextSlot({ reach, live: offers(['DELIVERY', 675]), capped: set(), rules: one }).length,
    ).toBe('long');
    expect(
      nextSlot({
        reach,
        live: offers(['DELIVERY', 700], ['DELIVERY', 3600]),
        capped: set(),
        rules: one,
      }),
    ).toEqual({
      types: set('DELIVERY'),
      length: 'short',
    });
  });

  it('a short bound at or above the long bound still asks for each length once', () => {
    const reach = reachOf({ DELIVERY: [37, 300, 8400] });
    const odd = withRules({
      board_core_types: ['DELIVERY'],
      board_min_races: 0,
      board_short_max_seconds: 4000,
      board_long_min_seconds: 3600,
    });
    expect(nextSlot({ reach, live: [], capped: set(), rules: odd })).toEqual({
      types: set('DELIVERY'),
      length: 'long',
    });
    expect(
      nextSlot({ reach, live: offers(['DELIVERY', 3700]), capped: set(), rules: odd }),
    ).toEqual({});
  });

  it('a place with no trip under the threshold counts its nearest as short', () => {
    expect(lengthBounds(reachOf({ DELIVERY: [3, 675, 1900] }), rules)).toEqual({
      shortMax: 675,
      longMin: 1900,
    });
  });

  it('core types the place cannot post are skipped', () => {
    const { ESCORT: _escort, ...noEscort } = MAIN;
    expect(requiredTypes(reachOf(noEscort), rules)).toEqual([
      'DELIVERY',
      'TRANSPORT',
      'MINING',
      'RACE',
      'RACE',
    ]);
  });

  it('an edited board_core_types with TRAVEL or an unknown name ignores them', () => {
    const edited = withRules({ board_core_types: ['TRAVEL', 'NOPE', 'SCAVENGE', 'DELIVERY'] });
    const reach = reachOf({ ...MAIN, TRAVEL: [5, 300, 900], SCAVENGE: [5, 300, 900] });
    expect(requiredTypes(reach, edited)).toEqual(['DELIVERY', 'RACE', 'RACE']);
  });

  it('a full mix asks only for types the board lacks; returns {} when nothing is missing', () => {
    const live = offers(
      ['DELIVERY', 8400],
      ['TRANSPORT', 300],
      ['ESCORT', 300],
      ['MINING', 300],
      ['RACE', 300],
      ['RACE', 300],
    );
    expect(nextSlot({ reach: mainReach, live, capped: set(), rules })).toEqual({
      types: set('RESCUE'),
    });
    expect(
      nextSlot({
        reach: mainReach,
        live: [...live, ...offers(['RESCUE', 600])],
        capped: set(),
        rules,
      }),
    ).toEqual({});
  });

  it('boardTarget grows above the base when the required slots do not fit, never shrinks', () => {
    expect(boardTarget(4, mainReach, rules)).toBe(6);
    expect(boardTarget(10, mainReach, rules)).toBe(10);
  });

  it('a one-type reach with one destination still returns a slot it can serve', () => {
    const reach = reachOf({ DELIVERY: [1, 450, 450] });
    expect(nextSlot({ reach, live: [], capped: set(), rules })).toEqual({
      types: set('DELIVERY'),
      length: 'long',
    });
    expect(nextSlot({ reach, live: offers(['DELIVERY', 450]), capped: set(), rules })).toEqual({});
  });

  it('an empty reach has no length bounds and no slot', () => {
    const reach: BoardReach = new Map();
    expect(lengthBounds(reach, rules)).toBeNull();
    expect(nextSlot({ reach, live: [], capped: set(), rules })).toEqual({});
  });

  describe('extras slot', () => {
    const exploreReach = reachOf({ ...MAIN, EXPLORE: [3, 600, 1800] });
    const core = offers(
      ['DELIVERY', 8400],
      ['TRANSPORT', 300],
      ['ESCORT', 300],
      ['MINING', 300],
      ['RACE', 300],
      ['RACE', 300],
      ['RESCUE', 600],
    );

    it('a full core board that can post EXPLORE asks for it before any length need', () => {
      const live = offers(
        ['DELIVERY', 300],
        ['TRANSPORT', 300],
        ['ESCORT', 300],
        ['MINING', 300],
        ['RACE', 300],
        ['RACE', 300],
      );
      expect(nextSlot({ reach: exploreReach, live, capped: set(), rules })).toEqual({
        types: set('EXPLORE'),
      });
      expect(
        nextSlot({
          reach: exploreReach,
          live: [...core, ...offers(['EXPLORE', 900])],
          capped: set(),
          rules,
        }),
      ).toEqual({});
    });

    it('extras are not core: requiredTypes never lists EXPLORE', () => {
      expect(requiredTypes(exploreReach, rules)).not.toContain('EXPLORE');
      expect(extraTypes(exploreReach, rules)).toEqual(['EXPLORE']);
    });

    it('boardTarget grows by board_min_extras only where an extra type is reachable', () => {
      expect(boardTarget(4, exploreReach, rules)).toBe(7);
      expect(boardTarget(4, mainReach, rules)).toBe(6);
      expect(boardTarget(10, exploreReach, rules)).toBe(10);
      expect(boardTarget(7, exploreReach, rules)).toBe(7);
    });

    it('board_min_extras 0 reproduces the slice-2.1 planner on the existing fixtures', () => {
      const off = withRules({ board_min_extras: 0 });
      const none = set();
      const seq = (r: GameRules) => [
        boardTarget(4, mainReach, r),
        boardTarget(10, mainReach, r),
        nextSlot({ reach: mainReach, live: [], capped: none, rules: r }),
        nextSlot({ reach: mainReach, live: offers(['DELIVERY', 8400]), capped: none, rules: r }),
        nextSlot({ reach: mainReach, live: core, capped: none, rules: r }),
        nextSlot({ reach: mainReach, live: core, capped: set('DELIVERY'), rules: r }),
      ];
      expect(seq(off)).toEqual([
        6,
        10,
        { types: set('DELIVERY'), length: 'long' },
        { types: set('TRANSPORT'), length: 'short' },
        {},
        {},
      ]);
      // and a place that cannot post an extra plans the same with the floor on
      expect(seq(rules)).toEqual(seq(off));
      expect(boardTarget(4, exploreReach, off)).toBe(6);
    });

    it('board_min_extras 2 with one extra type asks EXPLORE twice, then stops', () => {
      const two = withRules({ board_min_extras: 2 });
      expect(boardTarget(4, exploreReach, two)).toBe(8);
      const ask = (n: number) =>
        nextSlot({
          reach: exploreReach,
          live: [
            ...core,
            ...offers(...Array.from({ length: n }, (): [string, number] => ['EXPLORE', 900])),
          ],
          capped: set(),
          rules: two,
        });
      expect(ask(0).types).toEqual(set('EXPLORE'));
      expect(ask(1).types).toEqual(set('EXPLORE'));
      expect(ask(2)).toEqual({});
      expect(
        nextSlot({ reach: exploreReach, live: core, capped: set('EXPLORE'), rules: two }),
      ).toEqual({});
    });

    it('listing a required type such as RACE in board_extra_types is ignored and does not grow the target', () => {
      const r = withRules({ board_extra_types: ['RACE'] });
      expect(extraTypes(exploreReach, r)).toEqual([]);
      expect(boardTarget(4, exploreReach, r)).toBe(6);
    });

    it('the extra carries a pending length need when it can serve it', () => {
      const regional = reachOf({ ...MAIN, EXPLORE: [3, 600, 5000] });
      const live = offers(
        ['DELIVERY', 300],
        ['TRANSPORT', 300],
        ['ESCORT', 300],
        ['MINING', 300],
        ['RACE', 300],
        ['RACE', 300],
        ['RESCUE', 600],
      );
      expect(nextSlot({ reach: regional, live, capped: set(), rules })).toEqual({
        types: set('EXPLORE'),
        length: 'long',
      });
    });

    it('a capped extra is not asked for', () => {
      const live = offers(
        ['DELIVERY', 300],
        ['TRANSPORT', 300],
        ['ESCORT', 300],
        ['MINING', 300],
        ['RACE', 300],
        ['RACE', 300],
      );
      expect(nextSlot({ reach: exploreReach, live, capped: set('EXPLORE'), rules })).toEqual({
        types: set('DELIVERY', 'TRANSPORT', 'RESCUE'),
        length: 'long',
      });
    });

    it('unknown, core and NOT_BOARD names in board_extra_types are ignored; NaN extras disable', () => {
      const odd = withRules({
        board_extra_types: ['NOPE', 'DELIVERY', 'TRAVEL', 'EXPLORE', 'EXPLORE'],
      });
      expect(extraTypes(exploreReach, odd)).toEqual(['EXPLORE']);
      expect(boardTarget(4, exploreReach, withRules({ board_min_extras: NaN }))).toBe(6);
    });

    it('the missing core step still comes first', () => {
      expect(
        nextSlot({ reach: exploreReach, live: offers(['DELIVERY', 8400]), capped: set(), rules })
          .types,
      ).toEqual(set('TRANSPORT'));
    });
  });
});
