import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/mission-result.css';
import { noteResultCardShown } from './result-card-gate';

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
 * The short, animated card that opens on a finished mission: the verdict pops in, then the name of the job and what it
 * paid; a race says only the place and the time. Enter, Escape or a click closes it and leaves the full report below.
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
        <div className="mresult-glyph" aria-hidden="true">
          <span>{t(`report.glyph.${tone}`)}</span>
        </div>
        <h2 className="mresult-outcome">{outcome}</h2>
        {race === null ? (
          <p className="mresult-mission">
            <b>{title}</b>
            <small>{route}</small>
          </p>
        ) : (
          <p className="mresult-race" data-testid="mission-result-race">
            <b>{t('report.popup.racePlace', { place: race.place })}</b>
            <small>{t('report.popup.raceTime', { time: race.time })}</small>
          </p>
        )}
        <p className="mresult-credits">{credits}</p>
        <div className="mresult-actions">
          <button
            ref={button}
            type="button"
            className="btn primary mresult-close"
            data-testid="mission-result-report"
            onClick={onReport}
          >
            {t('report.popup.close')}
          </button>
          {onDismiss !== undefined && (
            <button
              type="button"
              className="btn mresult-close"
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
