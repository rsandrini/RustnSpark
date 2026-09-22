/**
 * sfc32 ("Small Fast Counter", 32-bit): Chris Doty-Humphrey's PRNG from the PractRand test suite.
 * Four 32-bit words of state, ~2^128 period, pure integer arithmetic only.
 * Deterministic and dependency-free: identical state always produces the identical sequence,
 * on any Node version or platform, because every operation is spec-guaranteed 32-bit math.
 */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  let stateA = a >>> 0;
  let stateB = b >>> 0;
  let stateC = c >>> 0;
  let stateD = d >>> 0;

  return function next(): number {
    let t = (stateA + stateB) | 0;
    stateA = stateB ^ (stateB >>> 9);
    stateB = (stateC + (stateC << 3)) | 0;
    stateC = (stateC << 21) | (stateC >>> 11);
    stateD = (stateD + 1) | 0;
    t = (t + stateD) | 0;
    stateC = (stateC + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
