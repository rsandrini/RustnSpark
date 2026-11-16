import type { DialogueNode, GiverRef, PrologueScene } from '../../../api/generated';

/** A scene as the opening's endpoint sends it: the lines plus the trigger and order the Admin gave it. */
export type GuideScene = PrologueScene;

export interface Guide {
  readonly giver: GiverRef;
  readonly scenes: readonly GuideScene[];
}

/** One scene ready to be spoken: who says it and what. */
export interface Spoken {
  readonly key: string;
  readonly giver: GiverRef;
  readonly scene: GuideScene;
}

/** The moments of the story a line can be hung on: entering a step, leaving it, or a leg of the race. */
export type Moment = `prologue_${string}`;

export const enterOf = (step: string): Moment => `prologue_${step}_enter`;
export const doneOf = (step: string): Moment => `prologue_${step}_done`;
export const legOf = (leg: number): Moment => `prologue_race_leg_${leg}`;
/** The final run's radio: the pirates strike on its second leg. */
/** The final run's radar: the friend sees movement ahead, halfway through the leg the pirates strike on. */
export const radarOf = (): Moment => 'prologue_final-run_radar';
export const finalLegOf = (leg: number): Moment => `prologue_final-run_leg_${leg}`;

/**
 * The scenes hung on a moment, in the order the Admin gave them, from every guide. A moment with no scene gives an
 * empty list: the story simply goes on, so the Admin can remove any line without stopping the pilot.
 */
export function scenesFor(guides: readonly Guide[], moment: Moment): Spoken[] {
  return guides
    .flatMap((guide) =>
      guide.scenes
        .filter((scene) => scene.trigger === moment && scene.nodes.length > 0)
        .map((scene) => ({
          order: scene.order,
          spoken: { key: `${guide.giver.id}:${scene.id}`, giver: guide.giver, scene },
        })),
    )
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.spoken);
}

/** The friend: whoever speaks first in the story. Their name is on the race table and in the reports. */
export function friendOf(guides: readonly Guide[]): GiverRef | null {
  return scenesFor(guides, enterOf('gift'))[0]?.giver ?? null;
}

/** The node a scene opens on (a missing start falls back to the first node). */
export function startNode(scene: Pick<GuideScene, 'nodes' | 'start'>): DialogueNode | null {
  return scene.nodes.find((node) => node.id === scene.start) ?? scene.nodes[0] ?? null;
}
