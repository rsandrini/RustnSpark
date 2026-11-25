import { describe, it, expect } from 'vitest';
import type { RankingEntry } from '../../api/generated';
import { gapToNext, podiumOf } from './podium';

const entry = (rank: number, value: number): RankingEntry => ({
  rank,
  publicId: `p${rank}`,
  name: `Pilot ${rank}`,
  factionId: 'luna',
  value,
  isMe: false,
});

const list = (n: number): RankingEntry[] =>
  Array.from({ length: n }, (_, i) => entry(i + 1, 1000 - i * 10));

describe('podiumOf', () => {
  it('handles an empty list', () => {
    expect(podiumOf([])).toEqual({ rest: [] });
  });

  it('fills positions in rank order', () => {
    const one = podiumOf(list(1));
    expect(one.first?.name).toBe('Pilot 1');
    expect(one.second).toBeUndefined();
    const two = podiumOf(list(2));
    expect(two.second?.name).toBe('Pilot 2');
    expect(two.third).toBeUndefined();
    const three = podiumOf(list(3));
    expect(three.third?.name).toBe('Pilot 3');
    expect(three.rest).toEqual([]);
  });

  it('puts rank 4 and up in rest, keeping server order', () => {
    const p = podiumOf(list(5));
    expect(p.rest.map((e) => e.rank)).toEqual([4, 5]);
  });
});

describe('gapToNext', () => {
  const entries = list(50);

  it('is first for rank 1', () => {
    expect(gapToNext({ board: 'distance', entries, me: { rank: 1, value: 9 } })).toEqual({
      kind: 'first',
    });
  });

  it('measures the gap to the pilot ahead', () => {
    const e = [entry(13, 500), entry(14, 380)];
    expect(gapToNext({ board: 'distance', entries: e, me: { rank: 14, value: 380 } })).toEqual({
      kind: 'behind',
      amount: 120,
    });
  });

  it('handles race_time where the pilot ahead is lower', () => {
    const e = [entry(1, 83), entry(2, 95)];
    expect(gapToNext({ board: 'race_time', entries: e, me: { rank: 2, value: 95 } })).toEqual({
      kind: 'behind',
      amount: 12,
    });
  });

  it('is unknown outside the list or without me', () => {
    expect(gapToNext({ board: 'distance', entries: list(50), me: { rank: 80, value: 1 } })).toEqual(
      { kind: 'unknown' },
    );
    expect(gapToNext({ board: 'distance', entries, me: null })).toEqual({
      kind: 'unknown',
    });
  });

  it('is 0 on a tie', () => {
    const e = [entry(2, 700), entry(3, 700)];
    expect(gapToNext({ board: 'distance', entries: e, me: { rank: 3, value: 700 } })).toEqual({
      kind: 'behind',
      amount: 0,
    });
  });
});
