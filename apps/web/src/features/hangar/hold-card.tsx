import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaterialsResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Tooltip } from '../../ui/kit/Tooltip';
import { PartThumb } from '../../ui/PartThumb';
import { conditionTone } from '../../ui/Gauge';
import { PartInfoButton } from '../parts/part-info-button';
import type { PartInfoData } from '../parts/part-detail';

type Holding = MaterialsResponse['materials'][number];

/** A material as a small card: a letter tile, the name, the quantity, the unit price as a small line. The
    description lives in a tooltip (hover, focus or tap). Read-only. */
export function HoldCard({ holding }: { holding: Holding }): ReactNode {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(holding.displayName, i18n.language);
  const description = pickLocalized(holding.description, i18n.language);
  return (
    <Tooltip content={description} describe={description !== ''}>
      <div className="hold-card" tabIndex={0} data-testid={`hold-card-${holding.materialId}`}>
        <PartThumb name={name} rarity="common" className="hold-thumb" />
        <span className="hold-card-text">
          <span className="hold-card-name">
            <b>{t('port.quantity', { quantity: holding.quantity })}</b> {name}
          </span>
          <small className="hold-card-unit">
            {t('port.unitPrice', { price: holding.unitPrice })}
          </small>
        </span>
      </div>
    </Tooltip>
  );
}

/** A loose part as a compact tile: thumbnail, name, condition chip; the details button opens the full card. */
export function HoldPartTile({ part }: { part: PartInfoData }): ReactNode {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(part.displayName, i18n.language);
  const condition = part.condition === undefined ? undefined : Math.round(part.condition);
  return (
    <div className={`hold-tile rarity-${part.rarity.toLowerCase()}`}>
      <PartThumb name={name} rarity={part.rarity} className="hold-thumb" />
      <span className="hold-tile-name">{name}</span>
      {part.broken === true ? (
        <span className="hold-chip-cond tone-bad">{t('parts.broken')}</span>
      ) : (
        condition !== undefined && (
          <span className={`hold-chip-cond tone-${conditionTone(condition)}`}>
            {t('port.conditionNow', { value: condition })}
          </span>
        )
      )}
      <PartInfoButton part={part} />
    </div>
  );
}
