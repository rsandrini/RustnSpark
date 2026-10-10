import type { ActiveMission, MissionOffer } from '../../api/generated';

/**
 * An active mission as the board card reads it: the same figures an offer carries (time, fuel,
 * requirements, material, race), with no eligibility verdict (the mission is already taken).
 * Null when the server sent no details for it.
 */
export function activeAsOffer(mission: ActiveMission): MissionOffer | null {
  if (mission.info === undefined) return null;
  return {
    ...mission,
    info: mission.info,
    rewardEstimate: mission.reward,
    eligibility: { eligible: true, reasons: [] },
  };
}
