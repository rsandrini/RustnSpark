import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/mission-result.css';
import { noteResultCardShown } from './result-card-gate';

/** The chip's icon, one stroke path per verdict (a tick, a flag, a cross). */
const CHIP_ICON = {
  ok: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M5 21V4M5 4h13l-2.5 4 2.5 4H5',
  bad: 'M6 6l12 12M18 6L6 18',
} as const;

export interface MissionResultProps {
  /** How it ended: drives the colour and the glyph. */
  tone: 'ok' | 'warn' | 'bad';
  /** "Mission accomplished", "Mission failed"... */
  outcome: string;
  /** The mission's name, and where it went. */
  title: string;
  route: string;
  /** What it paid, already formatted ("+646 ¢"). */
  credits: string;
  /** A race: the place the pilot finished and the time they took (already formatted). */
  race: { place: number; time: string } | null;
  /** Show the full report (the card goes away, the report is behind it). */
  onReport: () => void;
  /** Leave the report and go to My Ship; absent = the card has only the report button (the opening's report steps need the report). */
  onDismiss?: () => void;
}

/**
 * The short popup that opens on a finished mission: a verdict chip, the pay as the big number, then the job and its
 * route; a race leads with the place and the time instead. Enter, Escape or a click closes it and leaves the full report below.
 */
export function MissionResultPopup({
  tone,
  outcome,
  title,
  route,
  credits,
  race,
  onReport,
  onDismiss,
}: MissionResultProps) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    noteResultCardShown();
    button.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') (onDismiss ?? onReport)();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onReport, onDismiss]);
  return (
    <div className="mresult-layer" data-testid="mission-result" data-dialogue-free="">
      <div className="mresult-backdrop" aria-hidden="true" />
      <div className={`mresult ${tone}`} role="alertdialog" aria-label={outcome}>
        <p className="mresult-chip">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={CHIP_ICON[tone]} />
          </svg>
          <span>{outcome}</span>
        </p>
        {race === null ? (
          <>
            <p className="mresult-credits">{credits}</p>
            <p className="mresult-mission">
              <b>{title}</b>
              <small>{route}</small>
            </p>
          </>
        ) : (
          <>
            <p className="mresult-race" data-testid="mission-result-race">
              <b>{t('report.popup.racePlace', { place: race.place })}</b>
              <small>{t('report.popup.raceTime', { time: race.time })}</small>
            </p>
            <p className="mresult-prize">{credits}</p>
          </>
        )}
        <div className="mresult-actions">
          <button
            ref={button}
            type="button"
            className="btn primary"
            data-testid="mission-result-report"
            onClick={onReport}
          >
            {t('report.popup.close')}
          </button>
          {onDismiss !== undefined && (
            <button
              type="button"
              className="btn"
              data-testid="mission-result-close"
              onClick={onDismiss}
            >
              {t('report.popup.dismiss')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
