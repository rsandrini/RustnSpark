import { createHash } from 'node:crypto';

const UINT32_MAX = 0xffffffff;

// Deterministic unit roll in [0, 1] from any string key (D25 used offers, S8.5
// scavenging): sha256 → first 4 bytes as uint32, scaled by 2^32-1 so the full
// uint32 range maps onto [0, 1]. No Math.random anywhere in economy code —
// same inputs always produce the same outcome for a given world seed.
//
// The roll is a pure function of its key, and the market asks for the same keys over and over
// (every shelf of every port, every day), so repeats are served from a bounded memo: hashing was
// close to half of a simulated run.
const MEMO_LIMIT = 200_000;
const memo = new Map<string, number>();

export function stableUnit(input: string): number {
  const cached = memo.get(input);
  if (cached !== undefined) return cached;
  const digest = createHash('sha256').update(input).digest();
  const unit = digest.readUInt32BE(0) / UINT32_MAX;
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(input, unit);
  return unit;
}
