import { describe, expect, it } from 'vitest';
import { nextStep, stepDef } from './steps';

describe('the opening steps at the end', () => {
  it('goes loss, rescue, later and then the story is over', () => {
    expect(nextStep('loss')).toBe('rescue');
    expect(nextStep('rescue')).toBe('later');
    expect(nextStep('later')).toBeNull();
  });
  it('shows a black moment on the loss and no continue button on the rescue', () => {
    expect(stepDef('loss').moment).toBe('dark');
    expect(stepDef('rescue').confirm).toBe(false);
    expect(stepDef('later').moment).toBe('later');
  });
});
