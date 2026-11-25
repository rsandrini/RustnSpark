import type { RankingBoard, RankingEntry } from '../../api/generated';

const FIRST = 1;
const SECOND = 2;
const THIRD = 3;

export interface Podium {
  first?: RankingEntry;
  second?: RankingEntry;
  third?: RankingEntry;
  rest: RankingEntry[];
}

/** Splits a ranking into the top three and the rest, by the server's rank. */
export function podiumOf(entries: readonly RankingEntry[]): Podium {
  const podium: Podium = { rest: [] };
  for (const entry of entries) {
    if (entry.rank === FIRST) podium.first = entry;
    else if (entry.rank === SECOND) podium.second = entry;
    else if (entry.rank === THIRD) podium.third = entry;
    else if (entry.rank > THIRD) podium.rest.push(entry);
  }
  podium.rest.sort((a, b) => a.rank - b.rank);
  return podium;
}

export type Gap = { kind: 'first' } | { kind: 'behind'; amount: number } | { kind: 'unknown' };

/**
 * How far the player is from the pilot just ahead. For race_time the amount
 * is the time to shave; a 0 amount means tied.
 */
export function gapToNext(input: {
  board: RankingBoard;
  entries: readonly RankingEntry[];
  me: { rank: number; value: number } | null;
}): Gap {
  const { entries, me } = input;
  if (!me) return { kind: 'unknown' };
  if (me.rank === FIRST) return { kind: 'first' };
  const ahead = entries.find((e) => e.rank === me.rank - 1);
  if (!ahead) return { kind: 'unknown' };
  return { kind: 'behind', amount: Math.abs(ahead.value - me.value) };
}
