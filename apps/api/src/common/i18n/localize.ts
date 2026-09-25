// Picks one locale out of a stored `{ en, 'pt-BR' }` display-name JSON, falling back to
// English and then to an empty string so a malformed row never breaks a listing.
export function localize(value: unknown, locale = 'en'): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const candidate = record[locale] ?? record['en'];
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}
