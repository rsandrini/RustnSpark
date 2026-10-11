import { describe, expect, it } from '@jest/globals';
import { isVariedEnough, offerKey } from '../../../src/missions/board-variety.js';

const offer = (type: string, destinationId: string, materialId?: string) => ({
  type,
  destinationId,
  ...(materialId !== undefined ? { cargo: { materialId } } : {}),
});

describe('board variety', () => {
  it('the same type for the same destination is the same job', () => {
    expect(offerKey(offer('DELIVERY', 'ceres'))).toBe(offerKey(offer('DELIVERY', 'ceres')));
    expect(offerKey(offer('DELIVERY', 'ceres'))).not.toBe(offerKey(offer('DELIVERY', 'vesta')));
    expect(offerKey(offer('DELIVERY', 'ceres'))).not.toBe(offerKey(offer('ESCORT', 'ceres')));
  });

  it('mining offers also differ by material', () => {
    expect(offerKey(offer('MINING', 'ceres', 'iron'))).not.toBe(
      offerKey(offer('MINING', 'ceres', 'ice')),
    );
  });

  it('refuses a duplicate and a third of a type, in the strict mode', () => {
    const live = [offer('DELIVERY', 'ceres'), offer('DELIVERY', 'vesta')];
    expect(isVariedEnough(offer('DELIVERY', 'ceres'), live, 2, 0)).toBe(false);
    // different destination, but already two of the type
    expect(isVariedEnough(offer('DELIVERY', 'hedus'), live, 2, 0)).toBe(false);
    expect(isVariedEnough(offer('ESCORT', 'ceres'), live, 2, 0)).toBe(true);
  });

  it('loosens step by step: first the type cap, then everything', () => {
    const live = [offer('DELIVERY', 'ceres'), offer('DELIVERY', 'vesta')];
    expect(isVariedEnough(offer('DELIVERY', 'hedus'), live, 2, 1)).toBe(true);
    expect(isVariedEnough(offer('DELIVERY', 'ceres'), live, 2, 1)).toBe(false);
    expect(isVariedEnough(offer('DELIVERY', 'ceres'), live, 2, 2)).toBe(true);
  });
});
