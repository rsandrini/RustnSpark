import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InventoryItem } from '../../api/generated';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartThumb } from '../../ui/PartThumb';
import {
  PartStatsCard,
  RarityBadge,
  partSummary,
  useNumberFormat,
  type PartCompareContext,
} from '../parts/part-detail';
import { ConnectorGrid } from '../parts/connector-grid';
import { PartInfoButton } from '../parts/part-info-button';
import { hoverAnchor, useClampedPosition, type HoverAnchor } from '../parts/use-hover-card-position';

export interface TrayPartRowProps {
  part: InventoryItem;
  name: string;
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  compare: PartCompareContext | undefined;
}

// One tray row: its own button, the (i) popup, and (owner request, round 5/6) a hover card
// showing the same comparison, positioned beside the cursor and clamped to stay fully visible.
export function TrayPartRow({ part, name, disabled, selected, onSelect, compare }: TrayPartRowProps) {
  const { t } = useTranslation();
  const format = useNumberFormat();
  const [anchor, setAnchor] = useState<HoverAnchor | null>(null);
  const { ref: cardRef, style: cardStyle } = useClampedPosition(anchor);

  return (
    <div className="part-btn-wrap">
      <button
        type="button"
        className={`part-btn rarity-${part.rarity.toLowerCase()}${part.broken ? ' broken' : ''}${selected ? ' on' : ''}`}
        disabled={disabled}
        onClick={onSelect}
        onPointerEnter={(event) => setAnchor(hoverAnchor(event, event.currentTarget))}
        onPointerLeave={() => setAnchor(null)}
      >
        <span className="part-line">
          <PartThumb name={name} rarity={part.rarity} />
          {name}
          <RarityBadge rarity={part.rarity} />
        </span>
        <span className="meta">
          {[t(`hangar.partClasses.${part.catalog.partClass}`), `${part.catalog.w}×${part.catalog.h}`].join(
            ' · ',
          )}
        </span>
        <span className="meta">{partSummary(part.catalog, t, format)}</span>
        {part.connectors.length > 0 && (
          <ConnectorGrid
            w={part.catalog.w}
            h={part.catalog.h}
            connectors={part.connectors}
            size="mini"
          />
        )}
        <Gauge
          value={Math.round(part.condition)}
          max={100}
          tone={conditionTone(part.condition)}
          ariaLabel={t('port.conditionNow', { value: Math.round(part.condition) })}
          label={t('port.conditionNow', { value: Math.round(part.condition) })}
        />
      </button>
      <PartInfoButton part={part} compare={compare} />
      {anchor !== null && (
        <div ref={cardRef} className="compare-hover-card" aria-hidden="true" style={cardStyle}>
          <PartStatsCard part={part} compare={compare} />
        </div>
      )}
    </div>
  );
}
