import type { PublicProfileResponse } from '../../api/generated';

export interface PilotNumbers {
  missions: number;
  successPct: number | null;
  distance: number;
  fightsWon: number;
  raceWins: number;
  bestRacePlace: number | null;
  hasFlown: boolean;
}

/** The public numbers of a pilot's card, with absent totals read as zero. successPct is the 0..1 rate (null when unknown). */
export function pilotNumbersOf(profile: PublicProfileResponse): PilotNumbers {
  const totals = profile.totals;
  const missions = totals['missions.started'] ?? 0;
  return {
    missions,
    successPct: profile.successRate,
    distance: totals['flight.distance'] ?? 0,
    fightsWon: totals['fights.won'] ?? 0,
    raceWins: totals['races.won'] ?? 0,
    bestRacePlace: profile.records['best.race_place']?.value ?? null,
    hasFlown: missions > 0,
  };
}
