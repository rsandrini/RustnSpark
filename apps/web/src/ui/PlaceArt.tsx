import type { CSSProperties, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { client } from '../api/client';
import type { PlaceArtResponse } from '../api/generated';

export type PlaceArtVariant = 'icon' | 'square' | 'wide';

export type PlaceArtMap = PlaceArtResponse['places'];

/** The uploaded place images by place (admin-set); empty until loaded or when nothing was uploaded. */
export function usePlaceArt(): PlaceArtMap {
  const query = useQuery({
    queryKey: ['placeArt'],
    queryFn: () => client.get<PlaceArtResponse>('/v1/places/art'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return query.data?.places ?? {};
}

/** Where a place's art lives: the uploaded image if any, else the built-in file (generated SVG
    placeholders; replacing them keeps every screen). */
export function placeArtUrl(placeId: string, variant: PlaceArtVariant, art: PlaceArtMap = {}): string {
  return art[placeId]?.[variant] ?? `/places/${placeId}.${variant}.svg`;
}

const DEFAULT_ID = '_default';

// The art can be missing for a place added later: fall back to the generic set instead of a broken image.
function withFallback(event: { currentTarget: HTMLImageElement }, variant: PlaceArtVariant): void {
  const image = event.currentTarget;
  const fallback = `/places/${DEFAULT_ID}.${variant}.svg`;
  if (!image.src.endsWith(fallback)) image.src = fallback;
}

export interface PlaceArtProps {
  placeId: string;
  variant: PlaceArtVariant;
  className?: string;
}

/** Decorative picture of a place (icon, square or wide). The place's name is always text nearby. */
export function PlaceArt({ placeId, variant, className }: PlaceArtProps) {
  const art = usePlaceArt();
  return (
    <img
      className={`place-art place-art-${variant}${className === undefined ? '' : ` ${className}`}`}
      src={placeArtUrl(placeId, variant, art)}
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
  const art = usePlaceArt();
  const style: CSSProperties = {
    backgroundImage: `linear-gradient(90deg, rgba(11,14,19,0.85), rgba(11,14,19,0.2)), url(${placeArtUrl(placeId, 'wide', art)}), url(${placeArtUrl(DEFAULT_ID, 'wide')})`,
  };
  return (
    <div className={`place-banner${className === undefined ? '' : ` ${className}`}`} style={style}>
      {children}
    </div>
  );
}
