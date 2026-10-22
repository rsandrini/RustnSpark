import type { SceneData, Trigger } from './scenes.js';

/** The pilot's own records a scene's trigger reads. */
export interface DialogueFacts {
  /** Has chosen a faction. */
  readonly onboarded: boolean;
  /** Their ship has its parts laid out. */
  readonly shipBuilt: boolean;
  /** Missions finished (done or failed, any type but the pilot's own jobs). */
  readonly completed: number;
  readonly failed: number;
  /** Fuel aboard over the tank's size; null without a ship. */
  readonly tankFraction: number | null;
  /** The checklist's action steps, from the pilot's own records. */
  readonly refuelled: boolean;
  readonly missionTaken: boolean;
  readonly dispatched: boolean;
  readonly repaired: boolean;
  readonly worked: boolean;
  /** A flight of theirs has met pirates (a fight, an escape or a demand). */
  readonly metPirates: boolean;
  /** They have collected scrap at least once. */
  readonly foundScrap: boolean;
}

/** Below this share of the tank, after a first flight, the mentor says something about fuel. */
export const LOW_TANK_FRACTION = 0.3;

export function triggerHolds(trigger: Trigger, facts: DialogueFacts): boolean {
  switch (trigger) {
    case 'onboarded':
      return facts.onboarded;
    case 'ship_built':
      return facts.onboarded && facts.shipBuilt;
    case 'first_mission_done':
      return facts.completed >= 1;
    case 'first_failure':
      return facts.failed >= 1;
    case 'needs_fuel':
      return facts.onboarded && facts.shipBuilt && !facts.refuelled;
    case 'ready_for_mission':
      return facts.refuelled && !facts.missionTaken && facts.completed === 0;
    case 'mission_taken':
      return facts.missionTaken && !facts.dispatched;
    case 'repair_due':
      return facts.completed >= 1 && !facts.repaired;
    case 'work_due':
      return facts.completed >= 1 && facts.repaired && !facts.worked;
    case 'checklist_done':
      return facts.completed >= 1 && facts.repaired && facts.worked;
    case 'first_pirates':
      return facts.metPirates;
    case 'first_scrap':
      return facts.foundScrap;
    case 'low_fuel':
      return (
        facts.completed >= 1 &&
        facts.tankFraction !== null &&
        facts.tankFraction < LOW_TANK_FRACTION
      );
  }
}

export type SceneStatus = 'OPEN' | 'SKIPPED' | 'DONE' | 'REPLAY';

export interface SceneProgress {
  readonly sceneId: string;
  readonly status: SceneStatus;
  readonly nodeId: string | null;
}

/**
 * The scene due now, or undefined. A scene the pilot asked to hear again comes first, then one they left half-way,
 * then the lowest-`order` scene whose trigger holds and that they have never started. One at a time. A pilot who
 * has finished missions without ever being welcomed (they predate the mentor) gets no new scenes.
 */
export function dueScene(
  scenes: readonly SceneData[],
  progress: readonly SceneProgress[],
  facts: DialogueFacts,
): { scene: SceneData; resumeAt: string | null } | undefined {
  const byScene = new Map(progress.map((entry) => [entry.sceneId, entry]));
  const known = [...scenes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  for (const status of ['REPLAY', 'OPEN'] as const) {
    const found = known.find((scene) => byScene.get(scene.id)?.status === status);
    if (found !== undefined) {
      const saved = byScene.get(found.id)?.nodeId ?? null;
      const resumeAt =
        saved !== null && found.nodes.some((node) => node.id === saved) ? saved : null;
      return { scene: found, resumeAt };
    }
  }
  // A pilot who flew before the mentor existed never heard the introduction: the "first time" scenes would make no
  // sense to them, so the series does not start for a pilot who has finished missions and was never welcomed.
  const intro = known[0];
  if (intro !== undefined && !byScene.has(intro.id) && facts.completed >= 1) return undefined;
  const fresh = known.find((scene) => !byScene.has(scene.id) && triggerHolds(scene.trigger, facts));
  return fresh === undefined ? undefined : { scene: fresh, resumeAt: null };
}
