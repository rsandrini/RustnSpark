import type { Offer } from '../core/world.js';

/**
 * What a careful pilot learns from experience and a one-run bot has to be told: how much a trip
 * is going to cost in wear (and so in repair money) before flying it, and which trips already
 * stranded the ship. The bot used to fly the best reward per hour whatever it did to the hull, then
 * repeat a trip that had just run it dry.
 */

/** One flown mission as the bot remembers it. */
export interface WearSample {
  readonly distance: number;
  readonly danger: number;
  readonly wearPoints: number;
}

/** Wear points per unit of distance assumed before the run has any sample. */
export const FALLBACK_WEAR_PER_DISTANCE = 0.12;
/** Repair credits per condition point assumed before the run has any quote. */
export const FALLBACK_REPAIR_PER_POINT = 6;
/** A trip is only worth it when the repair it will cost stays under this share of its reward. */
export const MAX_WEAR_COST_SHARE = 0.6;
/** Samples of a similar danger (within this many points) are weighed first. */
const DANGER_BAND = 2;

function totalDistance(offer: Offer): number {
  return offer.legs.reduce((sum, leg) => sum + leg.distance, 0);
}

function peakDanger(offer: Offer): number {
  return offer.legs.reduce((peak, leg) => Math.max(peak, leg.danger), 0);
}

/** Wear points per unit distance, from the missions of similar danger (else all of them). */
export function wearRate(samples: readonly WearSample[], danger: number): number {
  const similar = samples.filter((sample) => Math.abs(sample.danger - danger) <= DANGER_BAND);
  const pool = similar.length >= 2 ? similar : samples;
  const distance = pool.reduce((sum, sample) => sum + sample.distance, 0);
  if (distance <= 0) return FALLBACK_WEAR_PER_DISTANCE;
  return pool.reduce((sum, sample) => sum + sample.wearPoints, 0) / distance;
}

/** The wear points this offer is expected to cost the ship. */
export function expectedWear(offer: Offer, samples: readonly WearSample[]): number {
  return wearRate(samples, peakDanger(offer)) * totalDistance(offer);
}

/** Whether flying the offer pays: its expected repair bill stays a fraction of its reward. */
export function isWorthFlying(
  offer: Offer,
  samples: readonly WearSample[],
  repairPerPoint: number,
): boolean {
  const bill = expectedWear(offer, samples) * Math.max(0, repairPerPoint);
  return bill <= offer.reward * MAX_WEAR_COST_SHARE;
}

/** The key a trip is remembered by (the same place to place, same kind of work). */
export function tripKey(offer: Pick<Offer, 'type' | 'originId' | 'destinationId'>): string {
  return `${offer.type}|${offer.originId}|${offer.destinationId}`;
}
