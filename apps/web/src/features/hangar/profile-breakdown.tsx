import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RADAR_AXES } from '../../ui/kit/ShipRadar';
import { PartKindIcon } from '../parts/part-kind-icon';
import type { ShipProfile, ShipProfileDetail } from '../../api/generated';

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

/** One row per radar axis: its bar, its raw value over the reference, its percent, and the type marks. */
export function ProfileBreakdown({
  profile,
  detail,
  ghost,
  shipClass,
  profileModifier,
}: {
  profile: ShipProfile;
  detail?: ShipProfileDetail | undefined;
  /** The saved profile while a layout preview is on: rows show the preview's change against it. */
  ghost?: ShipProfile | undefined;
  shipClass?: string | undefined;
  profileModifier?: Axis | null | undefined;
}): ReactNode {
  const { t, i18n } = useTranslation();
  const num = (v: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(v);
  const main = mainAxis(shipClass, profile);
  return (
    <div className="profile-breakdown" data-testid="profile-breakdown">
      <p className="sub profile-breakdown-help">{t('hangar.profileBreakdown.help')}</p>
      <ul className="pb-list">
        {RADAR_AXES.map(({ key, kind }) => {
          const percent = pct(profile[key]);
          const percentText = `${percent}%`;
          const d = detail?.[key];
          const delta = ghost ? percent - pct(ghost[key]) : 0;
          const name = t(`hangar.profile.axis.${key}`);
          return (
            <li
              key={key}
              className="pb-row"
              aria-label={t('hangar.profileBreakdown.row', { axis: name, percent })}
            >
              <span className="pb-name">{name}</span>
              <span className="pb-icon" aria-hidden="true">
                <PartKindIcon kind={kind} size={16} />
              </span>
              <span className="pb-marks">
                {main === key && (
                  <b className="pb-mark pb-main">{t('hangar.profileBreakdown.main')}</b>
                )}
                {profileModifier === key && (
                  <b className="pb-mark pb-second">{t('hangar.profileBreakdown.second')}</b>
                )}
              </span>
              <span className="pb-bar" aria-hidden="true">
                <span className="pb-fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="pb-value">{d ? `${num(d.value)} / ${num(d.ref)}` : ''}</span>
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
