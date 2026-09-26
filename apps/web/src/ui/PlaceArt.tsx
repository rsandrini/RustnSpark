import type { CSSProperties, ReactNode } from 'react';

export type PlaceArtVariant = 'icon' | 'square' | 'wide';

/** Where a place's art lives. The files are placeholders (generated SVG); replacing them keeps every screen. */
export function placeArtUrl(placeId: string, variant: PlaceArtVariant): string {
  return `/places/${placeId}.${variant}.svg`;
}

const DEFAULT_ID = '_default';

// The art can be missing for a place added later: fall back to the generic set instead of a broken image.
function withFallback(event: { currentTarget: HTMLImageElement }, variant: PlaceArtVariant): void {
  const image = event.currentTarget;
  const fallback = placeArtUrl(DEFAULT_ID, variant);
  if (!image.src.endsWith(fallback)) image.src = fallback;
}

export interface PlaceArtProps {
  placeId: string;
  variant: PlaceArtVariant;
  className?: string;
}

/** Decorative picture of a place (icon, square or wide). The place's name is always text nearby. */
export function PlaceArt({ placeId, variant, className }: PlaceArtProps) {
  return (
    <img
      className={`place-art place-art-${variant}${className === undefined ? '' : ` ${className}`}`}
      src={placeArtUrl(placeId, variant)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={(event) => withFallback(event, variant)}
    />
  );
}

export interface PlaceBannerProps {
  placeId: string;
  children?: ReactNode;
  className?: string;
}

/** The wide picture of a place as a background, with content laid over it. */
export function PlaceBanner({ placeId, children, className }: PlaceBannerProps) {
  const style: CSSProperties = {
    backgroundImage: `linear-gradient(90deg, rgba(11,14,19,0.85), rgba(11,14,19,0.2)), url(${placeArtUrl(placeId, 'wide')}), url(${placeArtUrl(DEFAULT_ID, 'wide')})`,
  };
  return (
    <div className={`place-banner${className === undefined ? '' : ` ${className}`}`} style={style}>
      {children}
    </div>
  );
}
