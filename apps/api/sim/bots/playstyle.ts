/**
 * What kinds of work the pilot will fly at all (plan Phase 4.2). The playstyle filters the
 * board; the temperament orders what is left. A filter that empties the board is not a stall —
 * the pilot flies anything qualifying and the bot logs it as a `fallback`.
 */
import type { MissionTypeName } from '../snapshot/types.js';
import type { Offer } from '../core/world.js';

export type Playstyle = 'generalist' | 'hauler' | 'rescuer';

/** An unknown playstyle string flies everything — the run's historical default. */
export function playstyleOf(raw: string): Playstyle {
  switch (raw) {
    case 'generalist':
    case 'hauler':
    case 'rescuer':
      return raw;
    default:
      return 'generalist';
  }
}

const HAULER_TYPES: ReadonlySet<MissionTypeName> = new Set<MissionTypeName>([
  'DELIVERY',
  'TRANSPORT',
  'RACE',
]);

const RESCUER_TYPES: ReadonlySet<MissionTypeName> = new Set<MissionTypeName>([
  'RESCUE',
  'ESCORT',
]);

/**
 * The board, cut to the playstyle's types. `fallback` says the cut left nothing takeable and
 * the whole board was handed back — the caller flies it and says so in the log.
 */
export function filterForPlaystyle(
  playstyle: Playstyle,
  offers: readonly Offer[],
): { kept: readonly Offer[]; fallback: boolean } {
  if (playstyle === 'generalist') return { kept: offers, fallback: false };
  const wanted = playstyle === 'hauler' ? HAULER_TYPES : RESCUER_TYPES;
  const kept = offers.filter((offer) => wanted.has(offer.type));
  if (kept.length > 0) return { kept, fallback: false };
  return { kept: offers, fallback: offers.length > 0 };
}

/** The hauler never digs; every other job (and every other style) is free to. */
export function playstyleAllowsJob(playstyle: Playstyle, job: 'mining' | 'scavenge'): boolean {
  return !(playstyle === 'hauler' && job === 'mining');
}
