import type { GiverRef } from '../api/generated';
import { pickLocalized } from '../i18n/localized';
import { useFactions } from './factions';

// A quest giver's face on the board card, the board row, the report and the tutorial header
// (plan §1). The portrait is an admin upload; while none exists the faction symbol on the
// faction colour stands in, so every build looks finished. The name is server data and never
// translated; the title arrives already in the player's language (the caller picks it from the
// bilingual pair with pickLocalized).
export type GiverBadgeSize = 'row' | 'card' | 'tutorial';

export interface GiverBadgeProps {
  name: string;
  /** Already localized by the caller (the contract title is bilingual). */
  title?: string | null;
  /** Served URL of the uploaded portrait; null/undefined → faction-symbol placeholder. */
  portraitUrl?: string | null;
  factionId: string;
  /** row = 48 px (board rows), card = 96 px (open card), tutorial = the checklist header. */
  size?: GiverBadgeSize;
}

/** Props for the badge from a server giver ref, with the bilingual title already picked. */
export function giverBadgeOf(giver: GiverRef, language: string): GiverBadgeProps {
  return {
    name: giver.name,
    title: pickLocalized(giver.title, language),
    portraitUrl: giver.portraitUrl,
    factionId: giver.factionId,
  };
}

// Faction ids are server data; the colour mapping mirrors the prototypes' palette
// (same map as FactionBadge — the tokens are --luna, --sun, --explorers, --pirata).
const FACTION_CLASS: Record<string, string> = {
  luna: 'luna',
  sun: 'sun',
  explorers: 'explorers',
  pirates: 'pirata',
};

export function GiverBadge({ name, title, portraitUrl, factionId, size = 'row' }: GiverBadgeProps) {
  const faction = useFactions().byId[factionId];
  const factionClass = FACTION_CLASS[factionId] ?? 'neutro';
  const logo = faction?.art?.logo ?? null;
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <span className={`giver-badge ${size}`}>
      {portraitUrl !== null && portraitUrl !== undefined && portraitUrl !== '' ? (
        // Decorative: the name sits right next to it, so an empty alt avoids announcing it twice.
        <img className="giver-portrait" src={portraitUrl} alt="" />
      ) : (
        <span
          className={`giver-fac ${factionClass}`}
          style={faction === undefined ? undefined : { color: faction.color }}
          aria-hidden="true"
        >
          {logo !== null && logo !== '' ? (
            <img className="giver-fac-logo" src={logo} alt="" />
          ) : (
            initial
          )}
        </span>
      )}
      <span className="giver-text">
        <span className="giver-name">{name}</span>
        {title !== null && title !== undefined && title !== '' && (
          <span className="giver-title">{title}</span>
        )}
      </span>
    </span>
  );
}
