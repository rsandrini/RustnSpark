import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/mission-result.css';
import { CountUp } from '../../ui/CountUp';
import { prefersReducedMotion } from '../../ui/use-count-up';
import { haptic } from '../../ui/haptics';
import { noteResultCardShown } from './result-card-gate';

/** The secondary lines slide in one after another, this far apart, after the figure has started. */
const LINE_BASE_MS = 350;
const LINE_STAGGER_MS = 60;

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
  /** The same reward as a number: the figure counts up to it. */
  creditsValue: number;
  /** Writes a number the way `credits` is written ("+646 ¢"); the count-up uses it for every step. */
  creditsFormat: (value: number) => string;
  /** A race: the place the pilot finished and the time they took (already formatted). */
  race: { place: number; time: string } | null;
  /** A free flight (no mission): there is no pay, so the card says where the ship arrived instead. */
  travel?: { destination: string } | null;
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
  creditsValue,
  creditsFormat,
  race,
  travel = null,
  onReport,
  onDismiss,
}: MissionResultProps) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  // The staged reveal plays once; a click on the body or reduced motion shows the final state at once.
  // Escape is not touched: it closes the popup as always, mid-reveal or not.
  const [revealed, setRevealed] = useState(prefersReducedMotion);
  let line = 0;
  const lineStyle = (): CSSProperties =>
    ({ '--reveal-delay': `${LINE_BASE_MS + line++ * LINE_STAGGER_MS}ms` }) as CSSProperties;
  const kind = creditsValue === 0 ? '' : creditsValue > 0 && tone !== 'bad' ? 'gain' : 'loss';
  const figure =
    revealed || creditsValue === 0 ? (
      credits
    ) : (
      <CountUp value={creditsValue} from={0} animateOnMount format={creditsFormat} />
    );
  // one buzz when the card opens: a reward is a success, a loss a warning (no pay, no buzz)
  const buzzed = useRef(false);
  useEffect(() => {
    if (buzzed.current) return;
    buzzed.current = true;
    if (tone === 'bad' || creditsValue < 0) haptic('warn');
    else if (creditsValue > 0) haptic('success');
  }, [tone, creditsValue]);
  useEffect(() => {
    noteResultCardShown();
    button.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') (onDismiss ?? onReport)();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onReport, onDismiss]);
  // on the page body: the report's own panels would otherwise box a fixed layer inside them
  return createPortal(
    <div className="mresult-layer" data-testid="mission-result" data-dialogue-free="">
      <div className="mresult-backdrop" aria-hidden="true" />
      {/* a click anywhere on the card skips the reveal; the buttons and Escape work as usual */}
      <div
        className={`mresult ${tone}`}
        role="alertdialog"
        aria-label={outcome}
        data-revealed={revealed ? 'true' : 'false'}
        onClick={() => setRevealed(true)}
      >
        <p className="mresult-chip">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={CHIP_ICON[tone]} />
          </svg>
          <span>{outcome}</span>
        </p>
        {travel !== null ? (
          <p className="mresult-travel" data-testid="mission-result-travel" style={lineStyle()}>
            <b>{travel.destination}</b>
            <small>{[title, route].join(' · ')}</small>
          </p>
        ) : race === null ? (
          <>
            <p className={`mresult-credits ${kind}`}>{figure}</p>
            <p className="mresult-mission" style={lineStyle()}>
              <b>{title}</b>
              <small>{route}</small>
            </p>
          </>
        ) : (
          <>
            <p className="mresult-race" data-testid="mission-result-race" style={lineStyle()}>
              <b>{t('report.popup.racePlace', { place: race.place })}</b>
              <small>{t('report.popup.raceTime', { time: race.time })}</small>
            </p>
            <p className={`mresult-prize ${kind}`} style={lineStyle()}>
              {figure}
            </p>
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
    </div>,
    document.body,
  );
}
