interface Leg {
  fromId: string;
  toId: string;
}

export interface TripPreviewLayerProps {
  /** The legs of the quote; nothing is drawn without any. */
  legs: readonly Leg[] | undefined;
  places: ReadonlyMap<string, { x: number; y: number }>;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The planned route, drawn as one dashed path from the ship through the quote's legs; the dashes march unless motion is reduced. */
export function TripPreviewLayer({ legs, places }: TripPreviewLayerProps) {
  if (legs === undefined || legs.length === 0) return null;
  const ids = [legs[0]!.fromId, ...legs.map((leg) => leg.toId)];
  const stops = ids.map((id) => places.get(id));
  if (stops.some((stop) => stop === undefined)) return null;
  const points = stops.map((stop) => `${stop!.x},${stop!.y}`).join(' ');
  return (
    <polyline
      className={`trip-preview${prefersReducedMotion() ? '' : ' trip-preview-anim'}`}
      data-testid="trip-preview"
      points={points}
      aria-hidden="true"
    />
  );
}
