import { describe, expect, it } from '@jest/globals';
import { missionDuration } from '../../../src/missions/duration.calculator.js';

// S7.2 (plan line 435): duration = round(distance / MOB × duration_k) × time_scale,
// class from missions.duration_class_cutoffs (factory { fast: 600, medium: 1800 }).
const CUTOFFS: Readonly<Record<string, number>> = { fast: 600, medium: 1800 };

describe('mission duration calculator (S7.2)', () => {
  it('rounds distance / MOB × duration_k, then applies time_scale', () => {
    // 40 / 4 × 2.25 = 22.5 → round → 23, × 1 = 23.
    expect(
      missionDuration({
        totalDistance: 40,
        mobility: 4,
        durationK: 2.25,
        timeScale: 1,
        classCutoffs: CUTOFFS,
      }),
    ).toEqual({ durationSeconds: 23, durationClass: 'fast' });

    // 100 / 3 × 2.25 = 75 → 75, × 2 (time_scale after rounding) = 150.
    expect(
      missionDuration({
        totalDistance: 100,
        mobility: 3,
        durationK: 2.25,
        timeScale: 2,
        classCutoffs: CUTOFFS,
      }),
    ).toEqual({ durationSeconds: 150, durationClass: 'fast' });
  });

  it('classifies against the configured cutoffs, boundaries inclusive', () => {
    const base = { mobility: 1, durationK: 1, timeScale: 1, classCutoffs: CUTOFFS };
    expect(missionDuration({ ...base, totalDistance: 600 }).durationClass).toBe('fast');
    expect(missionDuration({ ...base, totalDistance: 601 }).durationClass).toBe('medium');
    expect(missionDuration({ ...base, totalDistance: 1800 }).durationClass).toBe('medium');
    expect(missionDuration({ ...base, totalDistance: 1801 }).durationClass).toBe('long');
  });

  it('reads class labels from the cutoff record and falls back to long above every cutoff', () => {
    const cutoffs: Readonly<Record<string, number>> = { short: 60, mid: 120 };
    expect(
      missionDuration({
        totalDistance: 30,
        mobility: 1,
        durationK: 1,
        timeScale: 1,
        classCutoffs: cutoffs,
      }).durationClass,
    ).toBe('short');
    expect(
      missionDuration({
        totalDistance: 90,
        mobility: 1,
        durationK: 1,
        timeScale: 1,
        classCutoffs: cutoffs,
      }).durationClass,
    ).toBe('mid');
    expect(
      missionDuration({
        totalDistance: 200,
        mobility: 1,
        durationK: 1,
        timeScale: 1,
        classCutoffs: cutoffs,
      }).durationClass,
    ).toBe('long');
  });
});
