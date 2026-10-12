/**
 * The simulation's random source: the game's own seeded RNG, re-exported. Every random choice in
 * the sim draws from a named child stream (`createRng(seed).child('label')`) so a run is exactly
 * reproducible from its seed — `Math.random` is banned in the sim for the same reason it is banned
 * in `src`.
 */
export { createRng } from '../../src/common/rng/rng.js';
export type { Rng } from '../../src/common/rng/rng.js';
