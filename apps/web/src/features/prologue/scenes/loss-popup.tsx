import { useTranslation } from 'react-i18next';
import './loss-popup.css';

const LOST_GLYPH = '✕';
const SAVED_GLYPH = '✓';

export interface LossPopupProps {
  onContinue: () => void;
}

export function LossPopup({ onContinue }: LossPopupProps) {
  const { t } = useTranslation();

  return (
    <div className="loss-popup-backdrop" role="presentation">
      <div
        className="loss-popup"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('prologue.loss.title')}
      >
        <h1 data-testid="loss-title">{t('prologue.loss.title')}</h1>
        <p>{t('prologue.loss.rescue')}</p>

        <div className="loss-columns">
          <section className="loss-column lost" data-testid="loss-lost">
            <h2>{t('prologue.loss.lostTitle')}</h2>
            <ul>
              <li>
                <span className="glyph" aria-hidden="true">
                  {LOST_GLYPH}
                </span>
                {t('prologue.loss.ship')}
              </li>
              <li>
                <span className="glyph" aria-hidden="true">
                  {LOST_GLYPH}
                </span>
                {t('prologue.loss.parts')}
              </li>
            </ul>
          </section>

          <section className="loss-column saved" data-testid="loss-saved">
            <h2>{t('prologue.loss.savedTitle')}</h2>
            <ul>
              <li>
                <span className="glyph" aria-hidden="true">
                  {SAVED_GLYPH}
                </span>
                {t('prologue.loss.player')}
              </li>
              <li>
                <span className="glyph" aria-hidden="true">
                  {SAVED_GLYPH}
                </span>
                {t('prologue.loss.credits')}
              </li>
            </ul>
          </section>
        </div>

        <div className="actions">
          <button
            type="button"
            autoFocus
            className="btn primary"
            data-testid="loss-continue"
            onClick={onContinue}
          >
            {t('prologue.loss.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
