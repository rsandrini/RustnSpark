export const SHIP_CLASSES = ['hauler', 'transport', 'warship', 'miner', 'multirole'] as const;
export type ShipClass = (typeof SHIP_CLASSES)[number];

export const MISSION_KINDS = [
  { id: 'delivery', start: 'board' },
  { id: 'transport', start: 'board' },
  { id: 'escort', start: 'board' },
  { id: 'mining', start: 'board' },
  { id: 'rescue', start: 'board' },
  { id: 'race', start: 'board' },
  { id: 'scavenge', start: 'own' },
  { id: 'travel', start: 'own' },
] as const satisfies readonly { readonly id: MissionKind; readonly start: 'board' | 'own' }[];
export type MissionKind =
  | 'delivery'
  | 'transport'
  | 'escort'
  | 'mining'
  | 'rescue'
  | 'race'
  | 'scavenge'
  | 'travel';

export interface Pin {
  readonly n: 1 | 2 | 3;
  readonly left: number;
  readonly top: number;
}

export const SHOWCASE = {
  build: {
    image: '/landing/ship-builder.webp',
    width: 1280,
    height: 719,
    pins: [
      { n: 1, left: 36, top: 46 },
      { n: 2, left: 84, top: 17.5 },
      { n: 3, left: 24, top: 95 },
    ] as const,
  },
  race: {
    image: '/landing/race.webp',
    width: 1280,
    height: 1026,
    pins: [
      { n: 1, left: 28, top: 28 },
      { n: 2, left: 27, top: 54 },
      { n: 3, left: 73, top: 48 },
    ] as const,
  },
} as const satisfies Record<'build' | 'race', { readonly image: string; readonly width: number; readonly height: number; readonly pins: readonly Pin[] }>;
