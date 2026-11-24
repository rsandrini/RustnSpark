import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { ActiveMission, ShipResponse } from '../../api/generated';
import { useAuth } from '../../features/auth/auth.hooks';
import { usePrologueMode } from '../../features/prologue/prologue-mode';
import { Gauge } from '../Gauge';
import { Tooltip } from '../kit/Tooltip';
import { useIsPhone } from '../useIsPhone';
import { formatHudNumber, hudModel } from './hud-model';

const Glyph = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const FUEL_ICON = (
  <Glyph>
    <path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" />
  </Glyph>
);
const HULL_ICON = (
  <Glyph>
    <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" />
  </Glyph>
);
const CARGO_ICON = (
  <Glyph>
    <path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" />
  </Glyph>
);

/**
 * The ship's state under the top bar: fuel (with the accepted mission's reserve as a tick), hull and
 * cargo, each a gauge with its tooltip card (hover, focus or tap). Renders no wallet: the account
 * menu's chip owns the money. On a phone it is one compact row of icon + number gauges.
 */
export function Hud() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const phone = useIsPhone();
  const opening = usePrologueMode();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const activeQuery = useQuery({
    queryKey: ['active'],
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const ship = shipsQuery.data?.[0];
  if (user?.factionId == null && !opening.active) return null;
  const rowClass = `hud${phone ? ' hud--compact' : ''}`;
  // The ships are on their way: keep the row's height from the first paint (no gauges, no placeholder) so the page does
  // not jump when they land. No ship once settled collapses the row.
  if (ship === undefined) {
    return shipsQuery.isPending ? (
      <section
        className={`${rowClass} hud--pending`}
        aria-label={t('hud.label')}
        aria-busy="true"
      />
    ) : null;
  }

  const accepted = (activeQuery.data ?? []).find((entry) => entry.status === 'ACCEPTED');
  const model = hudModel(ship, accepted);
  const n = (value: number) => formatHudNumber(value, i18n.language, false);
  const short = (value: number) => formatHudNumber(value, i18n.language, phone);
  const pill = (name: string, text: string) => (phone ? text : `${name} ${text}`);

  const gauges: { key: string; node: ReactNode }[] = [];
  if (model.fuel !== null) {
    const { value, max, reserve, tone } = model.fuel;
    const tip = [
      value <= 0 ? t('hud.tip.fuelEmpty') : t('hud.tip.fuel'),
      reserve === undefined
        ? ''
        : t(reserve <= max ? 'hud.tip.fuelReserve' : 'hud.tip.fuelReserveOver', {
            reserve: n(reserve),
          }),
    ]
      .filter((part) => part !== '')
      .join(' ');
    gauges.push({
      key: 'fuel',
      node: (
        <Tooltip content={tip} describe align="start">
          <Gauge
            value={value}
            max={max}
            reserve={reserve}
            tone={tone}
            icon={FUEL_ICON}
            label={pill(t('hud.fuel'), `${short(value)}/${short(max)}`)}
            ariaLabel={t('hud.aria.fuel', { value: n(value), max: n(max) })}
            tabIndex={0}
          />
        </Tooltip>
      ),
    });
  }
  if (model.hull !== null) {
    const { value, max, tone } = model.hull;
    gauges.push({
      key: 'hull',
      node: (
        <Tooltip content={t('hud.tip.hull')} describe align="start">
          <Gauge
            value={value}
            max={max}
            tone={tone}
            icon={HULL_ICON}
            label={pill(t('hud.hull'), `${n(value)}%`)}
            ariaLabel={t('hud.aria.hull', { value: n(value) })}
            tabIndex={0}
          />
        </Tooltip>
      ),
    });
  }
  if (model.cargo !== null) {
    const { used, max } = model.cargo;
    gauges.push({
      key: 'cargo',
      node: (
        <Tooltip content={t('hud.tip.cargo')} describe align="end">
          <Gauge
            value={used}
            max={max}
            tone="ok"
            icon={CARGO_ICON}
            label={pill(t('hud.cargo'), `${short(used)}/${short(max)}`)}
            ariaLabel={t('hud.aria.cargo', { used: n(used), max: n(max) })}
            tabIndex={0}
          />
        </Tooltip>
      ),
    });
  }

  return (
    <section className={rowClass} aria-label={t('hud.label')}>
      {gauges.map(({ key, node }) => (
        <div key={key} className="hud-cell">
          {node}
        </div>
      ))}
    </section>
  );
}
