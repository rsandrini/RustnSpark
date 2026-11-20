import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ShipResponse } from '../../api/generated';
import { Countdown } from '../../ui/Countdown';
import { Popup } from '../../ui/Popup';
import { TowMiniMap } from './tow-minimap';
import '../../styles/floating.css';

type Mode = 'now' | 'wait';
type Rescue = NonNullable<ShipResponse['rescue']>;

const SECONDS_PER_MINUTE = 60;

export interface FloatingPopupProps {
  open: boolean;
  ship: ShipResponse;
  onClose: () => void;
  rescue: Rescue;
  baseName: string;
  /** The option the pilot picked, waiting for the yes: the popup shows its confirmation. */
  confirming: Mode | null;
  onPick: (mode: Mode | null) => void;
  onConfirm: (mode: Mode) => void;
  busy: boolean;
  onElapsed: () => void;
}

/** A small ship drifting with its engines dark, a distress beacon blinking: pure CSS, no thrust flame. */
function DriftingShip() {
  return (
    <svg className="floatpop-ship" viewBox="0 0 220 110" role="img" aria-label="">
      <g className="floatpop-drift">
        <path className="floatpop-hull" d="M30 55 L88 28 L176 36 L196 55 L176 74 L88 82 Z" />
        <path className="floatpop-fin" d="M92 30 L116 8 L128 34 Z M92 80 L116 102 L128 76 Z" />
        <circle className="floatpop-glass" cx="150" cy="55" r="9" />
        <rect className="floatpop-nozzle" x="22" y="46" width="12" height="18" rx="3" />
        <circle className="floatpop-beacon" cx="116" cy="8" r="3.5" />
      </g>
    </svg>
  );
}

/**
 * The floating ship's own screen: a big popup with the ship drifting without thrust, what happened (why the tank ran
 * dry, from the run that left it adrift) and the two ways out. The prices are the server's.
 */
export function FloatingPopup({
  open,
  ship,
  onClose,
  rescue,
  baseName,
  confirming,
  onPick,
  onConfirm,
  busy,
  onElapsed,
}: FloatingPopupProps) {
  const { t, i18n } = useTranslation();
  const money = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const waiting = rescue.dueAt != null;
  const minutes = Math.max(1, Math.round(rescue.waitSeconds / SECONDS_PER_MINUTE));
  const cause = rescue.cause ?? null;
  const leaked = cause !== null && cause.leakLost > 0;
  const pumped = cause !== null && cause.pumpWasted > 0;
  return (
    <Popup open={open} title={t('rescue.title')} onClose={onClose} className="floatpop">
      <div className="floatpop-stage" aria-hidden="true">
        <span className="floatpop-stars" />
        <DriftingShip />
      </div>
      <p className="floatpop-lead">{t('rescue.popup.lead')}</p>
      <section className="floatpop-why" data-testid="floating-why">
        <h3>{t('rescue.popup.whyTitle')}</h3>
        {cause === null ? (
          <p>{t('rescue.popup.whyUnknown')}</p>
        ) : (
          <>
            <p>{t('rescue.popup.whyEnough')}</p>
            <ul>
              {leaked && <li>{t('rescue.popup.whyLeak', { lost: Math.round(cause.leakLost) })}</li>}
              {pumped && (
                <li>{t('rescue.popup.whyPump', { wasted: Math.round(cause.pumpWasted) })}</li>
              )}
              <li>{t('rescue.popup.whyDry', { leg: cause.leg })}</li>
            </ul>
            {(leaked || pumped) && <p className="sub">{t('rescue.popup.tip')}</p>}
          </>
        )}
      </section>
      <TowMiniMap ship={ship} />
      <p className="sub">
        {t('rescue.nearestBase', { base: baseName, distance: rescue.baseDistance })}{' '}
        <Link to="/map" className="floatpop-maplink" data-testid="floating-map-link">
          {t('rescue.popup.seeOnMap')}
        </Link>
      </p>
      {waiting && rescue.dueAt != null && (
        <p className="notice" role="status" data-testid="rescue-waiting">
          {t('rescue.waiting')} <Countdown until={rescue.dueAt} onElapsed={onElapsed} />
        </p>
      )}
      {confirming === null ? (
        <div className="floatpop-options">
          <button
            type="button"
            className="floatpop-option"
            disabled={busy || waiting}
            onClick={() => onPick('wait')}
          >
            <b>{t('rescue.popup.waitTitle')}</b>
            <span className="floatpop-price">
              {t('rescue.popup.price', { cost: money(rescue.waitCost) })}
            </span>
            <small>{t('rescue.popup.waitSub', { minutes })}</small>
            <span className="floatpop-choose">{t('rescue.popup.choose')}</span>
          </button>
          <button
            type="button"
            className="floatpop-option primary"
            disabled={busy}
            onClick={() => onPick('now')}
          >
            <b>{t('rescue.popup.nowTitle')}</b>
            <span className="floatpop-price">
              {t('rescue.popup.price', { cost: money(rescue.nowCost) })}
            </span>
            <small>{t('rescue.popup.nowSub')}</small>
            <span className="floatpop-choose">{t('rescue.popup.choose')}</span>
          </button>
        </div>
      ) : (
        <div className="floatpop-confirm stack">
          <p>
            {confirming === 'wait'
              ? t('rescue.confirmWait', { cost: rescue.waitCost, base: baseName, minutes })
              : t('rescue.confirmNow', { cost: rescue.nowCost, base: baseName })}
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => onPick(null)}>
              {t('rescue.popup.back')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => onConfirm(confirming)}
            >
              {confirming === 'wait' ? t('rescue.waitAction') : t('rescue.nowAction')}
            </button>
          </div>
        </div>
      )}
      <p className="sub">{t('rescue.popup.negative')}</p>
    </Popup>
  );
}
