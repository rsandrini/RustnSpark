export interface MissionSeedInput {
  readonly locationId: string;
  readonly epoch: number;
  readonly configVersion: number;
}

/**
 * Deterministic board seed (S6.2): generation is a pure function of
 * (location, epoch, config version). The returned string is exactly what
 * MissionInstance.seed stores and what createRng() must receive verbatim —
 * never coerce it to a number or the stream changes.
 */
export function missionSeed(input: MissionSeedInput): string {
  return `${input.locationId}|${input.epoch}|v${input.configVersion}`;
}
