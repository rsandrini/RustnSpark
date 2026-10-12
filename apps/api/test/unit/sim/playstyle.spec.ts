import { describe, expect, it } from '@jest/globals';
import {
  filterForPlaystyle,
  playstyleAllowsJob,
  playstyleOf,
} from '../../../sim/bots/playstyle.js';
import type { Offer } from '../../../sim/core/world.js';
import type { MissionTypeName } from '../../../sim/snapshot/types.js';

function offerOfType(id: string, type: MissionTypeName): Offer {
  return {
    id,
    seed: id,
    templateId: 'delivery_luna',
    type,
    factionId: 'luna',
    originId: 'ceres',
    destinationId: 'tycho',
    legs: [
      {
        routeId: 'ceres-tycho',
        distance: 100,
        danger: 1,
        zone: 0,
        env: { id: 'open', level: 1, fuelMult: 1 },
      },
    ],
    cargo: {},
    reward: 100,
    expiresAtMs: 0,
    deadlineAtMs: null,
    starter: false,
    requirements: {},
    encounterPolicy: {},
  };
}

describe('playstyleOf', () => {
  it('passes the three named playstyles through', () => {
    expect(playstyleOf('generalist')).toBe('generalist');
    expect(playstyleOf('hauler')).toBe('hauler');
    expect(playstyleOf('rescuer')).toBe('rescuer');
  });

  it('falls back to generalist for an unknown string', () => {
    expect(playstyleOf('pirate')).toBe('generalist');
    expect(playstyleOf('')).toBe('generalist');
  });
});

describe('filterForPlaystyle', () => {
  const board = [
    offerOfType('delivery', 'DELIVERY'),
    offerOfType('race', 'RACE'),
    offerOfType('rescue', 'RESCUE'),
    offerOfType('escort', 'ESCORT'),
    offerOfType('mining', 'MINING'),
  ];

  it('generalist flies everything and never falls back', () => {
    const { kept, fallback } = filterForPlaystyle('generalist', board);
    expect(kept).toEqual(board);
    expect(fallback).toBe(false);
  });

  it('hauler keeps delivery, transport and race work', () => {
    const { kept, fallback } = filterForPlaystyle('hauler', board);
    expect(kept.map((offer) => offer.id)).toEqual(['delivery', 'race']);
    expect(fallback).toBe(false);
  });

  it('rescuer keeps rescue and escort work', () => {
    const { kept, fallback } = filterForPlaystyle('rescuer', board);
    expect(kept.map((offer) => offer.id)).toEqual(['rescue', 'escort']);
    expect(fallback).toBe(false);
  });

  it('falls back to the whole board — flagged — when the cut leaves nothing', () => {
    const rescuesOnly = [offerOfType('rescue', 'RESCUE')];
    const { kept, fallback } = filterForPlaystyle('hauler', rescuesOnly);
    expect(kept).toEqual(rescuesOnly);
    expect(fallback).toBe(true);
  });

  it('reports no fallback on an empty board', () => {
    const { kept, fallback } = filterForPlaystyle('hauler', []);
    expect(kept).toEqual([]);
    expect(fallback).toBe(false);
  });
});

describe('playstyleAllowsJob', () => {
  it('the hauler never mines but still scavenges', () => {
    expect(playstyleAllowsJob('hauler', 'mining')).toBe(false);
    expect(playstyleAllowsJob('hauler', 'scavenge')).toBe(true);
  });

  it('every other style digs', () => {
    expect(playstyleAllowsJob('generalist', 'mining')).toBe(true);
    expect(playstyleAllowsJob('rescuer', 'mining')).toBe(true);
  });
});
