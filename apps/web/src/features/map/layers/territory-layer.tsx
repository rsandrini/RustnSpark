import { useTranslation } from 'react-i18next';
import type { PublicFaction } from '../../../api/generated';
import { factionName } from '../../../ui/factions';
import type { Territory } from '../territories';

// Built-in fallback colours; the admin-edited faction colour (database) wins when the server lists it.
const FACTION_VAR: Record<string, string> = {
  luna: '--luna',
  sun: '--sun',
  explorers: '--explorers',
  pirates: '--pirata',
};

export interface TerritoryLayerProps {
  territories: readonly Territory[];
  factions: Readonly<Record<string, PublicFaction>>;
  /** Map units per screen unit shrink factor (the same one the nodes use), so labels stay readable. */
  scale: number;
}

/** Soft faction areas under the routes: a faint circle, a dashed edge and the faction name on top. */
export function TerritoryLayer({ territories, factions, scale }: TerritoryLayerProps) {
  const { t, i18n } = useTranslation();
  return (
    <g className="territory-layer" data-testid="territory-layer" aria-hidden="true">
      {territories.map((territory) => {
        const faction = factions[territory.factionId];
        const color = faction?.color ?? `var(${FACTION_VAR[territory.factionId] ?? '--neutro'})`;
        const name =
          factionName(faction, i18n.language) ??
          t(`factions.${territory.factionId}`, { defaultValue: t('factions.independent') });
        return (
          <g
            key={territory.factionId}
            className="territory"
            data-testid="territory"
            data-faction={territory.factionId}
            style={{ color }}
          >
            <circle
              className="territory-area"
              cx={territory.cx}
              cy={territory.cy}
              r={territory.radius}
            />
            <text
              className="territory-label"
              x={territory.cx}
              y={territory.cy - territory.radius + 14 * scale}
              style={{ fontSize: 10 * scale }}
            >
              {name.toUpperCase()}
            </text>
          </g>
        );
      })}
    </g>
  );
}
