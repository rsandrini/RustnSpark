import type { TFunction } from 'i18next';

/** The text of a blocker/fault code: the board's own wording, else the ship screen's problem text,
    else the API error text, else the server's message. One chain for the card chip, the details card
    and the board's fault line, so a code reads the same (and in the pilot's language) everywhere. */
export function reasonLabel(t: TFunction, code: string, message: string): string {
  return t(`board.reasons.${code}`, {
    defaultValue: t(`hangar.problems.${code}`, {
      defaultValue: t(`error.${code}`, { defaultValue: message }),
    }),
  });
}
