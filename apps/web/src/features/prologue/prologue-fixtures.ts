import type {
  ConnectorCell,
  LocalizedText,
  PartCatalogStats,
  Placement,
  WorldLocation,
  WorldResponse,
} from '../../api/generated';

/*
 * What the new-pilot opening shows: a small ship that has no engine yet, the parts the friend hands over, a three-place
 * world and the mission offers. All of it is fixed data in the shapes the real screens take (the yard, the mission card,
 * the route map), so the opening runs on the game's own components. The values come from the seeded catalog (the
 * Bridge, the Hull Frame, the Small Fuel Tank, the Small Chemical Engine and the Cargo Hold, all common).
 */

// ---------------------------------------------------------------------------------------------
// The ship and its parts

/** The ship's format: the classic square (cells relative to the bridge at [0, 0]), as the real ships have. */
export const PROLOGUE_CELLS: readonly [number, number][] = [
  [-4, -1],
  [-4, 0],
  [-4, 1],
  [-3, -2],
  [-3, -1],
  [-3, 0],
  [-3, 1],
  [-3, 2],
  [-2, -2],
  [-2, -1],
  [-2, 0],
  [-2, 1],
  [-2, 2],
  [-1, -2],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [-1, 2],
  [0, -1],
  [0, 0],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
  [2, 0],
];

const NO_STATS = {
  mass: 0,
  structureCost: 0,
  partHp: 0,
  basePrice: 0,
  pot: 0,
  pdf: 0,
  bli: 0,
  esc: 0,
  sen: 0,
  crg: 0,
  min: 0,
  energyCont: 0,
  energyCombat: 0,
  fuelCap: 0,
  fuelUse: 0,
  batCharge: 0,
  batOutput: 0,
  batInput: 0,
  pressurized: false,
  lifeSupport: false,
  pax: 0,
  lifeCap: 0,
} as const;

/** A part of the opening: its catalog figures, its ports and its names. `target` is where it belongs. */
export interface ProloguePart {
  readonly id: string;
  readonly name: LocalizedText;
  readonly catalog: PartCatalogStats;
  /** Ports in the part's own (authored) cells; a side with kind `none` carries no port. */
  readonly connectors: readonly ConnectorCell[];
  readonly rarity: 'COMMON' | 'UNCOMMON';
  /** How worn it is, in percent (the ship is old: its first parts are far from new). Default 100. */
  readonly condition?: number;
  /** The one spot (and turn) where the part joins the ship, for the guide to point at. */
  readonly target: Placement;
}

const central = (dx: number, dy: number, side: ConnectorCell['side']): ConnectorCell => ({
  dx,
  dy,
  side,
  kind: 'central',
});
const universal = (dx: number, dy: number, side: ConnectorCell['side']): ConnectorCell => ({
  dx,
  dy,
  side,
  kind: 'universal',
});

export const PROLOGUE_BRIDGE: ProloguePart = {
  id: 'prologue-bridge',
  name: { en: 'Bridge', 'pt-BR': 'Ponte de Comando' },
  catalog: {
    ...NO_STATS,
    partType: 'bridge',
    partClass: 'BRIDGE',
    w: 1,
    h: 1,
    mass: 4,
    structureCost: -60,
    partHp: 30,
    energyCont: -1,
  },
  connectors: [central(0, 0, 'W'), central(0, 0, 'E')],
  rarity: 'COMMON',
  condition: 52,
  target: { partInstanceId: 'prologue-bridge', gx: 0, gy: 0, rot: 0 },
};

export const PROLOGUE_TANK: ProloguePart = {
  id: 'prologue-tank',
  name: { en: 'Small Fuel Tank', 'pt-BR': 'Tanque de Combustível Pequeno' },
  catalog: {
    ...NO_STATS,
    partType: 'tank_small',
    partClass: 'TANK',
    w: 1,
    h: 1,
    mass: 5,
    structureCost: 4,
    partHp: 25,
    basePrice: 2000,
    energyCont: -1,
    fuelCap: 300,
  },
  connectors: [central(0, 0, 'W'), central(0, 0, 'E')],
  rarity: 'COMMON',
  condition: 38,
  target: { partInstanceId: 'prologue-tank', gx: -1, gy: 0, rot: 0 },
};

export const PROLOGUE_HULL: ProloguePart = {
  id: 'prologue-hull',
  name: { en: 'Hull Frame', 'pt-BR': 'Estrutura de Casco' },
  catalog: {
    ...NO_STATS,
    partType: 'hull',
    partClass: 'DEFENSE',
    w: 2,
    h: 1,
    mass: 8,
    structureCost: 5,
    partHp: 65,
    basePrice: 1000,
  },
  connectors: [central(0, 0, 'W'), central(1, 0, 'E')],
  rarity: 'COMMON',
  condition: 30,
  target: { partInstanceId: 'prologue-hull', gx: -3, gy: 0, rot: 0 },
};

/**

 * The hull one tier up, with the figures of the game's own catalog (Hull Frame to Reinforced Hull Frame): lighter, a little
 * lighter on structure and more hit points; a hull gives no armor and no firepower at any tier. Same id and place as the
 * plain hull: the upgrade replaces the part on the ship.
 */
export const PROLOGUE_HULL_UPGRADED: ProloguePart = {
  ...PROLOGUE_HULL,
  name: { en: 'Reinforced Hull Frame', 'pt-BR': 'Estrutura de Casco Reforçada' },
  catalog: {
    ...PROLOGUE_HULL.catalog,
    mass: 4,
    structureCost: 4,
    partHp: 80,
  },
  rarity: 'UNCOMMON',
};

/**
 * The friend's engine. It has an exhaust, so it faces west at rot 0: its one port (east) joins the hull's west end,
 * and the cell behind it has to stay empty. A wrong turn or a wrong cell does not connect.
 */
export const PROLOGUE_ENGINE: ProloguePart = {
  id: 'prologue-engine',
  name: { en: 'Small Chemical Engine', 'pt-BR': 'Motor Químico Pequeno' },
  catalog: {
    ...NO_STATS,
    partType: 'engine_chem_small',
    partClass: 'ENGINE',
    w: 1,
    h: 1,
    mass: 3,
    structureCost: 6,
    partHp: 20,
    basePrice: 1000,
    pot: 25,
    energyCont: 2,
    fuelUse: 7,
  },
  connectors: [central(0, 0, 'E')],
  rarity: 'COMMON',
  condition: 46,
  target: { partInstanceId: 'prologue-engine', gx: -4, gy: 0, rot: 0 },
};

/** The second stop's part: a cargo hold that joins the bridge's east side. Its ports are universal, so any turn fits. */
export const PROLOGUE_CARGO: ProloguePart = {
  id: 'prologue-cargo',
  name: { en: 'Cargo Hold', 'pt-BR': 'Compartimento de Carga' },
  catalog: {
    ...NO_STATS,
    partType: 'cargo',
    partClass: 'CARGO',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 4,
    partHp: 15,
    basePrice: 800,
    crg: 5,
  },
  connectors: [
    universal(0, 0, 'N'),
    universal(0, 0, 'E'),
    universal(0, 0, 'S'),
    universal(0, 0, 'W'),
  ],
  rarity: 'COMMON',
  target: { partInstanceId: 'prologue-cargo', gx: 1, gy: 0, rot: 0 },
};

/** The ship as it starts: bridge, tank and hull laid out, no engine. */
export const PROLOGUE_START_PARTS: readonly ProloguePart[] = [
  PROLOGUE_BRIDGE,
  PROLOGUE_TANK,
  PROLOGUE_HULL,
];

/** What the yard needs about a set of parts: the layout and the lookups it reads by instance id. */
export interface PrologueShip {
  readonly cells: readonly [number, number][];
  readonly layout: readonly Placement[];
  readonly catalogById: ReadonlyMap<string, PartCatalogStats>;
  readonly connectorsById: ReadonlyMap<string, readonly ConnectorCell[]>;
  readonly nameById: ReadonlyMap<string, LocalizedText>;
}

/** A ship built from parts, each at its own `target` (a part list without the part still to be fitted). */
export function prologueShip(parts: readonly ProloguePart[]): PrologueShip {
  return {
    cells: PROLOGUE_CELLS,
    layout: parts.map((part) => part.target),
    catalogById: new Map(parts.map((part) => [part.id, part.catalog])),
    connectorsById: new Map(parts.map((part) => [part.id, part.connectors])),
    nameById: new Map(parts.map((part) => [part.id, part.name])),
  };
}

/** The ship at the start (no engine) and after each fitting. */
export const PROLOGUE_SHIP_START = prologueShip(PROLOGUE_START_PARTS);
export const PROLOGUE_SHIP_WITH_ENGINE = prologueShip([...PROLOGUE_START_PARTS, PROLOGUE_ENGINE]);
export const PROLOGUE_SHIP_WITH_CARGO = prologueShip([
  ...PROLOGUE_START_PARTS,
  PROLOGUE_ENGINE,
  PROLOGUE_CARGO,
]);

// ---------------------------------------------------------------------------------------------
// The world

const NEUTRAL = 'neutro';
const HOME = 'prologue-haven';
const NEAR = 'prologue-dockside';
const FAR = 'prologue-cinder';

function place(
  id: string,
  name: LocalizedText,
  x: number,
  y: number,
  zone: number,
  risk: WorldLocation['risk'],
): WorldLocation {
  return {
    id,
    displayName: name,
    description: { en: '', 'pt-BR': '' },
    type: 'station',
    detail: 'main',
    x,
    y,
    zone,
    factionId: NEUTRAL,
    isolation: 0,
    services: {},
    risk,
    missionCount: 0,
  };
}

/** Three places on a small map: home, a near port and a far, dangerous one. */
export const PROLOGUE_WORLD: WorldResponse = {
  locations: [
    place(HOME, { en: 'Haven Station', 'pt-BR': 'Estação Haven' }, 0, 0, 0, 'lo'),
    place(NEAR, { en: 'Dockside Port', 'pt-BR': 'Porto Dockside' }, 90, -40, 0, 'lo'),
    place(FAR, { en: 'Cinder Reach', 'pt-BR': 'Cinder Reach' }, 190, 30, 1, 'hi'),
  ],
  routes: [
    { id: 'prologue-r1', nodeAId: HOME, nodeBId: NEAR, distance: 60, danger: 0, hot: false },
    { id: 'prologue-r2', nodeAId: NEAR, nodeBId: FAR, distance: 90, danger: 6, hot: true },
    { id: 'prologue-r3', nodeAId: HOME, nodeBId: FAR, distance: 120, danger: 6, hot: true },
  ],
};

export const PROLOGUE_PLACES = { home: HOME, near: NEAR, far: FAR } as const;
