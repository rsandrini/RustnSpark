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
// tank ÷ burn rate) but that installing a part can still move — worth showing in the comparison
// even though they're not part of the part's own stat list.
const DERIVED_COMPARE_STATS: readonly (keyof ShipSheet)[] = ['mob', 'autonomy'];

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

  const comparePreview = useQuery({
    queryKey: ['partCompare', compare?.shipId, compare?.installedPartIds, part.id],
    enabled: compare !== undefined && part.id !== undefined,
    queryFn: () =>
      client.post<PreviewResponse>(`/v1/ships/${compare?.shipId ?? ''}/preview`, {
        partInstanceIds: [...(compare?.installedPartIds ?? []), part.id ?? ''],
      }),
  });
  const afterSheet = comparePreview.data?.sheet;

  const deltaFor = (sheetKey: keyof ShipSheet): string | null => {
    if (compare === undefined || afterSheet === undefined) return null;
    const delta = afterSheet[sheetKey] - compare.currentSheet[sheetKey];
    if (Math.abs(delta) < 0.05) return t('parts.compare.unchanged');
    return `${delta > 0 ? '+' : ''}${format(delta)}`;
  };

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
          {comparePreview.isLoading ? t('parts.compare.loading') : t('parts.compare.title')}
        </p>
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
          {rows.map((row) => (
            <tr key={row.key} title={t(`parts.stat.${row.key}.hint`)}>
              <td>{t(`parts.stat.${row.key}.label`)}</td>
              <td>
                <b>{row.value}</b>
              </td>
              {compare !== undefined && <td className="delta">{deltaFor(row.sheetKey) ?? '—'}</td>}
            </tr>
          ))}
          {compare !== undefined &&
            DERIVED_COMPARE_STATS.map((sheetKey) => (
              <tr key={sheetKey} title={t(`hangar.statHelp.${sheetKey}`)}>
                <td>{t(`hangar.stats.${sheetKey}`)}</td>
                <td>
                  <b>{format(compare.currentSheet[sheetKey])}</b>
                </td>
                <td className="delta">{deltaFor(sheetKey) ?? '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The ship yard's hover card (owner request, round-3 follow-up): numbers only, no description
 * or "why you need it" prose — just enough to place the part without opening the full popup.
 * The popup itself now opens only from the (i) button.
 */
export function PartStatsCard({ part }: { part: PartInfoData }) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const { catalog } = part;
  const name = pickLocalized(part.displayName, i18n.language);
  const effectRows = EFFECT_STATS.filter((key) => catalog[key] !== 0).map((key) => ({
    key,
    value: format(catalog[key]),
  }));
  const baseRows = BASE_STATS.map((stat) => ({ key: stat.key, value: format(stat.read(catalog)) }));

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
      <dl className="part-stats">
        {[...effectRows, ...baseRows].map((row) => (
          <div key={row.key} className="statrow">
            <dt>{t(`parts.stat.${row.key}.label`)}</dt>
            <dd>
              <b>{row.value}</b>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
