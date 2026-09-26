import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import { Popup } from '../../ui/Popup';
import { PartDetail, type PartInfoData } from './part-detail';

// The "i" next to a part: opens the full explanation (description, why you need it, stats).
export function PartInfoButton({ part }: { part: PartInfoData }) {
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
        onClick={() => setOpen(true)}
      >
        {t('parts.infoGlyph')}
      </button>
      <Popup open={open} title={name} onClose={() => setOpen(false)}>
        <PartDetail part={part} />
      </Popup>
    </>
  );
}
