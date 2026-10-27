import { describe, expect, it } from '@jest/globals';
import { successRateOf } from '../../../src/stats/profile.service.js';

describe('successRateOf', () => {
  it('is null before the first finished mission', () => {
    expect(successRateOf({})).toBeNull();
    expect(successRateOf({ 'missions.started': 1 })).toBeNull();
  });

  it('is successes over everything that ended', () => {
    expect(
      successRateOf({ 'missions.success': 3, 'missions.failed': 1, 'missions.aborted': 0 }),
    ).toBe(0.75);
    expect(successRateOf({ 'missions.success': 1, 'missions.aborted': 1 })).toBe(0.5);
    expect(successRateOf({ 'missions.failed': 2 })).toBe(0);
  });
});
