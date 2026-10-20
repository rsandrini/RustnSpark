import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fuelStatus } from './fuel-status';

/**
 * Fuel on a mission card, in one place: a sentence with the three numbers (what you have, what the trip needs, what the
 * tank holds), a bar with all three on one scale (the trip's share is drawn from the fuel aboard back towards empty), the verdict in a word and the action that fixes it. Amber means
 * "refuelling fixes it", red means "this tank cannot, ever".
 */
export function FuelBlock({ have, needed, cap }: { have: number; needed: number; cap: number }) {
  const { t } = useTranslation();
  const status = fuelStatus(have, needed, cap);
  const pct = (amount: number) => `${Math.min(100, (amount / status.scale) * 100)}%`;
  // The trip burns fuel from the full end of the fill backwards: the part it uses is drawn ending at what is aboard.
  const left = Math.max(0, status.have - status.needed);
  return (
    <div
      className={`mcard-fuel fuel-${status.state}`}
      data-testid="mcard-fuel"
      data-state={status.state}
    >
      <p className="fuel-line">
        <Trans
          i18nKey="board.fuel.sentence"
          values={{ have: status.have, needed: status.needed, cap: status.cap }}
          components={{ need: <b className="fuel-need" /> }}
        />{' '}
        <span className="fuel-verdict" data-testid="fuel-verdict">
          {t(`board.fuel.state.${status.state}`, { missing: status.missing })}
        </span>
      </p>
      <div
        className="fuel-bar"
        role="progressbar"
        aria-label={t('board.facts.fuel')}
        aria-valuemin={0}
        aria-valuemax={status.scale}
        aria-valuenow={status.have}
      >
        <div className="fuel-fill" style={{ width: pct(status.have) }} />
        <div
          className="fuel-burn"
          data-testid="fuel-burn"
          style={{ left: pct(left), width: pct(status.have - left) }}
        />
        <div className="fuel-mark fuel-mark-need" style={{ left: pct(left) }} />
        {status.scale > status.cap && (
          <div className="fuel-mark fuel-mark-cap" style={{ left: pct(status.cap) }} />
        )}
      </div>
      {status.state === 'short' && (
        <Link className="fuel-action" to={`/port?tab=refuel&units=${status.missing}`}>
          {t('board.fuel.refuel', { missing: status.missing })}
        </Link>
      )}
      {status.state === 'tank' && (
        <Link className="fuel-action" to="/port?tab=market">
          {t('board.fuel.biggerTank')}
        </Link>
      )}
    </div>
  );
}
