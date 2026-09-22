import { sfc32 } from './sfc32.rng.js';
import { deriveSeed } from './seed.js';

/** Seeded, deterministic random source. Rules receive one of these; they never call Math.random. */
export interface Rng {
  /** Uniform float in [0, 1). */
  float(): number;
  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Independent Rng derived from this one's root seed and a label, regardless of prior draws. */
  child(label: string): Rng;
}

/**
 * splitmix32: avalanches one seed number into four well-mixed 32-bit words to seed sfc32's state.
 * deriveSeed can return up to ~53 bits, so the seed is split into low/high 32-bit halves and both
 * are mixed into every step; using only the low 32 bits would collapse deriveSeed's full range
 * down to a 2^32 collision space for every derived (child) seed.
 */
function expandSeed(seed: number): [number, number, number, number] {
  const high = Math.floor(seed / 4294967296) >>> 0;
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state ^ high;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

/** Builds a seeded Rng. A string seed is hashed via deriveSeed; a number seed is used directly. */
export function createRng(seed: number | string): Rng {
  const rootSeed = typeof seed === 'string' ? deriveSeed(seed, 'root') : seed;
  const [a, b, c, d] = expandSeed(rootSeed);
  const next = sfc32(a, b, c, d);

  // sfc32 needs a short warm-up after seeding for its state to fully mix; 15 is the common practice.
  for (let i = 0; i < 15; i++) next();

  const rng: Rng = {
    float(): number {
      return next();
    },
    int(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new RangeError('Rng.int requires integer bounds');
      }
      if (min > max) {
        throw new RangeError('Rng.int requires min <= max');
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    uniform(min: number, max: number): number {
      if (min > max) {
        throw new RangeError('Rng.uniform requires min <= max');
      }
      return min + next() * (max - min);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('Rng.pick requires a non-empty array');
      }
      const item = items[rng.int(0, items.length - 1)];
      if (item === undefined) {
        throw new RangeError('Rng.pick index out of range');
      }
      return item;
    },
    child(label: string): Rng {
      return createRng(deriveSeed(rootSeed, label));
    },
  };

  return rng;
}
