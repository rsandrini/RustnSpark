import type { Locale } from './locale.js';

/**
 * Picks a locale's string from a bilingual JSON row (`{ en, "pt-BR" }` — the
 * shape every catalog/material `displayName` uses), falling back to English.
 * Shared by `parts.service` (extracted there, S9.3) and the reports layer so
 * catalog names render identically wherever they appear (D38).
 */
export function localizeDisplayName(value: Record<string, unknown>, locale: Locale): string {
  const candidate = value[locale] ?? value['en'];
  return typeof candidate === 'string' ? candidate : '';
}
