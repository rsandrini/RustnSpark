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

/**
 * One dialogue node per line key; the last one ends the conversation. Blocking: the screen behind is dimmed until the
 * line is read, so the box never sits over a button the pilot is about to press.
 */
export function nodesOf(lineKeys: readonly string[]): DialogueNode[] {
  return lineKeys.map((key, index) => ({
    id: key,
    text: localized(key),
    position: 'bottom',
    anchor: null,
    blocking: true,
    next: index < lineKeys.length - 1 ? (lineKeys[index + 1] ?? null) : null,
    choices: [],
  }));
}

/**
 * The credits the pilot has at a step: nothing until the race pays, then each payout as its job is done, less the
 * refuel. The payouts cover the refuel, so the pilot ends with exactly the start credits. The ship's loss costs
 * nothing (the money is kept), so it stays at that total from the final run on.
 */
export function creditsAt(
  step: StepId,
  payouts: readonly number[],
  refuelCost = 0,
  refuelled = false,
): number {
  const at = PROLOGUE_STEPS.indexOf(step);
  const [race = 0, first = 0, second = 0] = payouts;
  let credits = 0;
  if (at >= PROLOGUE_STEPS.indexOf('stop-one')) credits += race;
  if (at >= PROLOGUE_STEPS.indexOf('fit-cargo')) credits += first;
  if (at >= PROLOGUE_STEPS.indexOf('final-board')) credits += second;
  // the refuel at the first stop is paid for: from the next step on it is always spent
  if (refuelled || at > PROLOGUE_STEPS.indexOf('stop-one')) credits -= refuelCost;
  return credits;
}
