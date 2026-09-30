import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import { Popup } from '../../ui/Popup';
import { PartDetail, RarityBadge, type PartCompareContext, type PartInfoData } from './part-detail';

export interface PartInfoButtonProps {
  part: PartInfoData;
  /** What installing/swapping this part would do to the ship, next to its own stats — the
      Hangar tray (an owned part) and Market/Store (a virtual swap or addition) both set this;
      omitted only where there's no ship context to compare against at all. */
  compare?: PartCompareContext;
}

// The "i" next to a part: opens the full explanation (description, why you need it, stats).
export function PartInfoButton({ part, compare }: PartInfoButtonProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const name = pickLocalized(part.displayName, i18n.language);
  return (
    <>
      <button
        type="button"
        className="btn info-btn"
        aria-label={`${t('parts.info')}: ${name}`}
        title={t('parts.info')}
        onClick={(event) => {
          // Stops the click from also reaching a clickable card/row this button sits inside
          // (My Ship's tray rows nest it right next to the part name now).
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {t('parts.infoGlyph')}
      </button>
      <Popup
        open={open}
        title={name}
        titleBadge={<RarityBadge rarity={part.rarity} />}
        onClose={() => setOpen(false)}
      >
        <PartDetail part={part} compare={compare} />
      </Popup>
    </>
  );
}
