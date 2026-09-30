import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { LocalizedText, PartCatalogStats, PreviewResponse, ShipSheet } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';

// What every screen that shows a part (market, hangar tray, ship grid) needs to explain it.
// Inventory items and market listings both satisfy this shape.
export interface PartInfoData {
  /** The owned instance id (inventory items have one; a market listing hasn't been bought yet
      and doesn't). Only needed for the "if installed" comparison below. */
  id?: string;
  displayName: LocalizedText;
  description: LocalizedText;
  rarity: string;
  catalog: PartCatalogStats;
  condition?: number;
  /** Dead: counts for nothing until repaired. */
  broken?: boolean;
  price?: number;
}

/** Hangar only: what installing this (already-owned) part would do to the ship, compared to how
    it stands today. Needs the part's own instance id (`PartInfoData.id`) to ask the server. */
export interface PartCompareContext {
  shipId: string;
  /** Every part instance already on the ship. */
  installedPartIds: readonly string[];
  /** The ship's own current sheet — the "before" side of the comparison. */
  currentSheet: ShipSheet;
  /** Market only: the installed part (of the candidate's class) it would replace, and its name
      for the "swap" wording — omitted when nothing of that class is installed yet, in which
      case the candidate is compared as a pure addition instead of a swap. */
  replace?: { partInstanceId: string; displayName: LocalizedText };
}

// Effect stats worth listing when non-zero, in reading order. Size, mass, structure and hit
// points are always shown. Each one's key doubles as the ShipSheet field it sums into (they
// share the same name server-side), except the three in `BASE_STATS` below.
const EFFECT_STATS = [
  'pot',
  'pdf',
  'bli',
  'esc',
  'sen',
  'crg',
  'min',
  'fuelCap',
  'fuelUse',
  'energyCont',
  'energyCombat',
  'batCharge',
  'batOutput',
  'batInput',
] as const;

type EffectStat = (typeof EFFECT_STATS)[number];

// A part's own catalog field, the ship-sheet field it feeds, and how to read its value off the
// catalog — the three base stats every part has, named differently on the sheet than on the
// catalog (mass keeps its name; structureCost becomes structureUsed; partHp becomes hp).
const BASE_STATS: ReadonlyArray<{ key: string; sheetKey: keyof ShipSheet; read: (c: PartCatalogStats) => number }> = [
  { key: 'mass', sheetKey: 'mass', read: (c) => c.mass },
  { key: 'structureCost', sheetKey: 'structureUsed', read: (c) => c.structureCost },
  { key: 'partHp', sheetKey: 'hp', read: (c) => c.partHp },
];

// Ship-level stats no single part "has" on its own (mobility is thrust ÷ mass; autonomy is
// tank ÷ burn rate; condition is the fleet-wide average) but that installing a part can still
// move — worth showing in the comparison even though they're not part of the part's own stat
// list. `condition` matters here specifically for a used listing: deriveSheet() never scales a
// part's own effect stats by its condition, so this average is the ONLY place a used listing's
// wear actually shows up in the comparison at all (review finding, round-2 plan §5b.4).
const DERIVED_COMPARE_STATS: readonly (keyof ShipSheet)[] = ['mob', 'autonomy', 'condition'];

// Owner request (round 5): color the comparison, not just print it — gray when nothing moved,
// green/red by whether the move helps or hurts. Everything is "more is better" except these
// three, which are costs: more mass or fuel burn drags mobility/range down, and more structure
// used eats into the budget the bridge sets, leaving less room for other parts.
const LOWER_IS_BETTER: ReadonlySet<keyof ShipSheet> = new Set(['mass', 'fuelUse', 'structureUsed']);

type DeltaTone = 'same' | 'good' | 'bad';

function deltaTone(sheetKey: keyof ShipSheet, delta: number): DeltaTone {
  if (Math.abs(delta) < 0.05) return 'same';
  const higherIsBetter = !LOWER_IS_BETTER.has(sheetKey);
  return (delta > 0) === higherIsBetter ? 'good' : 'bad';
}

const SUMMARY_STATS: readonly EffectStat[] = [
  'pot',
  'pdf',
  'bli',
  'esc',
  'sen',
  'crg',
  'min',
  'fuelCap',
  'batCharge',
  'energyCont',
];

export function useNumberFormat(): (value: number) => string {
  const { i18n } = useTranslation();
  return (value) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
}

/** One line for a card: the two or three stats that define the part ("Thrust 8 · Mass 4"). */
export function partSummary(
  catalog: PartCatalogStats,
  t: (key: string) => string,
  format: (value: number) => string,
): string {
  const parts = SUMMARY_STATS.filter((key) => catalog[key] !== 0)
    .slice(0, 3)
    .map((key) => `${t(`parts.stat.${key}.label`)} ${format(catalog[key])}`);
  return parts.length > 0 ? parts.join(' · ') : t('parts.summaryNone');
}

// Escalating star count, one glyph per tier (owner request, round 6: "an icon showing the
// rarity, not only the color" — color alone isn't accessible/distinct enough at a glance).
const RARITY_STARS: Readonly<Record<string, number>> = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
};

/** A part's rarity as stars, not just the card's border colour — placed next to a name. */
export function RarityBadge({ rarity }: { rarity: string }) {
  const { t } = useTranslation();
  const stars = RARITY_STARS[rarity] ?? 1;
  return (
    <span
      className={`rarity-badge rarity-${rarity.toLowerCase()}`}
      aria-label={t('parts.rarityBadge', { rarity: t(`parts.rarities.${rarity}`, { defaultValue: rarity }) })}
      title={t(`parts.rarities.${rarity}`, { defaultValue: rarity })}
    >
      {'★'.repeat(stars)}
    </span>
  );
}

/**
 * Shared by the full popup (`PartDetail`) and the lighter hover card (`PartStatsCard`): asks the
 * server what installing/swapping `part` would do to the ship, and turns the answer into a
 * per-stat delta. Owner feedback (round 5): a bare delta ("+3") sits right next to "This part"'s
 * own stat value, and for a pure addition they're mathematically the SAME number for every
 * effect stat — nothing else changed, so the delta IS the part's own contribution. Two columns
 * showing the identical number, one plain and one colored, read as a coloring bug rather than
 * useful information. `deltaFor` shows the ship's actual resulting value instead (what "Ship, if
 * installed" already promises), with the change alongside it only when something actually moved.
 */
function useCompareQuery(part: PartInfoData, compare: PartCompareContext | undefined) {
  const format = useNumberFormat();
  const { catalog } = part;
  const comparePreview = useQuery({
    queryKey: [
      'partCompare',
      compare?.shipId,
      compare?.installedPartIds,
      compare?.replace?.partInstanceId,
      part.id,
      catalog.partType,
      part.condition,
    ],
    enabled: compare !== undefined,
    queryFn: () =>
      part.id !== undefined
        ? // Owned (Hangar tray): add this already-owned part to the current arrangement.
          client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
            partInstanceIds: [...(compare?.installedPartIds ?? []), part.id],
          })
        : // Not owned yet (Market/Store): ask for a virtual-part swap or addition.
          client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
            virtualPart: { partType: catalog.partType, condition: part.condition ?? 100 },
            replacePartInstanceId: compare?.replace?.partInstanceId,
          }),
  });
  const afterSheet = comparePreview.data?.sheet;

  const deltaFor = (sheetKey: keyof ShipSheet): { text: string; tone: DeltaTone } | null => {
    if (compare === undefined || afterSheet === undefined) return null;
    const after = afterSheet[sheetKey];
    const delta = after - compare.currentSheet[sheetKey];
    const tone = deltaTone(sheetKey, delta);
    const text =
      tone === 'same' ? format(after) : `${format(after)} (${delta > 0 ? '+' : ''}${format(delta)})`;
    return { text, tone };
  };

  // Owner request (round 6): a plain delta doesn't say whether the part actually *fits* —
  // structure has a hard cap (the bridge's budget), so this shows used/budget together
  // ("62/40!") and forces red whenever installing would push it over, regardless of whether
  // structureUsed's own higher-is-worse delta direction would otherwise read as merely "bad".
  const structureDeltaFor = (): { text: string; tone: DeltaTone } | null => {
    if (compare === undefined || afterSheet === undefined) return null;
    const after = afterSheet.structureUsed;
    const budget = afterSheet.structureBudget;
    const before = compare.currentSheet.structureUsed;
    const delta = after - before;
    const over = after > budget;
    const tone = over ? 'bad' : deltaTone('structureUsed', delta);
    const ratio = `${format(after)}/${format(budget)}`;
    const text =
      tone === 'same' ? ratio : `${ratio}${over ? '!' : ''} (${delta > 0 ? '+' : ''}${format(delta)})`;
    return { text, tone };
  };

  return { comparePreview, deltaFor, structureDeltaFor };
}

export interface PartDetailProps {
  part: PartInfoData;
  compare?: PartCompareContext;
}

export function PartDetail({ part, compare }: PartDetailProps) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const { catalog } = part;
  const name = pickLocalized(part.displayName, i18n.language);
  const description = pickLocalized(part.description, i18n.language);

  // The description and "why you need it" prose used to always show; now they're a hover-only
  // tag next to the name, like the (i) button that opens this popup in the first place (owner
  // request: less always-on text, the stats table is the point of this screen).
  const infoText = [
    description,
    t(`parts.role.${catalog.partClass}`),
    catalog.pressurized ? t('parts.flag.pressurized') : null,
    catalog.lifeSupport ? t('parts.flag.lifeSupport') : null,
  ]
    .filter((piece): piece is string => piece !== null && piece !== '')
    .join(' ');

  const { comparePreview, deltaFor, structureDeltaFor } = useCompareQuery(part, compare);
  const viabilityProblems = comparePreview.data?.viability.viable === false
    ? comparePreview.data.viability.problems
    : [];

  const rows = [
    ...EFFECT_STATS.filter((key) => catalog[key] !== 0).map((key) => ({
      key,
      sheetKey: key as keyof ShipSheet,
      value: format(catalog[key]),
    })),
    ...BASE_STATS.map((stat) => ({ key: stat.key, sheetKey: stat.sheetKey, value: format(stat.read(catalog)) })),
  ];

  return (
    <div className="part-detail">
      <p className="sub">
        {[
          t(`hangar.partClasses.${catalog.partClass}`),
          t(`parts.rarities.${part.rarity}`, { defaultValue: part.rarity }),
          `${t('parts.size')} ${catalog.w}×${catalog.h}`,
          part.condition !== undefined
            ? `${t('parts.condition')} ${format(part.condition)}%`
            : null,
        ]
          .filter((piece) => piece !== null)
          .join(' · ')}
        {infoText !== '' && (
          <button
            type="button"
            className="btn info-btn part-why-tag"
            aria-label={`${t('parts.whyTitle')}: ${name}`}
            title={infoText}
          >
            {t('parts.infoGlyph')}
          </button>
        )}
      </p>
      {part.broken === true && <p className="pcard-note">{t('parts.brokenNote')}</p>}
      {compare !== undefined && (
        <p className="muted part-compare-note">
          {comparePreview.isLoading
            ? t('parts.compare.loading')
            : comparePreview.isError
              ? t('parts.compare.error')
              : compare.replace !== undefined
                ? t('parts.compare.titleSwap', {
                    name: pickLocalized(compare.replace.displayName, i18n.language),
                  })
                : t('parts.compare.title')}
        </p>
      )}
      {viabilityProblems.length > 0 && (
        <ul className="compare-viability-warning">
          {viabilityProblems.map((problem) => (
            <li key={problem.code} className="error-text">
              {t(`hangar.problems.${problem.code}`, {
                defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
              })}
            </li>
          ))}
        </ul>
      )}
      <table className="part-stats-table">
        <thead>
          <tr>
            <th>{t('parts.compare.stat')}</th>
            <th>{t('parts.compare.value')}</th>
            {compare !== undefined && <th>{t('parts.compare.ifInstalled')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta =
              compare === undefined
                ? null
                : row.sheetKey === 'structureUsed'
                  ? structureDeltaFor()
                  : deltaFor(row.sheetKey);
            return (
              <tr key={row.key} title={t(`parts.stat.${row.key}.hint`)}>
                <td>{t(`parts.stat.${row.key}.label`)}</td>
                <td>
                  <b>{row.value}</b>
                </td>
                {compare !== undefined && (
                  <td className={`delta delta-${delta?.tone ?? 'same'}`}>{delta?.text ?? '—'}</td>
                )}
              </tr>
            );
          })}
          {compare !== undefined &&
            DERIVED_COMPARE_STATS.map((sheetKey) => {
              const delta = deltaFor(sheetKey);
              return (
                <tr key={sheetKey} title={t(`hangar.statHelp.${sheetKey}`)}>
                  <td>{t(`hangar.stats.${sheetKey}`)}</td>
                  <td>
                    <b>{format(compare.currentSheet[sheetKey])}</b>
                  </td>
                  <td className={`delta delta-${delta?.tone ?? 'same'}`}>{delta?.text ?? '—'}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The ship yard's hover card (owner request, round-3 follow-up): numbers only, no description
 * or "why you need it" prose — just enough to place the part without opening the full popup.
 * The popup itself still opens from the (i) button. Owner request (round 5): the tray's own
 * hover, specifically, also shows the comparison against what's installed — `compare` is only
 * ever passed from the tray, never from a yard-placed block (nothing to compare a block already
 * on the ship against).
 */
export function PartStatsCard({ part, compare }: { part: PartInfoData; compare?: PartCompareContext }) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const { catalog } = part;
  const name = pickLocalized(part.displayName, i18n.language);
  const { comparePreview, deltaFor, structureDeltaFor } = useCompareQuery(part, compare);
  const viabilityProblems = comparePreview.data?.viability.viable === false
    ? comparePreview.data.viability.problems
    : [];
  const effectRows = EFFECT_STATS.filter((key) => catalog[key] !== 0).map((key) => ({
    key,
    sheetKey: key as keyof ShipSheet,
    value: format(catalog[key]),
  }));
  const baseRows = BASE_STATS.map((stat) => ({
    key: stat.key,
    sheetKey: stat.sheetKey,
    value: format(stat.read(catalog)),
  }));

  return (
    <div className="part-stats-card">
      <b>{name}</b>
      <p className="sub">
        {[
          t(`hangar.partClasses.${catalog.partClass}`),
          `${catalog.w}×${catalog.h}`,
          part.condition !== undefined ? `${format(part.condition)}%` : null,
        ]
          .filter((piece) => piece !== null)
          .join(' · ')}
      </p>
      {viabilityProblems.length > 0 && (
        <ul className="compare-viability-warning">
          {viabilityProblems.map((problem) => (
            <li key={problem.code} className="error-text">
              {t(`hangar.problems.${problem.code}`, {
                defaultValue: t(`error.${problem.code}`, { defaultValue: problem.message }),
              })}
            </li>
          ))}
        </ul>
      )}
      <dl className="part-stats">
        {[...effectRows, ...baseRows].map((row) => {
          const delta =
            compare === undefined
              ? null
              : row.sheetKey === 'structureUsed'
                ? structureDeltaFor()
                : deltaFor(row.sheetKey);
          return (
            <div key={row.key} className="statrow">
              <dt>{t(`parts.stat.${row.key}.label`)}</dt>
              <dd>
                <b>{row.value}</b>
                {compare !== undefined && (
                  <span className={`delta delta-${delta?.tone ?? 'same'}`}>
                    {delta?.text ?? '—'}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
        {compare !== undefined &&
          DERIVED_COMPARE_STATS.map((sheetKey) => {
            const delta = deltaFor(sheetKey);
            return (
              <div key={sheetKey} className="statrow">
                <dt>{t(`hangar.stats.${sheetKey}`)}</dt>
                <dd>
                  <b>{format(compare.currentSheet[sheetKey])}</b>
                  <span className={`delta delta-${delta?.tone ?? 'same'}`}>{delta?.text ?? '—'}</span>
                </dd>
              </div>
            );
          })}
      </dl>
    </div>
  );
}
