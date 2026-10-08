import type { MissionInstance } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import { rewardBase } from '../economy/reward.calculator.js';

interface RewardLeg {
  readonly distance: number;
  readonly danger: number;
}

// The board's estimate (viewer's tier, D29 preview) and accept-time finalization
// (the accepting ship's tier, D29) are the same formula over the stored legs.
export function missionReward(
  row: Pick<MissionInstance, 'legs' | 'type'>,
  tier: number,
  rules: GameRules,
): number {
  const legs = (Array.isArray(row.legs) ? row.legs : []) as unknown as RewardLeg[];
  const totalDistance = legs.reduce((sum, leg) => sum + (leg.distance ?? 0), 0);
  const maxDanger = legs.reduce(
    (peak, leg) => ((leg.danger ?? 0) > peak ? (leg.danger ?? 0) : peak),
    0,
  );
  // A race's board figure is the winner's prize (place 1); the real payout follows the place.
  const topPrize = row.type === 'RACE' ? rules.race.prize_share_1 : 1;
  return Math.round(
    rewardBase({ tier, danger: maxDanger, distance: totalDistance, missionType: row.type }, rules) *
      topPrize,
  );
}
