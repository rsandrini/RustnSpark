import type {
  LocalizedText,
  MarketListing,
  MissionOffer,
  WorldLocation,
  WorldResponse,
} from '../../../api/generated';
import { PROLOGUE_CARGO, type ProloguePart } from '../prologue-fixtures';

/*
 * The opening's map, its trips and the jobs on the board. Six places on a small map: home, two stops on the way to the
 * race's finish, an alternative port, and the far, dangerous one. The race crosses three legs; a job crosses one; the
 * final run crosses the dangerous one. Every duration is a fixed, short number of seconds (the real trips are longer).
 */

export const PLACE = {
  haven: 'sandbox-haven',
  tern: 'sandbox-tern',
  reef: 'sandbox-reef',
  dockside: 'sandbox-dockside',
  quarry: 'sandbox-quarry',
  cinder: 'sandbox-cinder',
} as const;

const NEUTRAL = 'free';

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
    // every stop has a market and a refuel, like a real port
    services: { market: true, refuel: true },
    risk,
    missionCount: 0,
  };
}

export type RouteId =
  'sandbox-r1' | 'sandbox-r2' | 'sandbox-r3' | 'sandbox-r4' | 'sandbox-r5' | 'sandbox-r6';

/** Where each place sits on the opening's map. */
const AT = {
  [PLACE.haven]: [0, 0],
  [PLACE.tern]: [70, -40],
  [PLACE.reef]: [150, -15],
  [PLACE.dockside]: [230, -45],
  [PLACE.quarry]: [290, 15],
  [PLACE.cinder]: [390, 70],
} as const;

/**
 * A flight takes as long as the line it draws on the map, so the ship on the map is always where the clock says (a leg
 * that took longer than its drawing would leave the ship behind on the map while the list had moved on).
 */
const SECONDS_PER_MAP_UNIT = 0.22;
function secondsOf(a: keyof typeof AT, b: keyof typeof AT): number {
  const length = Math.hypot(AT[a][0] - AT[b][0], AT[a][1] - AT[b][1]);
  return Math.round(length * SECONDS_PER_MAP_UNIT * 10) / 10;
}

const ROUTE_RAW: ReadonlyArray<{
  id: RouteId;
  a: string;
  b: string;
  distance: number;
  danger: number;
}> = [
  { id: 'sandbox-r1', a: PLACE.haven, b: PLACE.tern, distance: 60, danger: 0 },
  { id: 'sandbox-r2', a: PLACE.tern, b: PLACE.reef, distance: 65, danger: 0 },
  { id: 'sandbox-r3', a: PLACE.reef, b: PLACE.dockside, distance: 70, danger: 0 },
  { id: 'sandbox-r4', a: PLACE.dockside, b: PLACE.quarry, distance: 80, danger: 0 },
  { id: 'sandbox-r5', a: PLACE.quarry, b: PLACE.cinder, distance: 110, danger: 6 },
  { id: 'sandbox-r6', a: PLACE.quarry, b: PLACE.reef, distance: 75, danger: 0 },
];

const ROUTE_DEFS = ROUTE_RAW.map((route) => ({
  ...route,
  seconds: secondsOf(route.a as keyof typeof AT, route.b as keyof typeof AT),
}));

export const SANDBOX_WORLD: WorldResponse = {
  locations: [
    place(PLACE.haven, { en: 'Haven Station', 'pt-BR': 'Estação Haven' }, 0, 0, 0, 'lo'),
    place(PLACE.tern, { en: 'Tern Gate', 'pt-BR': 'Portal Tern' }, 70, -40, 0, 'lo'),
    place(PLACE.reef, { en: 'Reef Light', 'pt-BR': 'Farol do Recife' }, 150, -15, 0, 'lo'),
    place(PLACE.dockside, { en: 'Dockside Port', 'pt-BR': 'Porto Dockside' }, 230, -45, 0, 'lo'),
    place(PLACE.quarry, { en: 'Quarry Rest', 'pt-BR': 'Pouso da Pedreira' }, 290, 15, 0, 'lo'),
    place(PLACE.cinder, { en: 'Cinder Reach', 'pt-BR': 'Cinder Reach' }, 390, 70, 1, 'hi'),
  ],
  routes: ROUTE_DEFS.map((route) => ({
    id: route.id,
    nodeAId: route.a,
    nodeBId: route.b,
    distance: route.distance,
    danger: route.danger,
    hot: route.danger > 0,
  })),
};

export function routeOf(id: string) {
  return ROUTE_DEFS.find((route) => route.id === id);
}

/** How long each leg of a trip takes, in seconds. */
export function legSecondsOf(routeIds: readonly string[]): number[] {
  return routeIds.map((id) => routeOf(id)?.seconds ?? 0);
}

/** The pilot's own three legs of the race (the flight's real times) and the friend's: ahead early, behind at the end. */
export const RACE_PILOT_LEGS: readonly number[] = ROUTE_DEFS.slice(0, 3).map(
  (route) => route.seconds,
);
export const RACE_FRIEND_LEGS = [19.5, 16, 17.5] as const;

/** The race's three legs, Haven to Dockside. */
export const RACE_ROUTES = ['sandbox-r1', 'sandbox-r2', 'sandbox-r3'] as const;

/** Fuel a trip needs: a little of the engine's burn for every unit of distance. */
const FUEL_PER_DISTANCE_AND_BURN = 0.01;
export function fuelNeededFor(routeIds: readonly string[], fuelUse: number): number {
  const distance = routeIds.reduce((sum, id) => sum + (routeOf(id)?.distance ?? 0), 0);
  return Math.round(distance * fuelUse * FUEL_PER_DISTANCE_AND_BURN);
}

// ---------------------------------------------------------------------------------------------
// The module the job needs, sold at every port

/** The passenger module of the opening: a cabin with its life support built in, one square. */
export const SANDBOX_PASSENGER_MODULE: ProloguePart = {
  id: 'sandbox-passenger-module',
  name: { en: 'Passenger Module', 'pt-BR': 'Módulo de Passageiros' },
  catalog: {
    partType: 'passenger_module',
    partClass: 'CARGO',
    w: 1,
    h: 1,
    mass: 4,
    structureCost: 6,
    partHp: 25,
    basePrice: 800,
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
    pressurized: true,
    lifeSupport: true,
  },
  connectors: PROLOGUE_CARGO.connectors,
  rarity: 'COMMON',
  target: { partInstanceId: 'sandbox-passenger-module', gx: 1, gy: 0, rot: 0 },
};

export const SANDBOX_DESCRIPTIONS: Record<string, LocalizedText> = {
  passenger_module: {
    en: 'A pressurized cabin with its air and heat built in: room for people instead of freight. Passenger jobs need one.',
    'pt-BR':
      'Uma cabine pressurizada com ar e aquecimento embutidos: espaço para pessoas em vez de carga. Os trabalhos de passageiros precisam de uma.',
  },
};

/** Both modules cost the same (one price, in the opening's config), so the choice of job never changes the money. */
export function marketListingsOf(price: number, chosen: ModuleKind | null = null): MarketListing[] {
  const sold = [SANDBOX_PASSENGER_MODULE, PROLOGUE_CARGO].filter(
    (part) => chosen === null || (chosen === 'passengers') === (part === SANDBOX_PASSENGER_MODULE),
  );
  return sold.map((part) => ({
    listingId: `catalog:sandbox:${part.catalog.partType}`,
    kind: 'catalog',
    partType: part.catalog.partType,
    partClass: part.catalog.partClass,
    displayName: part.name,
    description: SANDBOX_DESCRIPTIONS[part.catalog.partType] ?? part.name,
    rarity: part.rarity,
    catalog: part.catalog,
    condition: 100,
    price,
    connectors: [...part.connectors],
  }));
}

// ---------------------------------------------------------------------------------------------
// The jobs

export type JobKind = 'race' | 'passengers' | 'crates' | 'final';

export interface JobSpec {
  readonly id: string;
  readonly kind: JobKind;
  /** Which board it shows on: 0 the race, 1 the first stop, 2 the second, 3 the final run. */
  readonly slot: 0 | 1 | 2 | 3;
  readonly origin: string;
  readonly destination: string;
  readonly routes: readonly RouteId[];
  readonly title: LocalizedText;
  readonly brief: LocalizedText;
  readonly cargoNeed: number;
}

const NAME = (id: string) =>
  SANDBOX_WORLD.locations.find((location) => location.id === id)?.displayName ?? {
    en: id,
    'pt-BR': id,
  };

function jobTitle(kind: JobKind, destination: string): LocalizedText {
  const to = NAME(destination);
  if (kind === 'race') return { en: 'Race to Dockside', 'pt-BR': 'Corrida até Dockside' };
  if (kind === 'crates') return { en: `Crates to ${to.en}`, 'pt-BR': `Caixas para ${to['pt-BR']}` };
  return { en: `Passengers to ${to.en}`, 'pt-BR': `Passageiros para ${to['pt-BR']}` };
}

const BRIEFS: Record<JobKind, LocalizedText> = {
  race: {
    en: 'A friendly race to Dockside, three legs, you against your friend.',
    'pt-BR': 'Uma corrida amistosa até Dockside, três trechos, você contra o seu amigo.',
  },
  passengers: {
    en: 'A handful of travellers who want a quick, safe hop.',
    'pt-BR': 'Alguns viajantes que querem uma viagem curta e segura.',
  },
  crates: {
    en: 'Sealed crates that have to reach their port.',
    'pt-BR': 'Caixas lacradas que precisam chegar ao porto.',
  },
  final: {
    en: 'Forty people need to get to Cinder Reach, and nobody else will fly the route.',
    'pt-BR': 'Quarenta pessoas precisam chegar a Cinder Reach, e ninguém mais voa essa rota.',
  },
};

function job(
  id: string,
  kind: JobKind,
  slot: JobSpec['slot'],
  origin: string,
  destination: string,
  routes: readonly RouteId[],
  cargoNeed = 0,
): JobSpec {
  return {
    id,
    kind,
    slot,
    origin,
    destination,
    routes,
    title: jobTitle(kind, destination),
    brief: BRIEFS[kind],
    cargoNeed,
  };
}

/** The routes leaving a place, with where each one leads. */
function neighbours(from: string): Array<{ routeId: RouteId; to: string }> {
  return ROUTE_DEFS.flatMap<{ routeId: RouteId; to: string }>((route) =>
    route.a === from
      ? [{ routeId: route.id, to: route.b }]
      : route.b === from
        ? [{ routeId: route.id, to: route.a }]
        : [],
  );
}

/** The fewest routes from one place to another (a breadth-first search over the small map). */
export function pathTo(from: string, to: string): RouteId[] | null {
  const seen = new Set<string>([from]);
  const queue: Array<{ at: string; path: RouteId[] }> = [{ at: from, path: [] }];
  while (queue.length > 0) {
    const current = queue.shift() as { at: string; path: RouteId[] };
    if (current.at === to) return current.path;
    for (const next of neighbours(current.at)) {
      if (seen.has(next.to)) continue;
      seen.add(next.to);
      queue.push({ at: next.to, path: [...current.path, next.routeId] });
    }
  }
  return null;
}

/** The module the pilot has fitted decides which kind of job the second stop offers. */
export type ModuleKind = 'passengers' | 'crates';

const SAFE_ONE_LEG = (from: string) =>
  neighbours(from).filter((next) => (routeOf(next.routeId)?.danger ?? 0) === 0);

/**
 * The jobs on the board at a place, for the stop the pilot is at: the race at the start; at the first stop one job of each
 * kind (the pilot picks a kind, then buys its module); at the second stop two jobs of the kind of the module already
 * fitted, to different places; at the end the dangerous run, by the shortest way from where the pilot is.
 */
export function jobsAt(
  slot: JobSpec['slot'],
  location: string,
  module: ModuleKind | null,
): JobSpec[] {
  if (slot === 0) return [job('sandbox-race', 'race', 0, PLACE.haven, PLACE.dockside, RACE_ROUTES)];
  if (slot === 1) {
    const [first, second] = SAFE_ONE_LEG(location);
    if (first === undefined || second === undefined) return [];
    return [
      job('sandbox-first-passengers', 'passengers', 1, location, first.to, [first.routeId]),
      job('sandbox-first-crates', 'crates', 1, location, second.to, [second.routeId], CARGO_NEED),
    ];
  }
  if (slot === 2) {
    const kind: ModuleKind = module ?? 'passengers';
    const [first, second] = SAFE_ONE_LEG(location);
    if (first === undefined || second === undefined) return [];
    return [first, second].map((next, index) =>
      job(
        `sandbox-second-${kind}-${index}`,
        kind,
        2,
        location,
        next.to,
        [next.routeId],
        kind === 'crates' ? CARGO_NEED : 0,
      ),
    );
  }
  const way = pathTo(location, PLACE.cinder);
  return way === null ? [] : [job('sandbox-final', 'final', 3, location, PLACE.cinder, way)];
}

/** Units of cargo a crates job needs (the cargo hold has room for five). */
const CARGO_NEED = 4;

export type { MissionOffer };
