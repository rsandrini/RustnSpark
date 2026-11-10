import { useTranslation } from 'react-i18next';
import { Popup } from '../../ui/Popup';

export interface SkipWarningProps {
  open: boolean;
  /** Back to the opening. */
  onPlay: () => void;
  /** Skip it for good. */
  onSkip: () => void;
  busy?: boolean;
}

/**
 * The big warning before the opening is skipped: it is built for first-time pilots, so skipping asks twice and says
 * so plainly. The safe button (play) is the first and the primary one.
 */
export function SkipWarning({ open, onPlay, onSkip, busy = false }: SkipWarningProps) {
  const { t } = useTranslation();
  return (
    <Popup
      open={open}
      title={t('prologue.skip.title')}
      onClose={onPlay}
      className="modal prologue-skip"
      actions={
        <>
          <button type="button" className="btn primary" onClick={onPlay} disabled={busy}>
            {t('prologue.skip.play')}
          </button>
          <button type="button" className="btn" onClick={onSkip} disabled={busy}>
            {t('prologue.skip.confirm')}
          </button>
        </>
      }
    >
      <p className="prologue-skip-label">{t('prologue.skip.label')}</p>
      <p className="prologue-skip-body">{t('prologue.skip.body')}</p>
      <p className="prologue-skip-warning">{t('prologue.skip.warning')}</p>
    </Popup>
  );
}
