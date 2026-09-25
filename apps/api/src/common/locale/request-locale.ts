import { parseLocale, type Locale } from './locale.js';

/**
 * Resolves the locale for a player-facing request (S9.2): an explicit
 * `?locale=` parameter wins, otherwise the player's saved locale, otherwise
 * the default. Extracted from `parts.service.catalogForPlayer` so the reports
 * layer (S9.2) reuses this exact resolver instead of copying its precedence
 * rules — one definition, two callers.
 */
export function resolveRequestLocale(
  explicit: string | undefined,
  saved: string | undefined,
): Locale {
  return explicit !== undefined ? parseLocale(explicit) : parseLocale(saved);
}
