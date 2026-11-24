import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { ActiveMission, ShipResponse } from '../../api/generated';
import { useAuth } from '../../features/auth/auth.hooks';
import { Gauge } from '../Gauge';
import { Tooltip } from '../kit/Tooltip';
import { useIsPhone } from '../useIsPhone';
import { hudModel } from './hud-model';

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
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const activeQuery = useQuery({
    queryKey: ['active'],
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const ship = shipsQuery.data?.[0];
  if (user?.factionId == null || ship === undefined) return null;

  const accepted = (activeQuery.data ?? []).find((entry) => entry.status === 'ACCEPTED');
  const model = hudModel(ship, accepted);
  const num = new Intl.NumberFormat(i18n.language);
  const n = (value: number) => num.format(value);
  const pill = (name: string, text: string) => (phone ? text : `${name} ${text}`);

  const gauges: { key: string; node: ReactNode }[] = [];
  if (model.fuel !== null) {
    const { value, max, reserve, tone } = model.fuel;
    const tip = [
      value <= 0 ? t('hud.tip.fuelEmpty') : t('hud.tip.fuel', { value: n(value), max: n(max) }),
      reserve === undefined ? '' : t('hud.tip.fuelReserve', { reserve: n(reserve) }),
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
            label={pill(t('hud.fuel'), `${n(value)}/${n(max)}`)}
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
        <Tooltip content={t('hud.tip.hull', { value: n(value) })} describe align="start">
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
        <Tooltip
          content={
            max > 0 ? t('hud.tip.cargo', { used: n(used), max: n(max) }) : t('hud.tip.cargoNone')
          }
          describe
          align="end"
        >
          <Gauge
            value={used}
            max={max}
            tone="ok"
            icon={CARGO_ICON}
            label={pill(t('hud.cargo'), `${n(used)}/${n(max)}`)}
            ariaLabel={t('hud.aria.cargo', { used: n(used), max: n(max) })}
            tabIndex={0}
          />
        </Tooltip>
      ),
    });
  }

  return (
    <div className={`hud${phone ? ' hud--compact' : ''}`} role="group" aria-label={t('hud.group')}>
      {gauges.map(({ key, node }) => (
        <div key={key} className="hud-cell">
          {node}
        </div>
      ))}
    </div>
  );
}
