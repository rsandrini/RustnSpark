import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RADAR_AXES } from '../../ui/kit/ShipRadar';
import { PartKindIcon } from '../parts/part-kind-icon';
import type { ShipProfile } from '../../api/generated';
import { HelpTip } from '../../ui/kit/HelpTip';

type Axis = keyof ShipProfile;

/** The axis that names the ship's type (what the server's type rule picked), or null for a balanced ship. */
export function mainAxis(shipClass: string | undefined, profile: ShipProfile): Axis | null {
  switch (shipClass) {
    case 'HAULER':
      return 'cargo';
    case 'TRANSPORT':
      return 'passengers';
    case 'WARSHIP':
      return profile.defense > profile.firepower ? 'defense' : 'firepower';
    case 'MINER':
      return 'mining';
    case 'RACER':
      return 'mobility';
    default:
      return null;
  }
}

function pct(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(1, Math.max(0, v)) * 100)
    : 0;
}

/** One row per radar axis: its bar, its percent, and the type marks. */
export function ProfileBreakdown({
  profile,
  ghost,
  shipClass,
  profileModifier,
}: {
  profile: ShipProfile;
  /** The saved profile while a layout preview is on: rows show the preview's change against it. */
  ghost?: ShipProfile | undefined;
  shipClass?: string | undefined;
  profileModifier?: Axis | null | undefined;
}): ReactNode {
  const { t } = useTranslation();
  const main = mainAxis(shipClass, profile);
  return (
    <div className="profile-breakdown" data-testid="profile-breakdown">
      <div className="help-corner">
        <HelpTip align="end">{t('hangar.profileBreakdown.help')}</HelpTip>
      </div>
      <p className="sub profile-breakdown-rule" data-testid="pb-type-rule">
        {t('hangar.profileBreakdown.typeRule')}
      </p>
      <ul className="pb-list">
        {RADAR_AXES.map(({ key, kind }) => {
          const percent = pct(profile[key]);
          const percentText = `${percent}%`;
          const delta = ghost ? percent - pct(ghost[key]) : 0;
          const name = t(`hangar.profile.axis.${key}`);
          return (
            <li key={key} className="pb-row">
              <span className="pb-name">{name}</span>
              <span className="pb-icon" aria-hidden="true">
                <PartKindIcon kind={kind} size={16} />
              </span>
              <span className="pb-marks">
                {main === key && (
                  <b
                    className="pb-mark pb-main"
                    title={
                      shipClass === 'WARSHIP' ? t('hangar.profileBreakdown.warshipNote') : undefined
                    }
                  >
                    {t('hangar.profileBreakdown.main')}
                  </b>
                )}
                {profileModifier === key && (
                  <b className="pb-mark pb-second">{t('hangar.profileBreakdown.second')}</b>
                )}
              </span>
              <small className="pb-hint">
                {t(`hangar.profileBreakdown.drives.${key}`)}
                {main === key && shipClass === 'WARSHIP' && (
                  <em className="pb-note" data-testid="pb-warship-note">
                    {t('hangar.profileBreakdown.warshipNote')}
                  </em>
                )}
              </small>
              <span className="pb-bar" aria-hidden="true">
                <span className="pb-fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="pb-percent">{percentText}</span>
              <span className="pb-delta">
                {delta !== 0 && (
                  <span className={delta > 0 ? 'tone-good' : 'tone-bad'}>
                    {delta > 0 ? `+${delta}` : `${delta}`}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
