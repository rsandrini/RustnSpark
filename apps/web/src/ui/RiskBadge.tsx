import { useTranslation } from 'react-i18next';

export type RiskBand = 'lo' | 'md' | 'hi';

export interface RiskBadgeProps {
  band: RiskBand;
}

// Server-computed band (world endpoint / derived from location zone) — the client
// only translates and colors it (GDD §2: no client-side risk rules).
export function RiskBadge({ band }: RiskBadgeProps) {
  const { t } = useTranslation();
  return (
    <span className={`risk ${band}`} aria-label={t(`ui.risk.${band}`)}>
      {t(`ui.risk.${band}`)}
    </span>
  );
}
