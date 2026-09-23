// Player-facing locales ship in both English and Brazilian Portuguese from v0.1 (D22). The API
// never translates; this module only decides which locale a request/profile resolves to.
export const SUPPORTED_LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

interface WeightedTag {
  tag: string;
  q: number;
}

// Resolves an Accept-Language header to a supported locale: tags are matched case-insensitively
// by primary subtag (`pt-PT` → `pt-BR`, `en-US` → `en`), honoring q-values; anything unsupported,
// unacceptable (q=0) or absent falls back to the default.
export function resolveLocaleFromHeader(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const { tag } of parseAcceptLanguage(header)) {
    const locale = matchSupportedLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

function parseAcceptLanguage(header: string): WeightedTag[] {
  const tags: WeightedTag[] = [];
  for (const part of header.split(',')) {
    const [rawTag = '', ...params] = part.split(';');
    const tag = rawTag.trim().toLowerCase();
    if (tag === '' || tag === '*') continue;
    const q = parseQuality(params);
    if (q === null) continue;
    tags.push({ tag, q });
  }
  // Stable (ES2019+): ties keep the header's own preference order.
  return tags.sort((a, b) => b.q - a.q);
}

function parseQuality(params: string[]): number | null {
  const qParam = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
  if (qParam === undefined) return 1;
  const q = Number(qParam.slice(2));
  // q=0 (or garbage) marks the tag as unacceptable rather than "lowest priority".
  return Number.isFinite(q) && q > 0 ? q : null;
}

function matchSupportedLocale(tag: string): Locale | undefined {
  const primary = tag.split('-')[0];
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'en') return 'en';
  return undefined;
}

// Parses an explicit locale parameter; unsupported or empty values fall back to the default.
export function parseLocale(value: string | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pt-br' || normalized === 'pt') return 'pt-BR';
  if (normalized === 'en') return 'en';
  return DEFAULT_LOCALE;
}
