import { useTranslation } from 'react-i18next';

// Faction ids are server data; the color mapping mirrors the prototypes' palette.
const FACTION_CLASS: Record<string, string> = {
  luna: 'luna',
  sun: 'sun',
  explorers: 'explorers',
  pirates: 'pirata',
};

export interface FactionBadgeProps {
  factionId: string;
}

export function FactionBadge({ factionId }: FactionBadgeProps) {
  const { t } = useTranslation();
  const className = FACTION_CLASS[factionId] ?? 'neutro';
  const label = t(`factions.${factionId}`, { defaultValue: t('factions.independent') });
  return <span className={`fac ${className}`}>{label}</span>;
}
