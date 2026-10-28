import { describe, expect, it } from '@jest/globals';
import { weekStartOf } from '../../../src/stats/week.js';

describe('weekStartOf', () => {
  it('is the Monday 00:00 UTC of the week', () => {
    // 2026-10-28 is a Wednesday
    expect(weekStartOf(new Date('2026-10-28T15:30:00Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });

  it('is the same instant on Monday 00:00:00 exactly', () => {
    expect(weekStartOf(new Date('2026-10-26T00:00:00Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });

  it('belongs to the previous Monday on Sunday 23:59', () => {
    expect(weekStartOf(new Date('2026-11-01T23:59:59Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
  });
});
