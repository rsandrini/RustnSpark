import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import { PartArt } from './part-art';
import { PartKindTag, MetaLine } from './part-kind-tag';
import { PartStatsCard, type PartCompareContext, type PartInfoData } from './part-detail';
import { fitView } from './fit-view';
import type { PortFit } from './port-fit';
import { PartInfoButton } from './part-info-button';
import { hoverAnchor, useClampedPosition, type HoverAnchor } from './use-hover-card-position';

export interface PartRowProps {
  part: PartInfoData;
  price?: number;
  used?: boolean;
  /** The Buy button (the details button is always added). */
  actions?: ReactNode;
  compare?: PartCompareContext;
  fit?: PortFit;
}

// One listing as two lines: the name in full, then the facts (kind, size, condition, price); the actions sit on the right.
export function PartRow({ part, price, used = false, actions, compare, fit }: PartRowProps) {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(part.displayName, i18n.language);
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const condition = part.condition === undefined ? undefined : Math.round(part.condition);
  const verdict = fitView(fit);
  const [anchor, setAnchor] = useState<HoverAnchor | null>(null);
  const { ref: cardRef, style: cardStyle } = useClampedPosition(anchor);

  return (
    <article
      className={`part-row rarity-${part.rarity.toLowerCase()}${part.broken === true ? ' broken' : ''}`}
      data-testid="part-row"
      onPointerEnter={(event) => setAnchor(hoverAnchor(event, event.currentTarget))}
      onPointerLeave={() => setAnchor(null)}
    >
      <PartArt catalog={part.catalog} rarity={part.rarity} size={40} />
      <div className="part-row-main">
        <h2 className="part-row-name">{name}</h2>
        <div className="part-row-facts">
          {used && <span className="used-tag">{t('market.used')}</span>}
          <MetaLine
            pieces={[
              <PartKindTag key="kind" catalog={part.catalog} />,
              `${part.catalog.w}×${part.catalog.h}`,
            ]}
          />
          {part.broken === true && <span className="used-tag">{t('parts.broken')}</span>}
          {condition !== undefined && condition < 100 && (
            <span className="part-row-condition">
              {t('port.conditionNow', { value: condition })}
            </span>
          )}
          {price !== undefined && <b className="part-row-price">{money(price)}</b>}
        </div>
        {verdict !== undefined && (
          <span
            className={`part-row-fit pcard-fit ${verdict.tone}`}
            data-testid="part-fit"
            title={t(`connectors.fit.${verdict.key}`, verdict.counts)}
          >
            <span aria-hidden="true">{verdict.icon}</span>{' '}
            <span className="part-row-fit-text">
              {t(`connectors.fit.${verdict.key}`, verdict.counts)}
            </span>
          </span>
        )}
      </div>
      <div className="part-row-actions">
        <PartInfoButton part={part} compare={compare} />
        {actions}
      </div>
      {anchor !== null && (
        <div
          ref={cardRef}
          className="compare-hover-card"
          aria-hidden="true"
          data-testid="part-card-hover-card"
          style={cardStyle}
        >
          <PartStatsCard part={part} compare={compare} />
        </div>
      )}
    </article>
  );
}
