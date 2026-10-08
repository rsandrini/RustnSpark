import { useFactions } from './factions';

const DEFAULT_FACTION = '_default';

export type FactionArtMap = Record<
  string,
  { banner: string | null; logo: string | null; background: string | null }
>;

/** The uploaded images by faction (admin-set); empty until loaded or when nothing was uploaded. */
export function useFactionArt(): FactionArtMap {
  const { list } = useFactions();
  const art: FactionArtMap = {};
  for (const faction of list) if (faction.art !== null) art[faction.id] = faction.art;
  return art;
}

/** The built-in banner (a generated placeholder SVG) a faction shows until an admin uploads one. */
export function defaultFactionBannerUrl(faction: string): string {
  return `/factions/${faction}.wide.svg`;
}

/** Where a faction's banner lives: the uploaded image if any, else the built-in default. */
export function factionArtUrl(faction: string, art: FactionArtMap = {}): string {
  return art[faction]?.banner ?? defaultFactionBannerUrl(faction);
}

/**
 * Backdrop for a faction card: the art layered over a darkening gradient so the text on top stays
 * readable, with `_default` painted underneath as a fallback (a failed image layer is simply
 * transparent, so the default shows through — same trick as `PlaceBanner`).
 */
export function factionCardStyle(
  faction: string,
  art: FactionArtMap = {},
): { backgroundImage: string } {
  return {
    backgroundImage: `linear-gradient(100deg, rgba(11,14,19,0.88) 0%, rgba(11,14,19,0.55) 55%, rgba(11,14,19,0.25) 100%), url(${factionArtUrl(faction, art)}), url(${defaultFactionBannerUrl(DEFAULT_FACTION)})`,
  };
}
