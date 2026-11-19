import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './moments.css';

const RESCUE_BEAT_MS = 4200;

/** How long the screen takes to go black (Bob's last lines are spoken over it once it has). */
const DARK_BEAT_MS = 1800;

/** How long "Some months later" holds before the Marshal speaks. */
const LATER_BEAT_MS = 3400;

/** How long the game's name stays on the black before "Some months later" (the black fades down first, then the name fades in and is fully shown for about four seconds). */
const TITLE_BEAT_MS = 7800;

/** How long the cutter takes to fly off once the pilot is aboard. */
const DEPART_BEAT_MS = 3200;

const SHARDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export interface MomentProps {
  /** The picture has played: the guide may speak now. */
  onReady: () => void;
  /** Show the controls (the pilot's part of the moment is over). */
  settled: boolean;
  onContinue: () => void;
}

/**
 * The rescue: stars, a cutter coming in out of the dark with its light on the wreck. Quiet after the loss, and warm.
 * A picture only: no caption, no verdict; whatever is said is the rescuer's own line.
 */
export function RescueMoment({
  onReady,
  departing = false,
  onDeparted,
}: Pick<MomentProps, 'onReady'> & { departing?: boolean; onDeparted?: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onReady, RESCUE_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [onReady]);
  // the pilot is aboard: the cutter flies on, and the story goes on when it is gone
  useEffect(() => {
    if (!departing) return undefined;
    const timer = window.setTimeout(() => onDeparted?.(), DEPART_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [departing, onDeparted]);
  return (
    <div className="moment moment-rescue" data-testid="rescue-moment" data-opening-free="">
      <div className="moment-stars" aria-hidden="true" />
      <div className="moment-wreck" aria-hidden="true">
        {SHARDS.slice(0, 4).map((shard) => (
          <span key={shard} className={`moment-shard drift s${shard}`} />
        ))}
      </div>
      <div className={`moment-cutter${departing ? ' departing' : ''}`} aria-hidden="true">
        <div className="moment-beam" />
        <div className="moment-cutter-body" />
      </div>
    </div>
  );
}

/** The screen fades to black by itself (no click); `onReady` says it is dark, so the guides may speak over it. */
export function DarkMoment({
  onReady,
  beatMs = DARK_BEAT_MS,
  ping = false,
  instant = false,
}: Pick<MomentProps, 'onReady'> & { beatMs?: number; ping?: boolean; instant?: boolean }) {
  useEffect(() => {
    const timer = window.setTimeout(onReady, beatMs);
    return () => window.clearTimeout(timer);
  }, [onReady, beatMs]);
  return (
    <div
      className={`moment moment-black moment-dark${instant ? ' instant' : ''}`}
      data-testid="dark-moment"
      data-opening-free=""
    >
      {ping && <div className="moment-stars-field" aria-hidden="true" />}
      {ping && (
        // a signal in the dark: rings that swell and vanish, over and over (hidden while a popup is open)
        <div className="moment-ping" data-testid="moment-ping" aria-hidden="true">
          <span className="moment-ping-dot" />
          <span className="moment-ping-ring" />
          <span className="moment-ping-ring late" />
        </div>
      )}
    </div>
  );
}

/** The wordmark, split so the "n" takes the accent colour (a brand, not a translation; same as the top bar's). */
const BRAND = ['rust', 'n', 'spark'] as const;

/**
 * The time skip after the rescue: the game's name on black, then "Some months later". `onReady` says both
 * have been seen, so the Marshal may speak (the story ends after his lines).
 */
export function LaterMoment({ onReady }: Pick<MomentProps, 'onReady'>) {
  const { t } = useTranslation();
  // the game's name first, then the time skip
  const [title, setTitle] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(
      () => (title ? setTitle(false) : onReady()),
      title ? TITLE_BEAT_MS : LATER_BEAT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [title, onReady]);
  return (
    <div className="moment moment-later" data-testid="later-moment" data-opening-free="">
      {title ? (
        <p className="moment-title" data-testid="title-moment" aria-label="rustnspark">
          {BRAND[0]}
          <b>{BRAND[1]}</b>
          {BRAND[2]}
        </p>
      ) : (
        <p className="moment-later-text">{t('prologue.moment.later')}</p>
      )}
    </div>
  );
}
