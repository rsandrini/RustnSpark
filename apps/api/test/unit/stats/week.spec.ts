import { describe, expect, it } from '@jest/globals';
import { gameDayOf, weekStartInstant, weekStartOf } from '../../../src/stats/week.js';

// The game week runs on Brazil time (UTC-3): Monday 00:00 there is Monday 03:00 UTC.
describe('weekStartOf', () => {
  it('is the Monday of the week, as a game date', () => {
    // 2026-10-28 is a Wednesday
    expect(weekStartOf(new Date('2026-10-28T15:30:00Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });

  it('starts the new week at 03:00 UTC on Monday (00:00 in Brazil)', () => {
    expect(weekStartOf(new Date('2026-10-26T03:00:00Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });

  it('still belongs to the old week at Monday 02:59:59 UTC', () => {
    expect(weekStartOf(new Date('2026-10-26T02:59:59Z')).toISOString()).toBe(
      '2026-10-19T00:00:00.000Z',
    );
  });

  it('belongs to the previous Monday on Sunday 23:59 in Brazil', () => {
    expect(weekStartOf(new Date('2026-11-02T02:59:59Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });

  it('shows the window start as Monday 00:00 Brazil time', () => {
    expect(weekStartInstant(weekStartOf(new Date('2026-10-28T15:30:00Z'))).toISOString()).toBe(
      '2026-10-26T03:00:00.000Z',
    );
  });
});

describe('gameDayOf', () => {
  it('rolls the day at 03:00 UTC', () => {
    expect(gameDayOf(new Date('2026-10-28T02:59:59Z')).toISOString()).toBe(
      '2026-10-27T00:00:00.000Z',
    );
    expect(gameDayOf(new Date('2026-10-28T03:00:00Z')).toISOString()).toBe(
      '2026-10-28T00:00:00.000Z',
    );
  });
});
