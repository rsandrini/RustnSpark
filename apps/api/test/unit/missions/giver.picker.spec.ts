import { describe, expect, it } from '@jest/globals';
import type { MissionType } from '@prisma/client';
import { createRng } from '../../../src/common/rng/rng.js';
import {
  giverShapeOf,
  pickGiver,
  weightedPick,
  type GiverShape,
} from '../../../src/missions/generator/giver.picker.js';

const giver = (
  id: string,
  types: Record<string, number>,
  extra: Partial<GiverShape> = {},
): GiverShape => ({
  id,
  role: 'GIVER',
  weight: 10,
  locationIds: [],
  personality: { types, minZone: 0, maxZone: 3, tone: 'formal' },
  ...extra,
});

const ALL: ReadonlySet<MissionType> = new Set(['DELIVERY', 'TRANSPORT', 'RESCUE', 'RACE']);

describe('quest giver picker', () => {
  it('never picks a mentor, and nobody when nobody qualifies', () => {
    const mentor = giver('m', { DELIVERY: 1 }, { role: 'MENTOR' });
    const input = {
      givers: [mentor],
      locationId: 'ceres',
      liveGiverIds: [],
      boardSize: 8,
      eligibleTypes: ALL,
      rng: createRng('a'),
    };
    expect(pickGiver(input)).toBeUndefined();
    expect(pickGiver({ ...input, givers: [] })).toBeUndefined();
  });

  it('skips a giver who works elsewhere or offers nothing this place can post', () => {
    const elsewhere = giver('far', { DELIVERY: 1 }, { locationIds: ['hedus'] });
    const wrongTypes = giver('miner', { MINING: 1 });
    const anywhere = giver('any', { DELIVERY: 1 });
    for (let i = 0; i < 20; i += 1) {
      const picked = pickGiver({
        givers: [elsewhere, wrongTypes, anywhere],
        locationId: 'ceres',
        liveGiverIds: [],
        boardSize: 8,
        eligibleTypes: ALL,
        rng: createRng(`seed${i}`),
      });
      expect(picked?.id).toBe('any');
    }
    const local = giver('local', { DELIVERY: 1 }, { locationIds: ['ceres'] });
    expect(
      pickGiver({
        givers: [local],
        locationId: 'ceres',
        liveGiverIds: [],
        boardSize: 8,
        eligibleTypes: ALL,
        rng: createRng('x'),
      })?.id,
    ).toBe('local');
  });

  it('keeps one giver to half the board, and relaxes only when nobody else is left', () => {
    const a = giver('a', { DELIVERY: 1 }, { weight: 1000 });
    const b = giver('b', { DELIVERY: 1 }, { weight: 1 });
    const base = {
      givers: [a, b],
      locationId: 'ceres',
      boardSize: 4,
      eligibleTypes: ALL,
    };
    // a already holds 2 of 4: the cap
    for (let i = 0; i < 20; i += 1) {
      expect(pickGiver({ ...base, liveGiverIds: ['a', 'a'], rng: createRng(`s${i}`) })?.id).toBe(
        'b',
      );
    }
    // alone, a is still picked
    expect(
      pickGiver({ ...base, givers: [a], liveGiverIds: ['a', 'a'], rng: createRng('y') })?.id,
    ).toBe('a');
  });

  it('prefers a giver who can offer a type the board still lacks', () => {
    const rescuer = giver('rescuer', { RESCUE: 1 }, { weight: 1 });
    const generalist = giver('generalist', { DELIVERY: 1 }, { weight: 1000 });
    for (let i = 0; i < 20; i += 1) {
      const picked = pickGiver({
        givers: [rescuer, generalist],
        locationId: 'ceres',
        liveGiverIds: [],
        boardSize: 8,
        eligibleTypes: ALL,
        wantTypes: new Set<MissionType>(['RESCUE']),
        rng: createRng(`w${i}`),
      });
      expect(picked?.id).toBe('rescuer');
    }
  });

  it('passes over a giver who offers only the types the board is full of', () => {
    const deliverer = giver('deliverer', { DELIVERY: 1 }, { weight: 1000 });
    const racer = giver('racer', { RACE: 1 }, { weight: 1 });
    for (let i = 0; i < 20; i += 1) {
      const picked = pickGiver({
        givers: [deliverer, racer],
        locationId: 'ceres',
        liveGiverIds: [],
        boardSize: 8,
        eligibleTypes: ALL,
        avoidTypes: new Set<MissionType>(['DELIVERY']),
        rng: createRng(`av${i}`),
      });
      expect(picked?.id).toBe('racer');
    }
  });

  it('is deterministic for a seed and follows the weights over many seeds', () => {
    const heavy = giver('heavy', { DELIVERY: 1 }, { weight: 90 });
    const light = giver('light', { DELIVERY: 1 }, { weight: 10 });
    const pickWith = (seed: string) =>
      pickGiver({
        givers: [heavy, light],
        locationId: 'ceres',
        liveGiverIds: [],
        boardSize: 8,
        eligibleTypes: ALL,
        rng: createRng(seed),
      })?.id;
    expect(pickWith('same')).toBe(pickWith('same'));
    let heavyCount = 0;
    for (let i = 0; i < 400; i += 1) if (pickWith(`n${i}`) === 'heavy') heavyCount += 1;
    expect(heavyCount).toBeGreaterThan(320);
    expect(heavyCount).toBeLessThan(400);
  });

  it('weightedPick follows the weights', () => {
    const counts = { x: 0, y: 0 };
    for (let i = 0; i < 400; i += 1) {
      const picked = weightedPick(
        ['x', 'y'] as const,
        (item) => (item === 'x' ? 3 : 1),
        createRng(`p${i}`),
      );
      counts[picked] += 1;
    }
    expect(counts.x).toBeGreaterThan(counts.y * 2);
  });

  it('reads a giver row defensively (Admin edits the JSON)', () => {
    const shape = giverShapeOf({
      id: 'g',
      role: 'GIVER',
      weight: 5,
      locationIds: ['ceres'],
      personality: { types: { DELIVERY: 3, NONSENSE: 9, RACE: -1, RESCUE: 'x' }, minZone: 1 },
    });
    expect(shape.personality.types).toEqual({ DELIVERY: 3 });
    expect(shape.personality.minZone).toBe(1);
    expect(shape.personality.maxZone).toBe(Number.POSITIVE_INFINITY);
    expect(
      giverShapeOf({ id: 'h', role: 'GIVER', weight: 1, locationIds: [], personality: null })
        .personality.types,
    ).toEqual({});
  });
});
