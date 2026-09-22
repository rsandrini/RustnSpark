import { describe, expect, it } from '@jest/globals';
import { createRng } from './rng.js';

describe('createRng', () => {
  describe('determinism', () => {
    it('same numeric seed produces the same sequence of floats', () => {
      const a = createRng(1234);
      const b = createRng(1234);
      const seqA = Array.from({ length: 20 }, () => a.float());
      const seqB = Array.from({ length: 20 }, () => b.float());
      expect(seqA).toEqual(seqB);
    });

    it('same string seed produces the same sequence of floats across independent instances', () => {
      const a = createRng('match-42');
      const b = createRng('match-42');
      expect(a.float()).toBe(b.float());
      expect(a.float()).toBe(b.float());
    });

    it('different seeds produce different sequences', () => {
      const a = createRng(1);
      const b = createRng(2);
      expect(a.float()).not.toBe(b.float());
    });

    it('two seeds sharing the same low 32 bits but different high bits produce different sequences', () => {
      // 12345 and 12345 + 2^32 have an identical low-32-bit half; only the high bits differ.
      // deriveSeed can return up to ~53 bits, so all of it must reach the generator, not just
      // the low 32 bits, or every derived seed tree would collide at a 2^32 birthday bound.
      const low = createRng(12345);
      const highShifted = createRng(12345 + 4294967296);
      const lowValues = Array.from({ length: 5 }, () => low.float());
      const highShiftedValues = Array.from({ length: 5 }, () => highShifted.float());
      expect(highShiftedValues).not.toEqual(lowValues);
    });
  });

  describe('golden values', () => {
    it('produces the exact first 5 floats for a fixed numeric seed (regression guard)', () => {
      const rng = createRng(42);
      const values = Array.from({ length: 5 }, () => rng.float());
      expect(values).toEqual([
        0.9465068783611059, 0.865393620217219, 0.4733950097579509, 0.1847537278663367,
        0.7470035145524889,
      ]);
    });

    it('produces the exact first 5 floats for a fixed string seed (regression guard)', () => {
      const rng = createRng('rust-and-spark');
      const values = Array.from({ length: 5 }, () => rng.float());
      expect(values).toEqual([
        0.008188138250261545, 0.23016472510062158, 0.9348792626988143, 0.8818587264977396,
        0.3596335225738585,
      ]);
    });
  });

  describe('int', () => {
    it('is inclusive of both bounds', () => {
      const rng = createRng(7);
      let sawMin = false;
      let sawMax = false;
      for (let i = 0; i < 500; i++) {
        const value = rng.int(0, 1);
        expect(value === 0 || value === 1).toBe(true);
        if (value === 0) sawMin = true;
        if (value === 1) sawMax = true;
      }
      expect(sawMin).toBe(true);
      expect(sawMax).toBe(true);
    });

    it('never returns a value outside [min, max]', () => {
      const rng = createRng(7);
      for (let i = 0; i < 2000; i++) {
        const value = rng.int(3, 9);
        expect(value).toBeGreaterThanOrEqual(3);
        expect(value).toBeLessThanOrEqual(9);
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    it('rejects non-integer bounds', () => {
      const rng = createRng(1);
      expect(() => rng.int(1.5, 3)).toThrow(RangeError);
    });

    it('rejects min > max', () => {
      const rng = createRng(1);
      expect(() => rng.int(5, 1)).toThrow(RangeError);
    });

    it('is unbiased across 6 buckets over 1e5 draws (chi-square smoke test)', () => {
      const rng = createRng(2024);
      const buckets: number[] = [0, 0, 0, 0, 0, 0];
      const draws = 100_000;
      for (let i = 0; i < draws; i++) {
        const index = rng.int(0, 5);
        buckets[index] = (buckets[index] ?? 0) + 1;
      }
      const expected = draws / buckets.length;
      const chiSquare = buckets.reduce(
        (sum, observed) => sum + (observed - expected) ** 2 / expected,
        0,
      );
      // chi-square critical value for 5 degrees of freedom at p = 0.001 is 20.515;
      // a healthy PRNG sits far below this even on an unlucky run.
      expect(chiSquare).toBeLessThan(20.515);
    });
  });

  describe('uniform', () => {
    it('returns floats in [min, max)', () => {
      const rng = createRng(3);
      for (let i = 0; i < 2000; i++) {
        const value = rng.uniform(-5, 5);
        expect(value).toBeGreaterThanOrEqual(-5);
        expect(value).toBeLessThan(5);
      }
    });

    it('rejects min > max', () => {
      const rng = createRng(1);
      expect(() => rng.uniform(5, 1)).toThrow(RangeError);
    });
  });

  describe('pick', () => {
    it('always returns an element of the array', () => {
      const rng = createRng(9);
      const items = ['a', 'b', 'c'] as const;
      for (let i = 0; i < 200; i++) {
        expect(items).toContain(rng.pick(items));
      }
    });

    it('draws every element given enough draws', () => {
      const rng = createRng(9);
      const items = ['a', 'b', 'c'];
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
      expect(seen).toEqual(new Set(items));
    });

    it('rejects an empty array', () => {
      const rng = createRng(1);
      expect(() => rng.pick([])).toThrow(RangeError);
    });
  });

  describe('child', () => {
    it('is independent of how many draws the parent made before calling child', () => {
      const fresh = createRng('match-42');
      const freshChild = fresh.child('leg:1');
      const freshChildValues = Array.from({ length: 10 }, () => freshChild.float());

      const used = createRng('match-42');
      for (let i = 0; i < 500; i++) used.float();
      const usedChild = used.child('leg:1');
      const usedChildValues = Array.from({ length: 10 }, () => usedChild.float());

      expect(usedChildValues).toEqual(freshChildValues);
    });

    it('different labels produce independent (different) sequences', () => {
      const rng = createRng('match-42');
      const leg1 = rng.child('leg:1');
      const leg2 = rng.child('leg:2');
      expect(leg1.float()).not.toBe(leg2.float());
    });

    it('a child is itself deterministic and can have its own children', () => {
      const grandchildA = createRng('match-42').child('leg:1').child('encounter:0');
      const grandchildB = createRng('match-42').child('leg:1').child('encounter:0');
      expect(grandchildA.float()).toBe(grandchildB.float());
    });
  });
});
