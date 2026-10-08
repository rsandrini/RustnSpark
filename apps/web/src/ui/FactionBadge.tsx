import { useTranslation } from 'react-i18next';
import { useFactionArt } from './factionArt';

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
  // The faction's uploaded logo (admin-set) sits in front of its name; none uploaded = text only.
  const logo = useFactionArt()[factionId]?.logo ?? null;
  return (
    <span className={`fac ${className}`}>
      {logo !== null && <img className="fac-logo" src={logo} alt="" />}
      {label}
    </span>
  );
}
