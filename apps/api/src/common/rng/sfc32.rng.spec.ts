import { describe, expect, it } from '@jest/globals';
import { sfc32 } from './sfc32.rng.js';

describe('sfc32', () => {
  it('is a pure function of its four seed words: same seeds produce the same sequence', () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 4);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces floats in [0, 1)', () => {
    const next = sfc32(42, 1337, 7, 99);
    for (let i = 0; i < 1000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('different seed words produce a different sequence', () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 5);
    expect(a()).not.toBe(b());
  });

  it('keeps independent state across two generators built from the same words', () => {
    const a = sfc32(10, 20, 30, 40);
    const b = sfc32(10, 20, 30, 40);
    a();
    a();
    // b has not advanced, so its first draw must equal a's first draw, not its third
    const aFresh = sfc32(10, 20, 30, 40)();
    expect(b()).toBe(aFresh);
  });
});
