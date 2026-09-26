import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartThumb } from '../../ui/PartThumb';
import { partSummary, useNumberFormat, type PartInfoData } from './part-detail';
import { PartInfoButton } from './part-info-button';

export interface PartCardProps {
  part: PartInfoData;
  /** The number the card leads with (buy price, or what the port pays). */
  price?: number;
  /** Small text under the price ("You pay", "Port pays"). */
  priceCaption?: string;
  /** A short warning under the meta line ("too damaged to sell"). */
  note?: string;
  /** A used listing: tagged so it is never mistaken for a new part. */
  used?: boolean;
  /** Buttons on the card's footer; the details button is always added. */
  actions?: ReactNode;
}

// One part, one card, stacked top to bottom: name and price, what it is, how worn it is, what it
// does, then the buttons. The rarity is the accent colour of the card.
export function PartCard({
  part,
  price,
  priceCaption,
  note,
  used = false,
  actions,
}: PartCardProps) {
  const { t, i18n } = useTranslation();
  const format = useNumberFormat();
  const name = pickLocalized(part.displayName, i18n.language);
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const condition = part.condition === undefined ? undefined : Math.round(part.condition);
  const meta = [
    t(`hangar.partClasses.${part.catalog.partClass}`),
    t(`parts.rarities.${part.rarity}`, { defaultValue: part.rarity }),
    `${part.catalog.w}×${part.catalog.h}`,
  ].join(' · ');

  return (
    <article
      className={`pcard rarity-${part.rarity.toLowerCase()}${part.broken === true ? ' broken' : ''}`}
    >
      <header className="pcard-head">
        <div className="pcard-title-row">
          <PartThumb name={name} rarity={part.rarity} />
          <h3 className="pcard-name">{name}</h3>
        </div>
        {price !== undefined && (
          <div className="pcard-price">
            <b>{money(price)}</b>
            {priceCaption !== undefined && <small>{priceCaption}</small>}
          </div>
        )}
      </header>
      <div className="pcard-meta">
        {used && <span className="used-tag">{t('market.used')}</span>}
        {meta}
      </div>
      {(part.broken === true || note !== undefined) && (
        <div className="pcard-note">{part.broken === true ? t('parts.broken') : note}</div>
      )}
      {condition !== undefined && (
        <Gauge
          value={condition}
          max={100}
          tone={conditionTone(condition)}
          ariaLabel={`${name}: ${t('port.conditionNow', { value: condition })}`}
          label={t('port.conditionNow', { value: condition })}
        />
      )}
      <div className="pcard-summary">{partSummary(part.catalog, t, format)}</div>
      <p className="pcard-desc part-desc-short">{pickLocalized(part.description, i18n.language)}</p>
      <footer className="pcard-actions">
        <PartInfoButton part={part} />
        {actions}
      </footer>
    </article>
  );
}
