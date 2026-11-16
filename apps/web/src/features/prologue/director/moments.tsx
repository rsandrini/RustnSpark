import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './moments.css';

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
 * The rescue: stars, a cutter coming in out of the dark with its light on the wreck. Quiet after the loss, and warm.
 */
export function RescueMoment({
  onReady,
  friend,
  grant = 0,
}: Pick<MomentProps, 'onReady' | 'friend'> & {
  /** The credits that reach the pilot after the rescue (the rest of the start credits); nothing when 0. */
  grant?: number;
}) {
  const { t, i18n } = useTranslation();
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
        {grant > 0 && (
          <li className="grant" data-testid="rescue-grant">
            {t('prologue.moment.rescueGrant', {
              amount: new Intl.NumberFormat(i18n.language).format(grant),
            })}
          </li>
        )}
      </ul>
    </div>
  );
}
