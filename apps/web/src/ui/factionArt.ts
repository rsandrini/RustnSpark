const DEFAULT_FACTION = '_default';

/** Where a faction's onboarding backdrop lives. Placeholder (generated SVG); the owner will replace it. */
export function factionArtUrl(faction: string): string {
  return `/factions/${faction}.wide.svg`;
}

/**
 * Backdrop for a faction card: the art layered over a darkening gradient so the text on top stays
 * readable, with `_default` painted underneath as a fallback (a failed image layer is simply
 * transparent, so the default shows through — same trick as `PlaceBanner`).
 */
export function factionCardStyle(faction: string): { backgroundImage: string } {
  return {
    backgroundImage: `linear-gradient(100deg, rgba(11,14,19,0.88) 0%, rgba(11,14,19,0.55) 55%, rgba(11,14,19,0.25) 100%), url(${factionArtUrl(faction)}), url(${factionArtUrl(DEFAULT_FACTION)})`,
  };
}
