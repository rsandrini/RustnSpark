import { useTranslation } from 'react-i18next';
import type { ShipSheet } from '../../api/generated';
import { sheetStat, useDisplay } from '../../ui/display';
import { defensePools } from './ship-sheet-panel';

export interface YardCalloutsProps {
  sheet: ShipSheet | undefined;
  /** The unsaved preview's fight pools, when there is one. */
  layers?: { shield: number; armor: number } | undefined;
}

const SEPARATOR = ' · ';

/** The sheet's key numbers pinned on the yard, so an edit is read on the apparatus. Read-only and
    hidden from assistive technology: the full sheet beside the yard carries the same figures. */
export function YardCallouts({ sheet, layers }: YardCalloutsProps) {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  if (sheet === undefined) return null;
  const number = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value);
  const pools = defensePools(sheet, layers, display.armorPoolFactor);
  const items: Array<{ key: string; label: string; title: string; value: string }> = [
    {
      key: 'fp',
      label: t('hangar.callouts.fp'),
      title: t('hangar.headline.firepower'),
      value: number(sheet.pdf),
    },
    {
      key: 'def',
      label: t('hangar.callouts.def'),
      title: t('hangar.headline.defense'),
      value: [number(pools.armor), number(pools.shield)].join(SEPARATOR),
    },
    {
      key: 'crg',
      label: t('hangar.callouts.crg'),
      title: t('hangar.headline.cargo'),
      value: number(sheet.crg),
    },
    {
      key: 'mob',
      label: t('hangar.callouts.mob'),
      title: t('hangar.headline.mobility'),
      value: number(sheetStat(sheet, 'mob', display)),
    },
    {
      key: 'rng',
      label: t('hangar.callouts.rng'),
      title: t('hangar.headline.autonomy'),
      value: sheet.fuelUse <= 0 ? t('hangar.stats.unlimited') : number(sheet.autonomy),
    },
  ];
  return (
    <ul className="yard-callouts" aria-hidden="true" data-testid="yard-callouts">
      {items.map((item) => (
        <li key={item.key} title={item.title}>
          <span>{item.label}</span>
          <b>{item.value}</b>
        </li>
      ))}
    </ul>
  );
}
