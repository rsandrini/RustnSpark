// S7.2 (plan line 435): duration = round(distance / MOB × duration_k) × time_scale,
// with the round applied before time_scale. Class comes from the configured cutoffs
// (factory { fast: 600, medium: 1800 }); above every cutoff the class is "long".
export type DurationClass = 'fast' | 'medium' | 'long';

export interface MissionDurationInput {
  readonly totalDistance: number;
  readonly mobility: number;
  readonly durationK: number;
  readonly timeScale: number;
  readonly classCutoffs: Readonly<Record<string, number>>;
}

export interface MissionDuration {
  readonly durationSeconds: number;
  readonly durationClass: DurationClass;
}

function classify(seconds: number, cutoffs: Readonly<Record<string, number>>): DurationClass {
  const ordered = Object.entries(cutoffs).sort((a, b) => a[1] - b[1]);
  for (const [label, limit] of ordered) {
    if (seconds <= limit) return label as DurationClass;
  }
  return 'long';
}

export function missionDuration(input: MissionDurationInput): MissionDuration {
  const rounded = Math.round((input.totalDistance / input.mobility) * input.durationK);
  const durationSeconds = rounded * input.timeScale;
  return {
    durationSeconds,
    durationClass: classify(durationSeconds, input.classCutoffs),
  };
}
