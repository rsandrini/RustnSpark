import { describe, it, expect } from 'vitest';
import { pilotNumbersOf } from './pilot-numbers';
import { emptyPublicProfileFixture, publicProfileFixture } from './profile-fixtures';

describe('pilotNumbersOf', () => {
  it('reads a flown pilot', () => {
    expect(pilotNumbersOf(publicProfileFixture())).toEqual({
      missions: 5,
      successPct: 0.75,
      distance: 2400,
      fightsWon: 2,
      raceWins: 1,
      bestRacePlace: 2,
      hasFlown: true,
    });
  });

  it('a never-flown pilot has zeros and hasFlown false', () => {
    const n = pilotNumbersOf(emptyPublicProfileFixture());
    expect(n.hasFlown).toBe(false);
    expect(n.missions).toBe(0);
    expect(n.bestRacePlace).toBeNull();
  });

  it('keeps a null success rate null', () => {
    const p = publicProfileFixture();
    p.successRate = null;
    expect(pilotNumbersOf(p).successPct).toBeNull();
  });

  it('missing totals count as zero', () => {
    const p = publicProfileFixture();
    p.totals = { 'missions.started': 2 };
    const n = pilotNumbersOf(p);
    expect([n.distance, n.fightsWon, n.raceWins]).toEqual([0, 0, 0]);
    expect(n.hasFlown).toBe(true);
  });
});
