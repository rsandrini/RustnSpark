import type { ActiveMission, MissionOffer } from '../../api/generated';

/**
 * An active mission as the board card reads it: the same figures an offer carries (time, fuel,
 * requirements, material, race), with the server's re-check of the ship (eligible when an older server sends none).
 * Null when the server sent no details for it.
 */
export function activeAsOffer(mission: ActiveMission): MissionOffer | null {
  if (mission.info === undefined) return null;
  return {
    ...mission,
    info: mission.info,
    rewardEstimate: mission.reward,
    eligibility: mission.eligibility ?? { eligible: true, reasons: [] },
  };
}
