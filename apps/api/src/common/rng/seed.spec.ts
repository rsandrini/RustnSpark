import { describe, expect, it } from '@jest/globals';
import { deriveSeed } from './seed.js';

describe('deriveSeed', () => {
  it('is a pure function: same parent and label always derive the same seed', () => {
    expect(deriveSeed('match-42', 'leg:1')).toBe(deriveSeed('match-42', 'leg:1'));
    expect(deriveSeed(12345, 'leg:1')).toBe(deriveSeed(12345, 'leg:1'));
  });

  it('returns a non-negative safe integer', () => {
    const seed = deriveSeed('match-42', 'leg:1');
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
  });

  it('different labels derive different seeds from the same parent', () => {
    expect(deriveSeed('match-42', 'leg:1')).not.toBe(deriveSeed('match-42', 'leg:2'));
  });

  it('different parents derive different seeds for the same label', () => {
    expect(deriveSeed('match-42', 'leg:1')).not.toBe(deriveSeed('match-43', 'leg:1'));
  });

  it('does not collide across the parent/label boundary (e.g. "1"+"23" vs "12"+"3")', () => {
    expect(deriveSeed('1', '23')).not.toBe(deriveSeed('12', '3'));
  });

  it('hashes a known input to a stable golden value (guards against accidental algorithm drift)', () => {
    expect(deriveSeed('match-42', 'leg:1')).toBe(7692919795394409);
  });

  it('hashes a known numeric parent to a stable golden value', () => {
    expect(deriveSeed(42, 'root')).toBe(2202723198011727);
  });
});
