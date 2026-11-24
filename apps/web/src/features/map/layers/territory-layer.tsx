import { useTranslation } from 'react-i18next';
import type { PublicFaction } from '../../../api/generated';
import { factionColorVar, factionName } from '../../../ui/factions';
import { labelFontSize, territoryLabelY, type Territory } from '../territories';

export interface TerritoryLayerProps {
  territories: readonly Territory[];
  factions: Readonly<Record<string, PublicFaction>>;
  /** Map units per screen unit shrink factor (the same one the nodes use), so labels stay readable. */
  scale: number;
  /** The visible window in map units; labels stay inside it. */
  box?: { y: number } | null;
  /** Map units per screen pixel; labels are at least 9px on screen. */
  unitsPerPx?: number;
  /** The factions that get a label (all when omitted). */
  labelled?: ReadonlySet<string>;
}

/** Soft faction areas under the routes: a faint circle, a dashed edge and the faction name on top. */
export function TerritoryLayer({
  territories,
  factions,
  scale,
  box = null,
  unitsPerPx = 0,
  labelled,
}: TerritoryLayerProps) {
  const { t, i18n } = useTranslation();
  return (
    <g className="territory-layer" data-testid="territory-layer" aria-hidden="true">
      {territories.map((territory) => {
        const faction = factions[territory.factionId];
        const color =
          faction?.color ?? `var(${factionColorVar[territory.factionId] ?? '--neutro'})`;
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
            {(labelled === undefined || labelled.has(territory.factionId)) && (
              <text
                className="territory-label"
                x={territory.cx}
                y={territoryLabelY(territory, box, scale)}
                style={{ fontSize: labelFontSize(10 * scale, unitsPerPx) }}
              >
                {name.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
