export interface RangePlace {
  id: string;
  x: number;
  y: number;
}

export interface RangeLayerProps {
  /** The places drawn at this zoom. */
  places: readonly RangePlace[];
  /** Place id -> distance, for the places the fuel on board reaches. */
  reachable: ReadonlyMap<string, number>;
  /** A ship that burns no fuel reaches every place. */
  unlimited: boolean;
  /** The nodes' shrink factor at this zoom, so the rings match them. */
  scale: number;
}

const HALO_RADIUS = 17;

/** A halo on each place the fuel on board reaches; a small cross on the ones beyond it. */
export function RangeLayer({ places, reachable, unlimited, scale }: RangeLayerProps) {
  return (
    <g className="range-layer" data-testid="range-layer">
      {places.map((place) => {
        const yes = unlimited || reachable.has(place.id);
        return (
          <g
            key={place.id}
            className={yes ? 'range-yes' : 'range-no'}
            data-testid="range-mark"
            data-place={place.id}
            data-reach={yes ? 'yes' : 'no'}
            aria-hidden="true"
            transform={`translate(${place.x} ${place.y}) scale(${scale})`}
          >
            {yes ? (
              <circle className="range-halo" r={HALO_RADIUS} />
            ) : (
              <path
                className="range-cross"
                d="M-10,-10 L-5,-5 M-5,-10 L-10,-5"
                transform="translate(15 -3)"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
