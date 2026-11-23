import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface StatPipProps {
  icon: ReactNode;
  value: number | string;
  /** The change against what is installed now (new minus old): an arrow and the size of the change. */
  compare?: number;
  label: string;
}

/** An icon and a number (instead of "Thrust 25"), with an optional up or down arrow for a comparison. */
export function StatPip({ icon, value, compare, label }: StatPipProps) {
  const { t } = useTranslation();
  const change = compare === undefined || compare === 0 ? null : compare;
  const size = change === null ? 0 : Math.abs(change);
  const aria =
    change === null
      ? t('kit.stat.plain', { label, value })
      : t(change > 0 ? 'kit.stat.up' : 'kit.stat.down', { label, value, diff: size });
  const diff = `${change !== null && change > 0 ? '▲' : '▼'} ${size}`;
  return (
    <span className="kit-stat" role="img" aria-label={aria}>
      <span className="kit-stat-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="kit-stat-value" aria-hidden="true">
        {value}
      </span>
      {change !== null && (
        <span className={`kit-stat-diff ${change > 0 ? 'up' : 'down'}`} aria-hidden="true">
          {diff}
        </span>
      )}
    </span>
  );
}
