import { describe, expect, it } from '@jest/globals';
import {
  calendarDays,
  createClock,
  DEFAULT_BUDGET,
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_HUMAN_PAUSE_SECONDS,
} from '../../../sim/core/clock.js';

const SECONDS_PER_HOUR = 3600;

describe('sim clock', () => {
  it('starts at zero and only moves forward', () => {
    const clock = createClock();
    expect(clock.now()).toBe(0);
    clock.advance(90);
    expect(clock.now()).toBe(90);
    clock.advance(0);
    expect(clock.now()).toBe(90);
  });

  it('refuses to run backwards', () => {
    const clock = createClock(10);
    expect(() => clock.advance(-1)).toThrow(/only move forward/);
  });

  it('converts seconds into days of play at the budget', () => {
    const oneDay = DEFAULT_HOURS_PER_DAY * SECONDS_PER_HOUR;
    expect(calendarDays(oneDay)).toBe(1);
    expect(calendarDays(oneDay * 2.5)).toBe(2.5);
    expect(DEFAULT_BUDGET.humanPauseSeconds).toBe(DEFAULT_HUMAN_PAUSE_SECONDS);
  });
});
