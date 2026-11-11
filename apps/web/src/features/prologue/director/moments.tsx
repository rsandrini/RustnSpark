import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './moments.css';

/** How long the picture plays on its own before the guide starts to speak. */
const LOSS_BEAT_MS = 3200;
const RESCUE_BEAT_MS = 4200;

const LOST_GLYPH = '✕';
const SAVED_GLYPH = '✓';

const SHARDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export interface MomentProps {
  /** The picture has played: the guide may speak now. */
  onReady: () => void;
  /** The friend's name, for the wreck beside the pilot's. */
  friend: string;
  /** Show the controls (the pilot's part of the moment is over). */
  settled: boolean;
  onContinue: () => void;
}

/**
 * The final run is lost: the screen goes dark and red, the ship breaks up and the signal dies. This is the story's low
 * point, so it takes the whole screen and gives the pilot a moment before anyone speaks.
 */
export function LossMoment({ onReady, friend, settled, onContinue }: MomentProps) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = window.setTimeout(onReady, LOSS_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [onReady]);
  return (
    <div className="moment moment-loss" data-testid="loss-moment" data-opening-free="">
      <div className="moment-flash" aria-hidden="true" />
      <div className="moment-ship" aria-hidden="true">
        <div className="moment-hull" />
        {SHARDS.map((shard) => (
          <span key={shard} className={`moment-shard s${shard}`} />
        ))}
      </div>
      <p className="moment-alert" role="alert">
        {t('prologue.moment.signalLost')}
      </p>
      <p className="moment-caption">{t('prologue.moment.lossCaption', { friend })}</p>
      {settled && (
        <div className="moment-columns" data-testid="loss-columns">
          <section className="moment-col lost">
            <h2>{t('prologue.loss.lostTitle')}</h2>
            <ul>
              <li>
                {LOST_GLYPH} {t('prologue.loss.ship')}
              </li>
              <li>
                {LOST_GLYPH} {t('prologue.loss.parts')}
              </li>
              <li>
                {LOST_GLYPH} {t('prologue.loss.friend', { friend })}
              </li>
            </ul>
          </section>
          <section className="moment-col saved">
            <h2>{t('prologue.loss.savedTitle')}</h2>
            <ul>
              <li>
                {SAVED_GLYPH} {t('prologue.loss.player')}
              </li>
              <li>
                {SAVED_GLYPH} {t('prologue.loss.credits')}
              </li>
            </ul>
          </section>
        </div>
      )}
      {settled && (
        <button
          type="button"
          className="btn primary moment-continue"
          data-testid="loss-continue"
          onClick={onContinue}
          autoFocus
        >
          {t('prologue.director.continue')}
        </button>
      )}
    </div>
  );
}

/**
 * The rescue: stars, a cutter coming in out of the dark with its light on the wreck. Quiet after the loss, and warm.
 */
export function RescueMoment({ onReady, friend }: Pick<MomentProps, 'onReady' | 'friend'>) {
  const { t } = useTranslation();
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
      <p className="moment-caption rescue">{t('prologue.moment.rescueCaption')}</p>
      <ul className="moment-verdict" data-testid="rescue-verdict">
        <li className="saved">
          {SAVED_GLYPH} {t('prologue.moment.rescued')}
        </li>
        <li className="lost">
          {LOST_GLYPH} {t('prologue.moment.friendLost', { friend })}
        </li>
      </ul>
    </div>
  );
}
