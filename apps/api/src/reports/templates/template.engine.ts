/**
 * Deterministic report-template engine (plan S9.2 / D34).
 *
 * Templates are repo JSON files (one per event type per locale — editing
 * wording requires a deploy, by owner decision D34). The engine picks a
 * variant from `deriveSeed(seed, 'narr:' + eventIndex)` where `eventIndex` is
 * the event's position in the STORED array (never a display-sorted position),
 * so the same log always narrates the same way.
 *
 * Output is the D39 wire format: a line is `{ text, segments }` where `text`
 * is the concatenation of the segments and entity placeholders (`{part}`,
 * `{material}`) become `ref` segments carrying live catalog names (D38).
 * Numbers go through a fixed formatter — never `Intl`/ICU — so bytes are
 * stable across Node builds; pt-BR only swaps the decimal separator.
 */
import { readFileSync } from 'node:fs';
import type { Locale } from '../../common/locale/locale.js';
import { deriveSeed } from '../../common/rng/seed.js';
import type { ParsedMissionEvent } from '../events/event.schema.js';

/** D39: a rendered line. `text` always equals the segments concatenated. */
export type ReportSegment =
  | { readonly t: 'text'; readonly value: string }
  | {
      readonly t: 'ref';
      readonly kind: 'part' | 'loot';
      readonly id: string;
      readonly value: string;
    };

export interface ReportLine {
  readonly text: string;
  readonly segments: readonly ReportSegment[];
}

/**
 * Live catalog names (D38): partType → localized display name, materialId →
 * localized display name. Supplied by the caller from the PartCatalog and
 * Material tables; unknown ids fall back to the raw id so a renamed/removed
 * catalog row still renders instead of breaking the report.
 */
export interface EntityNames {
  /**
   * Keyed by part INSTANCE id — the id events carry in `condByPart` — with the catalog type
   * (the stable key a detail popup looks up) and the localized name. Keying by part type here
   * would never match a real event and would print the raw instance id in the report.
   */
  readonly parts: Readonly<Record<string, { readonly partType: string; readonly name: string }>>;
  readonly materials: Readonly<Record<string, string>>;
  /** Catalog part type → localized name (scavenging finds name a TYPE, not an instance). */
  readonly partTypes?: Readonly<Record<string, string>>;
}

export const EMPTY_ENTITY_NAMES: EntityNames = { parts: {}, materials: {} };

/**
 * Fixed number formatting — deliberately not `Intl.NumberFormat` (S9.2): ICU
 * output varies with the bundled ICU build, which would break byte-identical
 * rendering. Integers render identically in every locale; only pt-BR's
 * decimal comma differs, and event numbers are integers from schemaVersion 2.
 */
export function formatNumber(value: number, locale: Locale): string {
  const text = Number.isFinite(value) ? String(value) : '0';
  return locale === 'pt-BR' ? text.replace('.', ',') : text;
}

/** Signed credits: `+754`, `-120`, `0` (report lines state movement explicitly). */
export function formatSigned(value: number, locale: Locale): string {
  const magnitude = formatNumber(Math.abs(value), locale);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `-${magnitude}`;
  return magnitude;
}

interface CachedFile {
  readonly data: unknown;
}

const templateCache = new Map<string, CachedFile>();

/** Test hook: forget loaded files so rewritten templates re-read from disk. */
export function clearTemplateCache(): void {
  templateCache.clear();
}

function candidateUrls(locale: Locale, file: string): URL[] {
  return [
    // Next to this module — source layout in tests, built layout once the
    // build step has copied the assets.
    new URL(`./${locale}/${file}.json`, import.meta.url),
    // Built layout without the copied assets (`nest start`): fall back to src/.
    new URL(`../../../src/reports/templates/${locale}/${file}.json`, import.meta.url),
  ];
}

function readTemplateJson(locale: Locale, file: string): unknown {
  const key = `${locale}/${file}`;
  const cached = templateCache.get(key);
  if (cached) return cached.data;

  const tried: string[] = [];
  let raw: string | undefined;
  for (const url of candidateUrls(locale, file)) {
    const path = url.pathname;
    if (tried.includes(path)) continue;
    tried.push(path);
    try {
      raw = readFileSync(url, 'utf8');
      break;
    } catch {
      // try the next candidate
    }
  }
  if (raw === undefined) {
    throw new Error(`Report template not found for ${key}; tried: ${tried.join(', ')}`);
  }
  const entry: CachedFile = { data: JSON.parse(raw) };
  templateCache.set(key, entry);
  return entry.data;
}

/**
 * Variants for one event type in one locale. Fails loudly if the file is
 * missing or malformed — a template gap is a deploy bug, never a silently
 * shorter report.
 */
export function loadTemplateVariants(locale: Locale, file: string): readonly string[] {
  const parsed = readTemplateJson(locale, file);
  const variants =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { variants?: unknown }).variants
      : undefined;
  if (
    !Array.isArray(variants) ||
    variants.length === 0 ||
    !variants.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new Error(`Report template ${locale}/${file} must be { "variants": [string, ...] }`);
  }
  return variants;
}

/**
 * Wording for logs stored before S9.0 (schemaVersion 1): the same event type
 * without any token that needs v2-only data (`{shield}`, `{armor}`, `{hull}`,
 * `{fuelLost}`). Empty when the type has no v2-only tokens. Rendering a v1 event
 * with the regular variants would print fabricated zeros, so those events draw
 * from this list instead.
 */
export function loadLegacyVariants(locale: Locale, file: string): readonly string[] {
  const parsed = readTemplateJson(locale, file);
  const legacy =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { legacy?: unknown }).legacy
      : undefined;
  if (legacy === undefined) return [];
  if (
    !Array.isArray(legacy) ||
    !legacy.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new Error(`Report template ${locale}/${file} "legacy" must be [string, ...]`);
  }
  return legacy;
}

/** Tokens whose value exists only on schemaVersion 2 events (S9.0). */
export const V2_ONLY_TOKENS: readonly string[] = ['shield', 'armor', 'hull', 'fuelLost'];

const CASCADE_EVENT_TYPES: readonly string[] = [
  'combat_win',
  'combat_loss',
  'combat_draw',
  'escort_absorbed',
];

/** True when the event predates S9.0 and lacks the data its regular variants print. */
export function lacksV2Data(event: ParsedMissionEvent): boolean {
  if (CASCADE_EVENT_TYPES.includes(event.type)) return event.cascade === undefined;
  if (event.type === 'tank') return event.fuelLost === undefined;
  return false;
}

/** The view-chrome file for a locale (S9.3): category/outcome/effect strings. */
export function loadViewChrome(locale: Locale): Readonly<Record<string, unknown>> {
  const data = readTemplateJson(locale, 'view');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Report template ${locale}/view must be a JSON object`);
  }
  return data as Readonly<Record<string, unknown>>;
}

const PLACEHOLDER = /\{([a-zA-Z]+)\}/;
const PLACEHOLDER_GLOBAL = /\{([a-zA-Z]+)\}/g;

export function firstCondition(event: ParsedMissionEvent, locale: Locale): string {
  const value = Object.values(event.effects.condByPart)[0];
  return formatNumber(value ?? 0, locale);
}

// What the pirate who won wanted, in words. The wording lives here (not in the JSON variants)
// because it depends on the motive and on the parts taken; both locales carry the same three cases.
const DEMAND_LINES: Record<Locale, Record<'cargo' | 'parts' | 'territory', string>> = {
  en: {
    cargo: 'The raiders went for the cargo and took all of it.',
    parts: 'The raiders broke into your hold and made off with {parts}.',
    territory: 'You had strayed into their territory: they drove you off and you turned back.',
  },
  'pt-BR': {
    cargo: 'Os saqueadores foram atrás da carga e levaram tudo.',
    parts: 'Os saqueadores arrombaram o seu depósito e levaram {parts}.',
    territory: 'Você invadiu o território deles: eles o expulsaram e você teve de voltar.',
  },
};

function demandLine(event: ParsedMissionEvent, locale: Locale, names: EntityNames): string {
  const motive = event.motive ?? 'territory';
  const template = DEMAND_LINES[locale][motive];
  if (motive !== 'parts') return template;
  const stolen = (event.stolen ?? []).map((id) => names.parts[id]?.name ?? id);
  const list =
    stolen.length === 0 ? (locale === 'pt-BR' ? 'algumas peças' : 'some parts') : stolen.join(', ');
  return template.replace('{parts}', list);
}

// A scavenging find in words: a used part with its condition, or scrap. Named from the live catalog
// (the log stores the part type, never a name).
function findLine(event: ParsedMissionEvent, locale: Locale, names: EntityNames): string {
  const found = event.found;
  if (found === undefined) return locale === 'pt-BR' ? 'algo' : 'something';
  const name = names.partTypes?.[found.partType] ?? found.partType;
  if (found.kind === 'scrap') {
    return locale === 'pt-BR' ? `sucata de ${name}` : `scrap of a ${name}`;
  }
  const condition = formatNumber(found.condition, locale);
  return locale === 'pt-BR'
    ? `${name} usada (condição ${condition}%)`
    : `a used ${name} (condition ${condition}%)`;
}

function requirePartId(event: ParsedMissionEvent): string {
  const id = Object.keys(event.effects.condByPart)[0];
  if (id === undefined) {
    throw new Error(`event type ${event.type} rendered {part} but carries no condByPart entry`);
  }
  return id;
}

function requireMaterial(event: ParsedMissionEvent): string {
  const entry = event.effects.loot[0];
  if (entry === undefined) {
    throw new Error(`event type ${event.type} rendered {material} but carries no loot entry`);
  }
  return entry.materialId;
}

/** Resolves one placeholder against an event; throws on unknown names. */
function resolveToken(
  token: string,
  event: ParsedMissionEvent,
  locale: Locale,
  names: EntityNames,
): ReportSegment {
  const numeric = (value: number): ReportSegment => ({
    t: 'text',
    value: formatNumber(value, locale),
  });
  switch (token) {
    case 'magnitude':
      return numeric(event.magnitude);
    case 'distance':
      return numeric(event.magnitude);
    case 'quantity':
      return numeric(event.magnitude);
    case 'conditionLost':
      return numeric(event.magnitude);
    case 'hp':
      return numeric(Math.abs(event.effects.hp));
    case 'shield':
      return numeric(event.cascade?.shield ?? 0);
    case 'armor':
      return numeric(event.cascade?.armor ?? 0);
    case 'hull':
      return numeric(event.cascade?.hp ?? 0);
    case 'credits':
      return { t: 'text', value: formatSigned(event.effects.credits, locale) };
    case 'condition':
      return { t: 'text', value: firstCondition(event, locale) };
    case 'fuelLost':
      return numeric(event.fuelLost ?? 0);
    case 'demand':
      return { t: 'text', value: demandLine(event, locale, names) };
    case 'find':
      return { t: 'text', value: findLine(event, locale, names) };
    case 'part': {
      const id = requirePartId(event);
      const entry = names.parts[id];
      return { t: 'ref', kind: 'part', id: entry?.partType ?? id, value: entry?.name ?? id };
    }
    case 'material': {
      const id = requireMaterial(event);
      return { t: 'ref', kind: 'loot', id, value: names.materials[id] ?? id };
    }
    default:
      throw new Error(
        `unknown report placeholder {${token}} (event type ${event.type}, locale ${locale})`,
      );
  }
}

/**
 * Renders one template string against one event (the substitution half of the
 * engine — exposed so placeholder typos are unit-testable without files).
 * Adjacent text pieces are merged; refs stay their own segments (D39).
 */
function substitute(template: string, resolve: (name: string) => ReportSegment): ReportLine {
  const segments: ReportSegment[] = [];
  const pushText = (value: string): void => {
    if (value === '') return;
    const last = segments[segments.length - 1];
    if (last?.t === 'text') {
      segments[segments.length - 1] = { t: 'text', value: last.value + value };
    } else {
      segments.push({ t: 'text', value });
    }
  };
  let rest = template;
  let match = PLACEHOLDER.exec(rest);
  while (match !== null) {
    pushText(rest.slice(0, match.index));
    segments.push(resolve(match[1]!));
    rest = rest.slice(match.index + match[0].length);
    match = PLACEHOLDER.exec(rest);
  }
  pushText(rest);
  return { text: segments.map((segment) => segment.value).join(''), segments };
}

/**
 * Fills a view-chrome template (summary/log/narrative strings, S9.3) from a
 * plain token map; values may be text or ready-made segments, so entity words
 * in chrome strings can be refs too. Unknown tokens fail loudly.
 */
export function substituteTokens(
  template: string,
  values: Readonly<Record<string, ReportSegment | string>>,
): ReportLine {
  return substitute(template, (name) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`unknown view placeholder {${name}}`);
    }
    return typeof value === 'string' ? { t: 'text', value } : value;
  });
}

export function renderTemplate(
  template: string,
  event: ParsedMissionEvent,
  locale: Locale,
  names: EntityNames,
): ReportLine {
  return substitute(template, (name) => resolveToken(name, event, locale, names));
}

/**
 * Renders one stored event as a report line. `eventIndex` is the event's
 * position in the MissionLog's stored array — the variant choice depends on
 * it, so callers must never pass a display-sorted position (S9.2).
 */
export function renderEventLine(
  event: ParsedMissionEvent,
  eventIndex: number,
  seed: string | number,
  locale: Locale,
  names: EntityNames = EMPTY_ENTITY_NAMES,
): ReportLine {
  let variants = loadTemplateVariants(locale, event.type);
  if (lacksV2Data(event)) {
    variants = loadLegacyVariants(locale, event.type);
    if (variants.length === 0) {
      throw new Error(
        `Report template ${locale}/${event.type} has no "legacy" variants for a v1 event`,
      );
    }
  }
  const variantIndex = deriveSeed(seed, `narr:${eventIndex}`) % variants.length;
  return renderTemplate(variants[variantIndex]!, event, locale, names);
}

/** Placeholder names used by a template, as a sorted multiset (tests). */
export function templatePlaceholders(template: string): readonly string[] {
  return [...template.matchAll(PLACEHOLDER_GLOBAL)].map((match) => match[1]!).sort();
}
