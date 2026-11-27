import { describe, expect, it } from 'vitest';
import { explorePlan, requirementNumber } from './requirement-number';
import type { DisplayResponse, MissionOffer } from '../../api/generated';

const display = {} as DisplayResponse;

describe('requirementNumber combat', () => {
  it('shows one decimal, actual rounded down and needed up, so a short ship never reads equal', () => {
    expect(requirementNumber(0.0071, 'combat', display, 'actual')).toBe('0.7%');
    expect(requirementNumber(0.0075, 'combat', display, 'needed')).toBe('0.8%');
  });
  it('keeps exact values exact', () => {
    expect(requirementNumber(0.125, 'combat', display, 'needed')).toBe('12.5%');
    expect(requirementNumber(0.06, 'combat', display, 'actual')).toBe('6.0%');
  });
});

describe('requirementNumber sensor', () => {
  it('shows at most one decimal, actual rounded down and needed up', () => {
    expect(requirementNumber(3.98, 'sensor', display, 'actual')).toBe('3.9');
    expect(requirementNumber(4, 'sensor', display, 'needed')).toBe('4');
    expect(requirementNumber(4.25, 'sensor', display, 'needed')).toBe('4.3');
    expect(requirementNumber(4.2, 'sensor', display, 'needed')).toBe('4.2');
  });
  it('keeps float noise out of exact values', () => {
    expect(requirementNumber(80 * 0.05, 'sensor', display, 'needed')).toBe('4');
    expect(requirementNumber(0.1 * 3 * 10, 'sensor', display, 'needed')).toBe('3');
    expect(requirementNumber(0.7 * 3, 'sensor', display, 'actual')).toBe('2.1');
  });
});

describe('explorePlan', () => {
  const offer = (eligible: boolean, perTick: number) =>
    ({
      eligibility: { eligible, reasons: [] },
      info: { explore: { perTick, share: 1 } },
    }) as unknown as MissionOffer;

  it('shows the plan of an offer the pilot can take, and of a mission already taken', () => {
    expect(explorePlan(offer(true, 6), false)).not.toBeNull();
    expect(explorePlan(offer(false, 6), true)).not.toBeNull();
  });
  it('shows none for a refused offer or a radar that covers nothing', () => {
    expect(explorePlan(offer(false, 6), false)).toBeNull();
    expect(explorePlan(offer(true, 0), false)).toBeNull();
    expect(explorePlan(offer(true, 0), true)).toBeNull();
  });
});
