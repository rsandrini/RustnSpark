import type { LocalizedText } from '../api/generated';

/**
 * The text of a `{ en, 'pt-BR' }` pair for the active language, English when the
 * requested one is missing or empty. One definition instead of an `as unknown as` cast
 * at every call site.
 */
export function pickLocalized(text: LocalizedText, language: string): string {
  const preferred = language === 'pt-BR' ? text['pt-BR'] : text.en;
  return preferred !== '' && preferred !== undefined ? preferred : text.en;
}
