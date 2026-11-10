import type { DialogueNode, GiverRef, LocalizedText } from '../../api/generated';
import i18n from '../../i18n';
import { PROLOGUE_STEPS, type StepId } from './prologue-state';

/** The people who speak in the opening. The name is not translated; the title is (see `prologue.script.guides`). */
export type GuideId = 'friend' | 'rescuer' | 'harbour';

const NEUTRAL = 'neutro';

/** A line in both languages, read from the translation files (the dialogue box picks the language itself). */
export function localized(key: string): LocalizedText {
  return { en: i18n.t(key, { lng: 'en' }), 'pt-BR': i18n.t(key, { lng: 'pt-BR' }) };
}

export function giverOf(guide: GuideId): GiverRef {
  return {
    id: `prologue-${guide}`,
    name: i18n.t(`prologue.script.guides.${guide}.name`, { lng: 'en' }),
    title: localized(`prologue.script.guides.${guide}.title`),
    role: 'MENTOR',
    factionId: NEUTRAL,
    portraitUrl: null,
  };
}

/** One dialogue node per line key; the last one ends the conversation. Non-blocking, so the screen stays usable. */
export function nodesOf(lineKeys: readonly string[]): DialogueNode[] {
  return lineKeys.map((key, index) => ({
    id: key,
    text: localized(key),
    position: 'bottom',
    anchor: null,
    blocking: false,
    next: index < lineKeys.length - 1 ? (lineKeys[index + 1] ?? null) : null,
    choices: [],
  }));
}

/**
 * The credits the pilot has at a step: nothing until the race pays, then each payout as its job is done. The
 * ship's loss costs nothing (the money is kept), so it stays at the total from the final run on.
 */
export function creditsAt(step: StepId, payouts: readonly number[]): number {
  const at = PROLOGUE_STEPS.indexOf(step);
  const [race = 0, first = 0, second = 0] = payouts;
  let credits = 0;
  if (at >= PROLOGUE_STEPS.indexOf('stop-one')) credits += race;
  if (at >= PROLOGUE_STEPS.indexOf('fit-cargo')) credits += first;
  if (at >= PROLOGUE_STEPS.indexOf('final-board')) credits += second;
  return credits;
}
