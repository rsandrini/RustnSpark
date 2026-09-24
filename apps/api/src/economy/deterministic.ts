import { createHash } from 'node:crypto';

const UINT32_MAX = 0xffffffff;

// Deterministic unit roll in [0, 1] from any string key (D25 used offers, S8.5
// scavenging): sha256 → first 4 bytes as uint32, scaled by 2^32-1 so the full
// uint32 range maps onto [0, 1]. No Math.random anywhere in economy code —
// same inputs always produce the same outcome for a given world seed.
export function stableUnit(input: string): number {
  const digest = createHash('sha256').update(input).digest();
  return digest.readUInt32BE(0) / UINT32_MAX;
}
