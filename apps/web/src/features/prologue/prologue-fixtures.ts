import type {
  ConnectorCell,
  LocalizedText,
  MissionOffer,
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
} as const;

/** A part of the opening: its catalog figures, its ports and its names. `target` is where it belongs. */
export interface ProloguePart {
  readonly id: string;
  readonly name: LocalizedText;
  readonly catalog: PartCatalogStats;
  /** Ports in the part's own (authored) cells; a side with kind `none` carries no port. */
  readonly connectors: readonly ConnectorCell[];
  readonly rarity: 'COMMON';
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
  target: { partInstanceId: 'prologue-hull', gx: -3, gy: 0, rot: 0 },
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

// ---------------------------------------------------------------------------------------------
// The mission offers

/** The demo trips are short on purpose (the real game's are longer). */
const DEMO_TRIP_SECONDS = 45;
const DEMO_TRIP_FUEL = 4;
const FAR_TRIP_SECONDS = 70;
const FAR_TRIP_FUEL = 9;
/** What the final run would pay: it never pays, because the run is lost. Shown on the card so the danger is worth it. */
const FINAL_REWARD_FACTOR = 2;

function offerBase(
  id: string,
  type: MissionOffer['type'],
  destinationId: string,
  routeIds: readonly string[],
  reward: number,
): Omit<MissionOffer, 'info'> {
  return {
    id,
    templateId: `prologue-${type.toLowerCase()}`,
    type,
    factionId: NEUTRAL,
    originId: HOME,
    destinationId,
    legs: routeIds.map((routeId) => {
      const route = PROLOGUE_WORLD.routes.find((candidate) => candidate.id === routeId);
      return { routeId, distance: route?.distance ?? 0, danger: route?.danger ?? 0 };
    }),
    cargo: {},
    reward,
    expiresAt: '2999-01-01T00:00:00.000Z',
    status: 'AVAILABLE',
    playerId: null,
    privatePlayerId: null,
    shipId: null,
    acceptedAt: null,
    arrivalAt: null,
    deadlineAt: null,
    seed: id,
    version: 1,
    rewardEstimate: reward,
    eligibility: { eligible: true, reasons: [] },
  };
}

function offerInfo(
  title: LocalizedText,
  description: LocalizedText,
  routeIds: readonly string[],
  seconds: number,
  fuel: number,
  extra: Partial<MissionOffer['info']> = {},
): MissionOffer['info'] {
  const routes = routeIds.map((id) => PROLOGUE_WORLD.routes.find((route) => route.id === id));
  const totalDistance = routes.reduce((sum, route) => sum + (route?.distance ?? 0), 0);
  const peakDanger = routes.reduce((peak, route) => Math.max(peak, route?.danger ?? 0), 0);
  return {
    title,
    description,
    giver: null,
    legCount: routeIds.length,
    totalDistance,
    peakDanger,
    peakZone: peakDanger > 0 ? 1 : 0,
    estimate: { durationSeconds: seconds, fuelNeeded: fuel },
    material: null,
    mining: null,
    requirements: [],
    cargo: null,
    race: null,
    ...extra,
  };
}

/** Everything the opening's boards show; the payouts come from the server so skipping and playing end with the same credits. */
export interface PrologueOffers {
  /** The race (it pays `payouts[0]`). */
  readonly race: MissionOffer;
  /** The first stop: two offers that pay the same (`payouts[1]`), so the choice never changes the money. */
  readonly firstStop: readonly [MissionOffer, MissionOffer];
  /** The second stop, with the hold fitted: two offers that pay the same (`payouts[2]`). */
  readonly secondStop: readonly [MissionOffer, MissionOffer];
  /** The final run: dangerous, big reward on the card, never paid. */
  readonly finalRun: MissionOffer;
}

export function prologueOffers(payouts: readonly number[]): PrologueOffers {
  const [raceBase = 0, firstBase = 0, secondBase = 0] = payouts;
  const near = ['prologue-r1'];
  const far = ['prologue-r3'];

  const race: MissionOffer = {
    ...offerBase('prologue-race', 'RACE', NEAR, near, raceBase),
    info: offerInfo(
      { en: 'Dockside sprint', 'pt-BR': 'Corrida até Dockside' },
      {
        en: 'A friendly dash to Dockside against a free pilot.',
        'pt-BR': 'Uma corrida amistosa até Dockside contra um piloto livre.',
      },
      near,
      DEMO_TRIP_SECONDS,
      DEMO_TRIP_FUEL,
      {
        race: {
          rivals: [
            {
              name: 'Free pilot',
              mobility: 30,
              level: 1,
              durationSeconds: 40,
              bestSeconds: 36,
              worstSeconds: 44,
            },
          ],
          you: { durationSeconds: 45, bestSeconds: 41, worstSeconds: 49 },
          minMobility: 10,
          prizeShares: [1],
        },
      },
    ),
  };

  const passengers = (id: string, reward: number): MissionOffer => ({
    ...offerBase(id, 'TRANSPORT', NEAR, near, reward),
    info: offerInfo(
      { en: 'Passengers to Dockside', 'pt-BR': 'Passageiros para Dockside' },
      {
        en: 'Passengers who want a quick hop to Dockside.',
        'pt-BR': 'Passageiros que querem uma viagem curta até Dockside.',
      },
      near,
      DEMO_TRIP_SECONDS,
      DEMO_TRIP_FUEL,
    ),
  });
  const crates = (id: string, reward: number): MissionOffer => ({
    ...offerBase(id, 'DELIVERY', NEAR, near, reward),
    info: offerInfo(
      { en: 'Crates for Dockside', 'pt-BR': 'Caixas para Dockside' },
      {
        en: 'A few sealed crates that need to reach Dockside.',
        'pt-BR': 'Algumas caixas lacradas que precisam chegar a Dockside.',
      },
      near,
      DEMO_TRIP_SECONDS,
      DEMO_TRIP_FUEL,
      { cargo: { mode: 'fixed', need: 4, unitPay: 0 } },
    ),
  });

  const finalRun: MissionOffer = {
    ...offerBase(
      'prologue-final',
      'TRANSPORT',
      FAR,
      far,
      (firstBase + secondBase) * FINAL_REWARD_FACTOR,
    ),
    info: offerInfo(
      { en: 'Passengers to Cinder Reach', 'pt-BR': 'Passageiros para Cinder Reach' },
      {
        en: 'Forty people need to get to Cinder Reach. Nobody else will fly the route.',
        'pt-BR': 'Quarenta pessoas precisam chegar a Cinder Reach. Ninguém mais voa essa rota.',
      },
      far,
      FAR_TRIP_SECONDS,
      FAR_TRIP_FUEL,
    ),
  };

  return {
    race,
    firstStop: [passengers('prologue-first-a', firstBase), crates('prologue-first-b', firstBase)],
    secondStop: [
      passengers('prologue-second-a', secondBase),
      crates('prologue-second-b', secondBase),
    ],
    finalRun,
  };
}
