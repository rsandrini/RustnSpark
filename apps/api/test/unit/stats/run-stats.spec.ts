import { describe, expect, it } from '@jest/globals';
import { missionEvent } from '../../../src/resolution/events/mission-event.js';
import { runStatsOf, type RunStatsInput } from '../../../src/stats/run-stats.js';

const actors = { playerShipId: 'ship-1' };
const DEAD_AT = 1;

function base(overrides: Partial<RunStatsInput>): RunStatsInput {
  return {
    type: 'DELIVERY',
    status: 'success',
    events: [],
    partsBefore: [
      { id: 'engine', condition: 90 },
      { id: 'hull', condition: 80 },
    ],
    partsAfter: [
      { id: 'engine', condition: 90 },
      { id: 'hull', condition: 80 },
    ],
    fuelBefore: 40,
    fuelAfter: 30,
    credited: 0,
    shipLost: false,
    onFoot: false,
    isDead: (condition) => condition <= DEAD_AT,
    ...overrides,
  };
}

const leg = (index: number, distance: number) =>
  missionEvent({
    leg: index,
    category: 'transit',
    type: 'leg_travel',
    actors,
    magnitude: distance,
  });

describe('runStatsOf', () => {
  it('counts a clean two-leg delivery', () => {
    const { delta, records } = runStatsOf(
      base({ events: [leg(0, 30), leg(1, 12)], fuelBefore: 40, fuelAfter: 31, credited: 500 }),
    );
    expect(delta).toEqual({
      'missions.started': 1,
      'missions.success': 1,
      'flight.distance': 42,
      'flight.legs': 2,
      'fuel.burned': 9,
    });
    expect(records).toEqual(
      expect.arrayContaining([
        { key: 'best.payout', value: 500 },
        { key: 'best.run_distance', value: 42 },
      ]),
    );
  });

  it('sums a fight once, with damage dealt from the player hits only', () => {
    const rounds = [
      {
        round: 1,
        attacker: 'player',
        roll: 14,
        dc: 10,
        hit: true,
        damage: 12,
        armorAbsorbed: 0,
        shieldAbsorbed: 0,
        hullDamage: 12,
      },
      {
        round: 2,
        attacker: 'enemy',
        roll: 15,
        dc: 10,
        hit: true,
        damage: 9,
        armorAbsorbed: 1,
        shieldAbsorbed: 3,
        hullDamage: 5,
      },
      {
        round: 3,
        attacker: 'player',
        roll: 11,
        dc: 10,
        hit: true,
        damage: 8,
        armorAbsorbed: 0,
        shieldAbsorbed: 0,
        hullDamage: 8,
      },
      {
        round: 4,
        attacker: 'player',
        roll: 2,
        dc: 10,
        hit: false,
        damage: 0,
        armorAbsorbed: 0,
        shieldAbsorbed: 0,
        hullDamage: 0,
      },
    ] as const;
    const fight = missionEvent({
      leg: 0,
      category: 'combat',
      type: 'combat_win',
      actors: { ...actors, enemy: 'pirate' },
      cascade: { shield: 3, armor: 1, hp: 5 },
      rounds,
    });
    const { delta } = runStatsOf(base({ events: [fight, fight] }));
    // two events of one fight would double the damage if summed per event; here they are two fights
    expect(delta['fights.won']).toBe(2);
    expect(delta['damage.dealt']).toBe(40);
    expect(delta['damage.taken']).toBe(18);
    expect(delta['damage.taken_shield']).toBe(6);
    expect(delta['fights.pirate']).toBe(2);
  });

  it('splits a tank leak from the fuel burned', () => {
    const leak = missionEvent({
      leg: 0,
      category: 'failure',
      type: 'tank',
      actors,
      fuelLost: 3,
    });
    const { delta } = runStatsOf(
      base({ events: [leg(0, 10), leak], fuelBefore: 40, fuelAfter: 30 }),
    );
    expect(delta['fuel.lost']).toBe(3);
    expect(delta['fuel.burned']).toBe(7);
    expect(delta['parts.failures']).toBe(1);
  });

  it('counts wear points from the wear events and parts that died', () => {
    const wear = missionEvent({
      leg: 0,
      category: 'environment',
      type: 'mission_wear',
      actors,
      condByPart: { engine: 70, hull: 1 },
    });
    const { delta } = runStatsOf(
      base({
        events: [wear],
        partsAfter: [
          { id: 'engine', condition: 70 },
          { id: 'hull', condition: 1 },
        ],
      }),
    );
    expect(delta['wear.points']).toBe(20 + 79);
    expect(delta['parts.destroyed']).toBe(1);
  });

  it('counts a race: entered, podium, no win at place 2, and the records', () => {
    const race = missionEvent({
      leg: 0,
      category: 'payment',
      type: 'race_result',
      actors,
      race: {
        place: 2,
        timeScale: 2,
        standings: [
          { name: 'A', mobility: 5, seconds: 100, you: false },
          { name: 'Me', mobility: 5, seconds: 110, you: true },
        ],
      },
    });
    const { delta, records } = runStatsOf(base({ type: 'RACE', events: [race] }));
    expect(delta['races.entered']).toBe(1);
    expect(delta['races.podium']).toBe(1);
    expect(delta['races.won']).toBeUndefined();
    expect(records).toEqual(
      expect.arrayContaining([
        { key: 'best.race_place', value: 2 },
        { key: 'best.race_seconds', value: 220 },
      ]),
    );
  });

  it('counts an on-foot scavenge with its finds', () => {
    const find = (kind: 'part' | 'scrap') =>
      missionEvent({
        leg: 0,
        category: 'loot',
        type: 'scavenge_find',
        actors,
        found: { kind, partType: 'tank_small', condition: 40 },
      });
    const { delta } = runStatsOf(
      base({
        type: 'SCAVENGE',
        onFoot: true,
        events: [find('part'), find('scrap'), find('scrap')],
      }),
    );
    expect(delta['scavenge.foot_runs']).toBe(1);
    expect(delta['scavenge.ship_runs']).toBeUndefined();
    expect(delta['scavenge.parts_found']).toBe(1);
    expect(delta['scavenge.scrap_found']).toBe(2);
  });

  it('counts mined ore only for a mining mission', () => {
    const mined = missionEvent({
      leg: 0,
      category: 'loot',
      type: 'mining',
      actors,
      loot: [{ materialId: 'ore', quantity: 14 }],
    });
    expect(runStatsOf(base({ type: 'MINING', events: [mined] })).delta).toMatchObject({
      'mining.runs': 1,
      'mining.ore': 14,
    });
    expect(
      runStatsOf(base({ type: 'DELIVERY', events: [mined] })).delta['mining.ore'],
    ).toBeUndefined();
  });

  it('records a lost ship and a ship adrift', () => {
    expect(runStatsOf(base({ status: 'failed', shipLost: true })).delta).toMatchObject({
      'missions.failed': 1,
      'missions.ship_lost': 1,
      'ships.destroyed': 1,
    });
    expect(runStatsOf(base({ status: 'adrift' })).delta).toMatchObject({
      'missions.aborted': 1,
      'adrift.times': 1,
    });
  });
});
