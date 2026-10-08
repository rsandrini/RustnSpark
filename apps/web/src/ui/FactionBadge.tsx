import { useTranslation } from 'react-i18next';
import { factionName, useFactions } from './factions';

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
  const { t, i18n } = useTranslation();
  const faction = useFactions().byId[factionId];
  const className = FACTION_CLASS[factionId] ?? 'neutro';
  // Name and colour are the admin's (database); the language file is only the fallback while
  // that loads, for a faction the server does not list, or for "independent".
  const label =
    factionName(faction, i18n.language) ??
    t(`factions.${factionId}`, { defaultValue: t('factions.independent') });
  const logo = faction?.art?.logo ?? null;
  return (
    <span
      className={`fac ${className}`}
      style={faction === undefined ? undefined : { color: faction.color, borderColor: faction.color }}
    >
      {logo !== null && <img className="fac-logo" src={logo} alt="" />}
      {label}
    </span>
  );
}
