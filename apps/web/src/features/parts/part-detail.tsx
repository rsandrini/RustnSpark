import { useTranslation } from 'react-i18next';
import type { LocalizedText, PartCatalogStats } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';

// What every screen that shows a part (market, hangar tray, ship grid) needs to explain it.
// Inventory items and market listings both satisfy this shape.
export interface PartInfoData {
  displayName: LocalizedText;
  description: LocalizedText;
  rarity: string;
  catalog: PartCatalogStats;
  condition?: number;
  /** Dead: counts for nothing until repaired. */
  broken?: boolean;
  price?: number;
}

// Effect stats worth listing when non-zero, in reading order. Size, mass, structure and hit
// points are always shown.
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

export function PartDetail({ part }: { part: PartInfoData }) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const { catalog } = part;

  const effectRows = EFFECT_STATS.filter((key) => catalog[key] !== 0).map((key) => ({
    key,
    value: format(catalog[key]),
  }));
  const baseRows = [
    { key: 'mass', value: format(catalog.mass) },
    { key: 'structureCost', value: format(catalog.structureCost) },
    { key: 'partHp', value: format(catalog.partHp) },
  ];
  const description = pickLocalized(part.description, i18n.language);

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
      </p>
      {part.broken === true && <p className="pcard-note">{t('parts.brokenNote')}</p>}
      {description !== '' && <p className="part-desc">{description}</p>}
      <h3>{t('parts.whyTitle')}</h3>
      <p>{t(`parts.role.${catalog.partClass}`)}</p>
      {catalog.pressurized && <p className="muted">{t('parts.flag.pressurized')}</p>}
      {catalog.lifeSupport && <p className="muted">{t('parts.flag.lifeSupport')}</p>}
      <dl className="part-stats">
        {[...effectRows, ...baseRows].map((row) => (
          <div key={row.key} className="statrow" title={t(`parts.stat.${row.key}.hint`)}>
            <dt>{t(`parts.stat.${row.key}.label`)}</dt>
            <dd>
              <b>{row.value}</b>
              <span className="muted stat-hint">{t(`parts.stat.${row.key}.hint`)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
