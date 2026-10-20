// FNV-1a: a tiny stable string hash (the same offer must read the same on every visit).
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** A line in both languages. */
export interface VoiceLine {
  readonly en: string;
  readonly 'pt-BR': string;
}

export type VoicePools = Readonly<Record<string, readonly VoiceLine[]>>;

/** The values a line may name: `{origin}` `{destination}` `{cargo}` `{reward}`, per language. */
export type VoiceValues = Readonly<Record<'en' | 'pt-BR', Readonly<Record<string, string>>>>;

const isLine = (value: unknown): value is VoiceLine => {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return typeof line.en === 'string' && typeof line['pt-BR'] === 'string';
};

/** The pools of a giver's `lines` column; anything malformed (it is Admin-edited) is skipped, never thrown. */
export function parsePools(raw: unknown): VoicePools {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const pools: Record<string, VoiceLine[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    const lines = value.filter(isLine).filter((line) => line.en.trim() !== '');
    if (lines.length > 0) pools[key] = lines;
  }
  return pools;
}

/** A stable pick from a pool: the same seed always gives the same line (an offer reads the same on every visit). */
export function pickLine(pools: VoicePools, key: string, seed: string): VoiceLine | undefined {
  const pool = pools[key];
  if (pool === undefined || pool.length === 0) return undefined;
  let hash = FNV_OFFSET;
  for (const char of `${key}|${seed}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), FNV_PRIME) >>> 0;
  }
  return pool[hash % pool.length];
}

/** Replace `{name}` with the language's value; a name with no value stays as written (visible in review). */
export function fillLine(line: VoiceLine, values: VoiceValues): VoiceLine {
  const fill = (text: string, language: 'en' | 'pt-BR'): string =>
    text.replace(/\{(\w+)\}/g, (whole, name: string) => values[language][name] ?? whole);
  return { en: fill(line.en, 'en'), 'pt-BR': fill(line['pt-BR'], 'pt-BR') };
}

/**
 * The words of a giver for one moment: a line of `key`, filled, else the fallback (the template's own text).
 * An empty second language falls back too, so a half-written line never shows a blank in one language.
 */
export function voiced(
  pools: VoicePools,
  key: string,
  seed: string,
  values: VoiceValues,
  fallback: VoiceLine,
): VoiceLine {
  const line = pickLine(pools, key, seed);
  if (line === undefined || line['pt-BR'].trim() === '') return fallback;
  return fillLine(line, values);
}
