import { describe, expect, it } from 'vitest';
import { requirementNumber } from './requirement-number';
import type { DisplayResponse } from '../../api/generated';

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
