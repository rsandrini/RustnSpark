/**
 * How the pilot orders a board of qualifying offers (plan Phase 4.1). The playstyle filters
 * which types fly at all; the temperament decides between what is left. Every temperament is
 * deterministic on the offers in hand — only `random` draws, from the run's seeded stream.
 */
import { missionDuration } from '../../src/missions/duration.calculator.js';
import { refuelCost } from '../../src/economy/fuel-cost.calculator.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type { MissionContext } from '../actions/mission.js';
import { missionFuelNeed } from './policy.js';
import { installedParts, type PlayerState } from '../core/state.js';
import type { Rng } from '../core/rng.js';
import type { Offer } from '../core/world.js';
import { portFactsOf } from '../core/world.js';

export type Temperament = 'greedy' | 'balanced' | 'safe' | 'random';

/** An unknown temperament string is the random pilot — the run's historical default. */
export function temperamentOf(raw: string): Temperament {
  switch (raw) {
    case 'greedy':
    case 'balanced':
    case 'safe':
    case 'random':
      return raw;
    default:
      return 'random';
  }
}

function peakDangerOf(offer: Offer): number {
  return offer.legs.reduce((peak, leg) => Math.max(peak, leg.danger), 0);
}

function peakZoneOf(offer: Offer): number {
  return offer.legs.reduce((peak, leg) => Math.max(peak, leg.zone), 0);
}

function totalDistanceOf(offer: Offer): number {
  return offer.legs.reduce((sum, leg) => sum + leg.distance, 0);
}

/** What one offer would earn per hour of trip, after the fuel the trip is expected to burn. */
function netPerHour(
  state: PlayerState,
  ctx: MissionContext,
  offer: Offer,
): number {
  const sheet = deriveSheet(installedParts(state.ship, ctx.catalogByType), ctx.rules);
  const { durationSeconds } = missionDuration({
    totalDistance: totalDistanceOf(offer),
    mobility: sheet.mob,
    durationK: ctx.rules.missions.duration_k,
    shortTripBelow: ctx.rules.missions.short_trip_below,
    shortTripMinSeconds: ctx.rules.missions.short_trip_min_seconds,
    timeScale: ctx.rules.missions.time_scale,
    classCutoffs: ctx.rules.missions.duration_class_cutoffs,
  });
  const units = missionFuelNeed(state, offer, ctx);
  const facts = portFactsOf(ctx.snapshot, state.locationId, state.factionId);
  const fuel = refuelCost(units, facts.isolation, facts.factionRelation, ctx.rules);
  const net = offer.reward - fuel;
  return durationSeconds <= 0 ? net : net / (durationSeconds / 3600);
}

/**
 * Pick one offer from `offers` (already filtered to what the ship can take and the danger rule
 * allows) under the given temperament.
 */
export function chooseOffer(
  temperament: Temperament,
  offers: readonly Offer[],
  state: PlayerState,
  ctx: MissionContext,
  rng: Rng,
): Offer {
  const first = offers[0];
  if (first === undefined) {
    throw new Error('chooseOffer needs at least one offer');
  }
  if (offers.length === 1) return first;
  switch (temperament) {
    case 'random':
      return rng.child(`pick-${state.missionsDone}`).pick(offers);
    case 'greedy': {
      let best = first;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const offer of offers) {
        const score = netPerHour(state, ctx, offer);
        if (
          score > bestScore ||
          (score === bestScore &&
            (peakDangerOf(offer) < peakDangerOf(best) ||
              (peakDangerOf(offer) === peakDangerOf(best) && offer.id < best.id)))
        ) {
          best = offer;
          bestScore = score;
        }
      }
      return best;
    }
    case 'balanced': {
      // Below the top risk band, the median offer by reward — the cautious middle, not the
      // richest job on the board. When every offer shares one band, the band is everything.
      const band = offers.reduce((peak, offer) => Math.max(peak, peakDangerOf(offer)), 0);
      const calmer = offers.filter((offer) => peakDangerOf(offer) < band);
      const pool = calmer.length > 0 ? calmer : offers;
      const byReward = [...pool].sort(
        (left, right) => left.reward - right.reward || (left.id < right.id ? -1 : 1),
      );
      return byReward[Math.floor((byReward.length - 1) / 2)] ?? first;
    }
    case 'safe': {
      const byRisk = [...offers].sort(
        (left, right) =>
          peakDangerOf(left) - peakDangerOf(right) ||
          peakZoneOf(left) - peakZoneOf(right) ||
          right.reward - left.reward ||
          (left.id < right.id ? -1 : 1),
      );
      return byRisk[0] ?? first;
    }
  }
}
