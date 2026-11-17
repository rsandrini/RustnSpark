import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './moments.css';

const RESCUE_BEAT_MS = 4200;

/** How long the card holds before the story hands the pilot over to the faction choice. */
const LATER_BEAT_MS = 3600;

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
export function RescueMoment({ onReady }: Pick<MomentProps, 'onReady'>) {
  useEffect(() => {
    const timer = window.setTimeout(onReady, RESCUE_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [onReady]);
  return (
    <div className="moment moment-rescue" data-testid="rescue-moment" data-opening-free="">
      <div className="moment-stars" aria-hidden="true" />
      <div className="moment-wreck" aria-hidden="true">
        {SHARDS.slice(0, 4).map((shard) => (
          <span key={shard} className={`moment-shard drift s${shard}`} />
        ))}
      </div>
      <div className="moment-cutter" aria-hidden="true">
        <div className="moment-beam" />
        <div className="moment-cutter-body" />
      </div>
    </div>
  );
}

/**
 * The time skip after the rescue: a black card, "Some months later", then the story hands over (`onDone`)
 * to the faction choice.
 */
export function LaterMoment({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = window.setTimeout(onDone, LATER_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return (
    <div className="moment moment-later" data-testid="later-moment" data-opening-free="">
      <p className="moment-later-text">{t('prologue.moment.later')}</p>
    </div>
  );
}
