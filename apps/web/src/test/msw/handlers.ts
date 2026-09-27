import { http, HttpResponse } from 'msw';
import type {
  ActiveMission,
  BuyResponse,
  DispatchResponse,
  InventoryItem,
  LocalizedText,
  LoginResponse,
  SystemNoticesResponse,
  MarketListing,
  MarketResponse,
  MaterialHolding,
  MaterialsResponse,
  MissionOffer,
  Placement,
  PlayerProfileResponse,
  PreviewResponse,
  RefreshResponse,
  DiscardResponse,
  RefuelQuoteResponse,
  RefuelResponse,
  RegisterResponse,
  RepairQuoteResponse,
  RepairStartResponse,
  RescueResponse,
  ReportListResponse,
  ReportResponse,
  ScavengeInfo,
  TravelQuote,
  SellMaterialResponse,
  SellResponse,
  CatalogDetail,
  ShipResponse,
  ShipStatus,
  UpdateLocaleResponse,
  WorldResponse,
} from '../../api/generated';

let wallet = 4820;
let fuelState = 25;
let shipStatus: ShipStatus = 'IN_PORT';

const accessToken = 'test-access-token';

const profile = (factionId: string | null = null) => ({
  id: 'player-1',
  name: 'Test Pilot',
  credits: wallet,
  role: 'PLAYER' as const,
  locale: 'en',
  factionId,
});

const sheet = () => ({
  pot: 25,
  pdf: 0,
  bli: 12,
  esc: 0,
  sen: 2,
  crg: 10,
  min: 0,
  hp: 40,
  mass: 24,
  energyCont: 8,
  energyCombat: 0,
  batCharge: 4,
  batOutput: 10,
  batInput: 8,
  fuelCap: 40,
  fuelUse: 1,
  structureUsed: 18,
  structureBudget: 40,
  autonomy: 40,
  mob: 2,
  condition: 1,
});

// Bilingual part names, as the real inventory/market endpoints send them (the raw part code is
// never player-facing).
const PART_NAMES: Record<string, LocalizedText> = {
  bridge: { en: 'Bridge', 'pt-BR': 'Ponte' },
  engine_chem_small: { en: 'Small Chemical Engine', 'pt-BR': 'Motor Químico Pequeno' },
  tank_small: { en: 'Small Tank', 'pt-BR': 'Tanque Pequeno' },
  battery_small: { en: 'Small Battery', 'pt-BR': 'Bateria Pequena' },
  cargo: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
  hull: { en: 'Plated Hull', 'pt-BR': 'Casco Blindado' },
};
const partDescriptionOf = (partType: string): LocalizedText => ({
  en: `${partNameOf(partType).en}: what it does, why you need it, its trade-off.`,
  'pt-BR': `${partNameOf(partType)['pt-BR']}: o que faz, por que precisa, o custo.`,
});
const partNameOf = (partType: string): LocalizedText =>
  PART_NAMES[partType] ?? { en: partType, 'pt-BR': partType };

const catalog = (
  partType: string,
  partClass: InventoryItem['catalog']['partClass'],
  over: Partial<InventoryItem['catalog']> = {},
): InventoryItem['catalog'] => ({
  partType,
  partClass,
  w: 1,
  h: 1,
  mass: 1,
  structureCost: 4,
  partHp: 4,
  basePrice: 10,
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
  ...over,
});

const starterInventory = (): InventoryItem[] => [
  {
    id: 'part-bridge',
    partType: 'bridge',
    displayName: partNameOf('bridge'),
    description: partDescriptionOf('bridge'),
    rarity: 'COMMON',
    condition: 1,
    broken: false,
    location: 'INSTALLED',
    shipId: 'ship-1',
    catalog: catalog('bridge', 'BRIDGE', { w: 2, h: 2, mass: 6, structureCost: 0 }),
  },
  {
    id: 'part-engine',
    partType: 'engine_chem_small',
    displayName: partNameOf('engine_chem_small'),
    description: partDescriptionOf('engine_chem_small'),
    rarity: 'COMMON',
    condition: 1,
    broken: false,
    location: 'INSTALLED',
    shipId: 'ship-1',
    catalog: catalog('engine_chem_small', 'ENGINE', {
      pot: 25,
      fuelUse: 1,
      fuelCap: 0,
      mass: 3,
    }),
  },
  {
    id: 'part-tank',
    partType: 'tank_small',
    displayName: partNameOf('tank_small'),
    description: partDescriptionOf('tank_small'),
    rarity: 'COMMON',
    condition: 1,
    broken: false,
    location: 'INSTALLED',
    shipId: 'ship-1',
    catalog: catalog('tank_small', 'TANK', { fuelCap: 40, mass: 5 }),
  },
  {
    id: 'part-battery',
    partType: 'battery_small',
    displayName: partNameOf('battery_small'),
    description: partDescriptionOf('battery_small'),
    rarity: 'COMMON',
    condition: 1,
    broken: false,
    location: 'INSTALLED',
    shipId: 'ship-1',
    catalog: catalog('battery_small', 'BATTERY', {
      batOutput: 10,
      batCharge: 4,
      energyCont: 8,
      mass: 2,
    }),
  },
  {
    id: 'part-hull',
    partType: 'hull',
    displayName: partNameOf('hull'),
    description: partDescriptionOf('hull'),
    rarity: 'COMMON',
    condition: 1,
    broken: false,
    location: 'INSTALLED',
    shipId: 'ship-1',
    catalog: catalog('hull', 'DEFENSE', { partHp: 40, mass: 4, w: 2, h: 2 }),
  },
  {
    id: 'part-cargo-a',
    partType: 'cargo',
    displayName: partNameOf('cargo'),
    description: partDescriptionOf('cargo'),
    rarity: 'COMMON',
    condition: 1,
    broken: false,
    location: 'INSTALLED',
    shipId: 'ship-1',
    catalog: catalog('cargo', 'CARGO', { crg: 5, mass: 2, w: 2, h: 1 }),
  },
  {
    id: 'part-cargo-b',
    partType: 'cargo',
    displayName: partNameOf('cargo'),
    description: partDescriptionOf('cargo'),
    rarity: 'COMMON',
    condition: 80,
    broken: false,
    location: 'INVENTORY',
    shipId: null,
    catalog: catalog('cargo', 'CARGO', { crg: 5, mass: 2, w: 2, h: 1 }),
  },
];

const starterLayout = (): Placement[] => [
  { partInstanceId: 'part-bridge', gx: 0, gy: 0, rot: 0 },
  { partInstanceId: 'part-engine', gx: 2, gy: 0, rot: 0 },
  { partInstanceId: 'part-tank', gx: 3, gy: 0, rot: 0 },
  { partInstanceId: 'part-battery', gx: 2, gy: 1, rot: 0 },
  { partInstanceId: 'part-hull', gx: 0, gy: 2, rot: 0 },
  { partInstanceId: 'part-cargo-a', gx: 2, gy: 2, rot: 0 },
];

const ship = (): ShipResponse => ({
  id: 'ship-1',
  ownerPlayerId: 'player-1',
  name: 'luna starter',
  fuel: fuelState,
  status: shipStatus,
  currentLocationId: 'ceres',
  stance: 'NEUTRAL',
  layout: starterLayout(),
  sheet: sheet(),
  shipClass: 'MULTIROLE',
  yard: { halfSize: 10 },
  activity: { kind: 'idle', until: null, missionId: null },
});

let inventoryState: InventoryItem[] = starterInventory();

const marketListings: MarketListing[] = [
  {
    listingId: 'catalog:ceres:hull',
    kind: 'catalog',
    partType: 'hull',
    partClass: 'DEFENSE',
    displayName: { en: 'Plated Hull', 'pt-BR': 'Casco Blindado' },
    description: partDescriptionOf('hull'),
    rarity: 'COMMON',
    catalog: catalog('hull', 'DEFENSE'),
    condition: 100,
    price: 300,
  },
  {
    listingId: 'catalog:ceres:cargo',
    kind: 'catalog',
    partType: 'cargo',
    partClass: 'CARGO',
    displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
    description: partDescriptionOf('cargo'),
    rarity: 'COMMON',
    catalog: catalog('cargo', 'CARGO'),
    condition: 100,
    price: 120,
  },
  {
    listingId: 'used:ceres:2026-09-25:0:cargo',
    kind: 'used',
    partType: 'cargo',
    partClass: 'CARGO',
    displayName: { en: 'Cargo Rack (used)', 'pt-BR': 'Suporte de Carga (usado)' },
    description: partDescriptionOf('cargo'),
    rarity: 'COMMON',
    catalog: catalog('cargo', 'CARGO'),
    condition: 60,
    price: 80,
  },
];

let materialsState: MaterialHolding[] = [
  {
    materialId: 'iron',
    displayName: { en: 'Iron', 'pt-BR': 'Ferro' },
    rarity: 'common',
    quantity: 6,
    unitPrice: 4,
  },
];

let scavCooldownUntil = 0;
let buyCounter = 0;

/** Live wallet/fuel for specs that must observe trade effects. */
export const economyState = {
  get wallet() {
    return wallet;
  },
  get fuel() {
    return fuelState;
  },
  get shipStatus() {
    return shipStatus;
  },
};

/** Sets the fixture wallet (a pilot who cannot afford a full tank). */
export function setWallet(value: number): void {
  wallet = value;
}

/** Destroys the installed engine (condition 0): the workshop cannot repair it. */
export function destroyEngine(): void {
  const engine = inventoryState.find((entry) => entry.id === 'part-engine');
  if (engine !== undefined) {
    engine.condition = 0;
    engine.broken = true;
  }
}

/** Adds a loose part too damaged to sell (below the 15 % threshold) to the fixture inventory. */
export function addWreck(): void {
  inventoryState.push({
    id: 'part-wreck',
    partType: 'cargo',
    displayName: partNameOf('cargo'),
    description: partDescriptionOf('cargo'),
    rarity: 'COMMON',
    condition: 6,
    broken: false,
    location: 'INVENTORY',
    shipId: null,
    catalog: catalog('cargo', 'CARGO', { crg: 5, mass: 2, w: 2, h: 1 }),
  });
}

/** Puts the fixture ship into a status (e.g. ADRIFT) for rescue scenarios. */
export function setShipStatus(status: ShipStatus): void {
  shipStatus = status;
}

/**
 * The real API rejects these POSTs without an Idempotency-Key (400
 * IDEMPOTENCY_KEY_REQUIRED, R21). Enforcing it here means a client that forgets the
 * header fails its spec instead of passing against a lenient mock.
 */
function missingKey(request: Request): Response | null {
  const key = request.headers.get('idempotency-key');
  if (key !== null && key.trim() !== '') return null;
  return HttpResponse.json(
    { statusCode: 400, message: 'IDEMPOTENCY_KEY_REQUIRED', error: 'Bad Request' },
    { status: 400 },
  );
}

/** What the port pays for an inventory part — one quote for the board and for sell. */
const sellQuote = (part: InventoryItem): number =>
  Math.max(1, Math.round((part.catalog.basePrice * part.condition) / 100));

export function resetEconomyState(): void {
  wallet = 4820;
  fuelState = 25;
  shipStatus = 'IN_PORT';
  inventoryState = starterInventory();
  materialsState = [
    {
      materialId: 'iron',
      displayName: { en: 'Iron', 'pt-BR': 'Ferro' },
      rarity: 'common',
      quantity: 6,
      unitPrice: 4,
    },
  ];
  scavCooldownUntil = 0;
  buyCounter = 0;
}

interface RepairTargetBody {
  partInstanceId: string;
  toCondition: number;
}

const repairTargets = (raw: RepairTargetBody[]) =>
  raw.flatMap((target) => {
    const part = inventoryState.find(
      (entry) => entry.id === target.partInstanceId && entry.location === 'INSTALLED',
    );
    if (part === undefined || target.toCondition <= part.condition) return [];
    return [
      { partInstanceId: part.id, fromCondition: part.condition, toCondition: target.toCondition },
    ];
  });

const repairCostOf = (targets: { fromCondition: number; toCondition: number }[]) =>
  targets.reduce((sum, target) => sum + (target.toCondition - target.fromCondition) * 2, 0);

/**
 * A 200 response whose body is checked against the shared contract (`packages/contract`): a
 * mock that drifts from the real response shape fails to compile instead of passing against
 * a made-up payload. Error bodies stay untyped `HttpResponse.json` on purpose.
 */
function ok<T>(body: T): Response {
  return HttpResponse.json(body as never, { status: 200 });
}

export const handlers = [
  http.post('/v1/auth/login', () => ok<LoginResponse>({ accessToken })),

  http.post('/v1/auth/register', () =>
    ok<RegisterResponse>({
      accessToken,
      player: profile(),
    }),
  ),

  http.post('/v1/auth/refresh', () => ok<RefreshResponse>({ accessToken })),

  http.post('/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),

  http.get('/v1/system/notices', () => ok<SystemNoticesResponse>({ items: [] })),

  http.get('/v1/players/me', () => ok<PlayerProfileResponse>(profile())),

  http.post('/v1/players/me/locale', async ({ request }) => {
    const body = (await request.json()) as { locale: string };
    return ok<UpdateLocaleResponse>({ locale: body.locale });
  }),

  http.post('/v1/players/me/onboarding', () =>
    ok<ShipResponse>({
      id: 'ship-1',
      ownerPlayerId: 'player-1',
      name: 'luna starter',
      fuel: fuelState,
      status: 'IN_PORT',
      currentLocationId: 'ceres',
      stance: 'NEUTRAL',
      layout: [],
      sheet: sheet(),
      shipClass: 'MULTIROLE',
      yard: { halfSize: 10 },
      activity: { kind: 'idle', until: null, missionId: null },
    }),
  ),

  http.get('/v1/ships', () => ok<ShipResponse[]>([ship()])),

  http.get('/v1/ships/:id', () => ok<ShipResponse>(ship())),

  http.get('/v1/inventory', () => ok<InventoryItem[]>(inventoryState)),

  http.post('/v1/ships/:id/preview', async ({ request }) => {
    const body = (await request.json()) as { layout?: Placement[] };
    return ok<PreviewResponse>({
      sheet: sheet(),
      shipClass: 'MULTIROLE',
      viability: { viable: true, problems: [] },
      layout: body.layout ?? [],
      omittedPartInstanceIds: [],
    });
  }),

  http.post('/v1/ships/:id/assemble', () => ok<ShipResponse>(ship())),

  http.post('/v1/ships/:id/auto-assemble', () => ok<ShipResponse>(ship())),

  http.get('/v1/locations', () => ok<WorldResponse>(world())),

  http.get('/v1/locations/:id/missions', () => ok<MissionOffer[]>(boardState)),
  http.post('/v1/missions/:id/accept', ({ params }) => {
    const mission = boardState.find((offer) => offer.id === params.id);
    if (mission !== undefined) {
      mission.status = 'ACCEPTED';
      mission.playerId = 'player-1';
      mission.shipId = 'ship-1';
      mission.acceptedAt = new Date().toISOString();
    }
    return HttpResponse.json(mission ?? {}, { status: 200 });
  }),
  http.post('/v1/missions/:id/hold', ({ params }) => {
    const mission = boardState.find((offer) => offer.id === params.id);
    if (mission !== undefined) {
      mission.status = 'HELD';
      mission.playerId = 'player-1';
    }
    return HttpResponse.json(mission ?? {}, { status: 200 });
  }),
  http.post('/v1/missions/:id/abandon', () => {
    activeState = null;
    return HttpResponse.json({ status: 'AVAILABLE' }, { status: 200 });
  }),
  http.delete('/v1/missions/:id/hold', ({ params }) => {
    const mission = boardState.find((offer) => offer.id === params.id);
    if (mission !== undefined) {
      mission.status = 'AVAILABLE';
      mission.playerId = null;
    }
    return HttpResponse.json(mission ?? {}, { status: 200 });
  }),

  http.get('/v1/missions/active', () => {
    if (activeState === null) return ok<ActiveMission[]>([]);
    if (activeState.arrivalAt !== null && Date.parse(activeState.arrivalAt) <= Date.now()) {
      return ok<ActiveMission[]>([]);
    }
    return ok<ActiveMission[]>([activeState]);
  }),
  http.post('/v1/ships/:id/dispatch', ({ params }) => {
    if (activeState === null) return HttpResponse.json({}, { status: 404 });
    const arrivalAt = new Date(Date.now() + 3600 * 1000).toISOString();
    activeState.status = 'IN_TRANSIT';
    activeState.shipId = String(params.id);
    activeState.arrivalAt = arrivalAt;
    activeState.legWindows = [
      {
        legIndex: 0,
        routeId: 'ceres-gate',
        from: new Date(Date.now() - 60 * 1000).toISOString(),
        to: new Date(Date.now() + 1800 * 1000).toISOString(),
      },
      {
        legIndex: 1,
        routeId: 'gate-hedus',
        from: new Date(Date.now() + 1800 * 1000).toISOString(),
        to: arrivalAt,
      },
    ];
    return ok<DispatchResponse>({
      missionId: activeState.id,
      arrivalAt,
      serverTime: new Date().toISOString(),
      durationSeconds: 3600,
    });
  }),

  http.get('/v1/reports', () =>
    ok<ReportListResponse>({
      items: [
        {
          missionId: 'm-1',
          outcome: 'success',
          credits: 1400,
          legs: 2,
          createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      ],
    }),
  ),
  http.get('/v1/reports/:missionId', ({ request }) => {
    const view = new URL(request.url).searchParams.get('view') ?? 'summary';
    return ok<ReportResponse>(reportFixture(view));
  }),

  http.get('/v1/locations/:id/market', ({ params }) =>
    ok<MarketResponse>({
      locationId: String(params.id),
      listings: marketListings,
      sellMinCondition: 15,
      sellOffers: inventoryState
        .filter((entry) => entry.location === 'INVENTORY' && entry.condition >= 15)
        .map((entry) => ({ partInstanceId: entry.id, price: sellQuote(entry) })),
    }),
  ),
  http.get('/v1/catalog/parts/:partType', ({ params }) => {
    const partType = String(params.partType);
    const name = PART_NAMES[partType];
    if (name === undefined) {
      return HttpResponse.json({ statusCode: 404, message: 'part not found' }, { status: 404 });
    }
    return ok<CatalogDetail>({
      id: partType,
      kind: 'part',
      displayName: name,
      description: {
        en: `${name.en} — a fitted part.`,
        'pt-BR': `${name['pt-BR']} — uma peça instalada.`,
      },
      category: 'ENGINE',
      rarity: 'COMMON',
    });
  }),
  http.get('/v1/catalog/materials/:id', ({ params }) => {
    const holding = materialsState.find((entry) => entry.materialId === String(params.id));
    if (holding === undefined) {
      return HttpResponse.json({ statusCode: 404, message: 'material not found' }, { status: 404 });
    }
    return ok<CatalogDetail>({
      id: holding.materialId,
      kind: 'material',
      displayName: holding.displayName,
      description: { en: 'Raw ore.', 'pt-BR': 'Minério bruto.' },
      category: 'COMMON',
      rarity: 'COMMON',
    });
  }),

  http.get('/v1/materials', () =>
    ok<MaterialsResponse>({ locationId: 'ceres', materials: materialsState }),
  ),
  http.post('/v1/market/buy', async ({ request }) => {
    const rejected = missingKey(request);
    if (rejected !== null) return rejected;
    const body = (await request.json()) as { listingId: string; expectedPrice: number };
    const listing = marketListings.find((entry) => entry.listingId === body.listingId);
    if (listing === undefined) {
      return HttpResponse.json({ statusCode: 404, message: 'listing not found' }, { status: 404 });
    }
    if (listing.price !== body.expectedPrice) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'PRICE_CHANGED', actual: listing.price } },
        { status: 409 },
      );
    }
    if (wallet < listing.price) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'INSUFFICIENT_FUNDS' } },
        { status: 409 },
      );
    }
    wallet -= listing.price;
    buyCounter += 1;
    const id = `part-bought-${buyCounter}`;
    inventoryState.push({
      id,
      partType: listing.partType,
      displayName: partNameOf(listing.partType),
      description: listing.description,
      rarity: listing.rarity,
      condition: listing.condition,
      broken: false,
      location: 'INVENTORY',
      shipId: null,
      catalog: catalog(
        listing.partType,
        listing.partClass as InventoryItem['catalog']['partClass'],
      ),
    });
    return ok<BuyResponse>({
      partInstanceId: id,
      partType: listing.partType,
      condition: listing.condition,
      price: listing.price,
      credits: wallet,
    });
  }),
  http.post('/v1/market/sell', async ({ request }) => {
    const rejected = missingKey(request);
    if (rejected !== null) return rejected;
    const body = (await request.json()) as { partInstanceId: string; expectedPrice: number };
    const part = inventoryState.find(
      (entry) => entry.id === body.partInstanceId && entry.location === 'INVENTORY',
    );
    if (part === undefined) {
      return HttpResponse.json({ statusCode: 404, message: 'part not found' }, { status: 404 });
    }
    const price = sellQuote(part);
    if (price !== body.expectedPrice) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'PRICE_CHANGED', actual: price } },
        { status: 409 },
      );
    }
    inventoryState = inventoryState.filter((entry) => entry.id !== part.id);
    wallet += price;
    return ok<SellResponse>({ partInstanceId: part.id, price, credits: wallet });
  }),
  http.post('/v1/market/sell-material', async ({ request }) => {
    const rejected = missingKey(request);
    if (rejected !== null) return rejected;
    const body = (await request.json()) as {
      materialId: string;
      quantity: number;
      expectedPrice: number;
    };
    const holding = materialsState.find((entry) => entry.materialId === body.materialId);
    if (holding === undefined || holding.quantity < body.quantity) {
      return HttpResponse.json({ statusCode: 404, message: 'material not found' }, { status: 404 });
    }
    const price = holding.unitPrice * body.quantity;
    if (price !== body.expectedPrice) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'PRICE_CHANGED', actual: price } },
        { status: 409 },
      );
    }
    holding.quantity -= body.quantity;
    materialsState = materialsState.filter((entry) => entry.quantity > 0);
    wallet += price;
    return ok<SellMaterialResponse>({
      materialId: holding.materialId,
      quantity: body.quantity,
      price,
      credits: wallet,
    });
  }),
  http.post('/v1/ships/:id/refuel/quote', async ({ params, request }) => {
    const body = (await request.json()) as { mode: string; amount?: number };
    const fuelCap = 40;
    const space = Math.max(0, fuelCap - fuelState);
    const units = body.mode === 'full' ? space : Math.min(body.amount ?? 0, space);
    return ok<RefuelQuoteResponse>({
      shipId: String(params.id),
      units,
      cost: units * 3,
      unitPrice: 3,
      fuel: fuelState,
      fuelCap,
      space,
    });
  }),
  http.post('/v1/inventory/discard', () => {
    const before = inventoryState.length;
    inventoryState = inventoryState.filter(
      (entry) => !(entry.location === 'INVENTORY' && entry.condition < 15),
    );
    return ok<DiscardResponse>({ discarded: before - inventoryState.length });
  }),
  http.post('/v1/ships/:id/refuel', async ({ params, request }) => {
    const rejected = missingKey(request);
    if (rejected !== null) return rejected;
    const body = (await request.json()) as { mode: string; amount?: number };
    const fuelCap = 40;
    // Like the real API: a full tank is a free no-op (units 0), not an error; a partial amount is
    // capped by the free space.
    const space = Math.max(0, fuelCap - fuelState);
    const units = body.mode === 'full' ? space : Math.min(body.amount ?? 0, space);
    const cost = units * 3;
    if (wallet < cost) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'INSUFFICIENT_FUNDS' } },
        { status: 409 },
      );
    }
    wallet -= cost;
    fuelState = Math.min(fuelCap, fuelState + units);
    return ok<RefuelResponse>({
      shipId: String(params.id),
      units,
      cost,
      fuel: fuelState,
      fuelCap,
      credits: wallet,
    });
  }),
  http.post('/v1/ships/:id/repair/quote', async ({ params, request }) => {
    const body = (await request.json()) as { targets: RepairTargetBody[] };
    const targets = repairTargets(body.targets);
    if (targets.length === 0) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'NO_REPAIR_TARGETS' } },
        { status: 409 },
      );
    }
    const cost = repairCostOf(targets);
    const items = targets.map((target) => ({
      partInstanceId: target.partInstanceId,
      cost: repairCostOf([target]),
      durationSeconds: 5,
    }));
    return ok<RepairQuoteResponse>({
      shipId: String(params.id),
      cost,
      durationSeconds: items.length * 5,
      items,
      fee: cost - items.reduce((sum, item) => sum + item.cost, 0),
    });
  }),
  http.post('/v1/ships/:id/repair', async ({ params, request }) => {
    const rejected = missingKey(request);
    if (rejected !== null) return rejected;
    const body = (await request.json()) as { targets: RepairTargetBody[] };
    const targets = repairTargets(body.targets);
    if (targets.length === 0) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'NO_REPAIR_TARGETS' } },
        { status: 409 },
      );
    }
    const cost = repairCostOf(targets);
    if (wallet < cost) {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'INSUFFICIENT_FUNDS' } },
        { status: 409 },
      );
    }
    wallet -= cost;
    for (const target of targets) {
      const part = inventoryState.find((entry) => entry.id === target.partInstanceId);
      if (part !== undefined) part.condition = target.toCondition;
    }
    return ok<RepairStartResponse>({
      repairJobId: 'job-1',
      shipId: String(params.id),
      cost,
      durationSeconds: 30,
      completesAt: new Date(Date.now() + 30_000).toISOString(),
      targets,
    });
  }),
  http.post('/v1/ships/:id/rescue', ({ params, request }) => {
    const rejected = missingKey(request);
    if (rejected !== null) return rejected;
    if (shipStatus !== 'ADRIFT') {
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'SHIP_NOT_ADRIFT' } },
        { status: 409 },
      );
    }
    // GDD §14: a tow may push the balance negative; the emergency ration is a quarter tank.
    wallet -= 800;
    fuelState = Math.max(fuelState, 10);
    shipStatus = 'IN_PORT';
    return ok<RescueResponse>({
      shipId: String(params.id),
      status: 'IN_PORT',
      cost: 800,
      fuel: fuelState,
      credits: wallet,
      restartParts: [],
    });
  }),
  http.get('/v1/travel/quote', ({ request }) => {
    const destinationId = new URL(request.url).searchParams.get('destinationId') ?? '';
    return ok<TravelQuote>({
      originId: 'ceres',
      destinationId,
      legs: [
        {
          routeId: 'ceres-gate',
          fromId: 'ceres',
          toId: destinationId,
          distance: 400,
          danger: 5,
          zone: 1,
        },
      ],
      totalDistance: 400,
      durationSeconds: 150,
      fuelNeeded: 12,
      fuelHave: 25,
      peakDanger: 5,
      blockers: [],
      canDepart: true,
    });
  }),
  http.post('/v1/travel', () =>
    ok<DispatchResponse>({
      missionId: 'travel-1',
      arrivalAt: new Date(Date.now() + 150_000).toISOString(),
      serverTime: new Date().toISOString(),
    }),
  ),
  http.get('/v1/locations/:id/scavenge', ({ params }) => {
    const retry = Math.max(0, Math.ceil((scavCooldownUntil - Date.now()) / 1000));
    return ok<ScavengeInfo>({
      locationId: String(params.id),
      fieldType: 'common',
      dropChance: 0.25,
      zone: 1,
      scrapPlace: false,
      durationSeconds: 300,
      cooldownSeconds: 300,
      retryAfterSeconds: retry,
      attempts: retry > 0 ? 1 : 0,
      qualityMin: 30,
      qualityMax: 70,
    });
  }),
  http.post('/v1/locations/:id/scavenge', () => {
    const now = Date.now();
    if (now < scavCooldownUntil) {
      const seconds = Math.ceil((scavCooldownUntil - now) / 1000);
      return HttpResponse.json(
        { statusCode: 409, message: { error: 'SCAVENGE_COOL_DOWN', retryAfterSeconds: seconds } },
        { status: 409 },
      );
    }
    scavCooldownUntil = now + 60_000;
    return ok<DispatchResponse>({
      missionId: 'scavenge-1',
      arrivalAt: new Date(now + 300_000).toISOString(),
      serverTime: new Date(now).toISOString(),
      durationSeconds: 300,
    });
  }),
];

const reportLine = (text: string) => ({
  text,
  segments: [{ t: 'text' as const, value: text }],
});

const reportExtras = {
  stats: {
    credits: 1400,
    balanceAfter: 1400,
    legs: 2,
    distance: 820,
    fights: { won: 1, lost: 0, escaped: 0, drawn: 0, pvp: 0 },
    damage: { shield: 4, armor: 3, hull: 2 },
    partFailures: 0,
    fuelLost: 0,
    found: [],
    pirates: { stolenParts: 0, motive: null },
    loot: [{ materialId: 'iron', name: 'Iron', quantity: 6 }],
  },
  mission: {
    type: 'DELIVERY' as const,
    originId: 'ceres',
    destinationId: 'hedus',
    reward: 1200,
    title: { en: 'Corporate Delivery', 'pt-BR': 'Entrega Corporativa' },
  },
};

const reportFixture = (view: string): ReportResponse => {
  if (view === 'narrative') {
    return {
      locale: 'en',
      outcome: 'success',
      ...reportExtras,
      view: 'narrative',
      chapters: [
        {
          leg: 1,
          header: reportLine('Leg 1 — completed'),
          lines: [
            reportLine('Departed Porto Ceres on schedule.'),
            {
              ...reportLine('A raider hit the hull in transit.'),
              detail: { cascade: { shield: 4, armor: 3, hp: 2 } },
            },
          ],
        },
      ],
    };
  }
  if (view === 'log') {
    return {
      locale: 'en',
      outcome: 'success',
      ...reportExtras,
      view: 'log',
      lines: [
        reportLine('[00:00] depart ceres'),
        reportLine('[00:42] combat pirate'),
        reportLine('[01:00] arrive hedus'),
      ],
    };
  }
  return {
    locale: 'en',
    outcome: 'success',
    ...reportExtras,
    view: 'summary',
    lines: [reportLine('Mission accomplished — balance 1400 ¢'), reportLine('Payment +1400 ¢')],
  };
};

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const acceptedMission = (): ActiveMission => ({
  id: 'm-1',
  templateId: 'tpl-b-1',
  type: 'DELIVERY',
  factionId: 'luna',
  originId: 'ceres',
  destinationId: 'hedus',
  legs: [],
  cargo: {},
  reward: 1200,
  expiresAt: iso(2 * 60 * 60 * 1000),
  status: 'ACCEPTED',
  playerId: 'player-1',
  privatePlayerId: null,
  shipId: null,
  acceptedAt: iso(-5 * 60 * 1000),
  arrivalAt: null,
  deadlineAt: iso(60 * 60 * 1000),
  seed: 'seed-1',
  version: 1,
  legWindows: [],
});

let activeState: ActiveMission | null = acceptedMission();

/** Restores the active-mission fixture mutated by the dispatch handler (per-test). */
export function resetActiveState(): void {
  activeState = acceptedMission();
}

const boardOffer = (over: Partial<MissionOffer> & { id: string }): MissionOffer => ({
  templateId: `tpl-${over.id}`,
  type: 'DELIVERY',
  factionId: 'luna',
  originId: 'ceres',
  destinationId: 'gate',
  legs: [],
  cargo: {},
  reward: 1200,
  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  status: 'AVAILABLE',
  playerId: null,
  privatePlayerId: null,
  shipId: null,
  acceptedAt: null,
  arrivalAt: null,
  deadlineAt: null,
  seed: 'seed-1',
  version: 1,
  rewardEstimate: 1350,
  eligibility: { eligible: true, reasons: [] },
  info: {
    title: { en: 'Corporate Delivery', 'pt-BR': 'Entrega Corporativa' },
    description: {
      en: 'Deliver sealed cargo to the destination.',
      'pt-BR': 'Entregue a carga lacrada no destino.',
    },
    legCount: 2,
    totalDistance: 820,
    peakDanger: 5,
    peakZone: 1,
    estimate: { durationSeconds: 300, fuelNeeded: 8 },
    material: null,
  },
  ...over,
});

const boardState: MissionOffer[] = [
  boardOffer({ id: 'b-1' }),
  boardOffer({
    id: 'b-2',
    type: 'TRANSPORT',
    destinationId: 'cair',
    reward: 800,
    rewardEstimate: 900,
  }),
  boardOffer({
    id: 'b-3',
    type: 'MINING',
    destinationId: 'spur',
    reward: 2400,
    rewardEstimate: 2600,
    eligibility: {
      eligible: false,
      reasons: [
        { code: 'MINER', message: 'Needs a mining system' },
        { code: 'MOB_TOO_LOW', message: 'Mobility too low' },
      ],
    },
  }),
  boardOffer({
    id: 'b-4',
    type: 'RESCUE',
    destinationId: 'hedus',
    reward: 1600,
    rewardEstimate: 1750,
    status: 'HELD',
    playerId: 'player-1',
  }),
];

/** Restores fixture statuses mutated by the accept/hold/release handlers (per-test). */
export function resetBoardState(): void {
  const statuses: Record<string, { status: MissionOffer['status']; playerId: string | null }> = {
    'b-1': { status: 'AVAILABLE', playerId: null },
    'b-2': { status: 'AVAILABLE', playerId: null },
    'b-3': { status: 'AVAILABLE', playerId: null },
    'b-4': { status: 'HELD', playerId: 'player-1' },
  };
  for (const offer of boardState) {
    const restore = statuses[offer.id];
    if (restore !== undefined) {
      offer.status = restore.status;
      offer.playerId = restore.playerId;
      if (restore.status === 'AVAILABLE') {
        offer.acceptedAt = null;
        offer.shipId = null;
      }
    }
  }
}

const world = (): WorldResponse => ({
  locations: [
    ['ceres', 'Porto Ceres', 'port', 250, 340, 0, 'luna', 'lo', 5],
    ['vesta', 'Refinaria Vesta', 'outpost', 430, 210, 1, 'luna', 'lo', 1],
    ['tycho', 'Estaleiro Tycho', 'shipyard', 170, 150, 0, 'luna', 'lo', 2],
    ['gate', 'Portão Kessler', 'junction', 560, 370, 2, 'sun', 'md', 3],
    ['hedus', 'Base Hedus', 'garrison', 720, 250, 2, 'sun', 'md', 2],
    ['marsa', 'Ancoradouro Marsa', 'port', 840, 150, 2, 'sun', 'md', 1],
    ['rennick', 'Estação Rennick', 'outpost', 640, 520, 2, 'explorers', 'md', 0],
    ['drift', 'Campo Drift-9', 'scrap_field', 820, 470, 3, 'pirates', 'hi', 1],
    ['spur', 'Fenda Spur', 'frontier', 410, 520, 2, 'explorers', 'md', 2],
    ['cair', 'Refúgio Cair', 'outpost', 150, 470, 0, 'explorers', 'lo', 4],
    ['veil', 'O Véu', 'dead_zone', 910, 610, 3, 'pirates', 'hi', 0],
    ['echo', 'Eco-7', 'relay', 520, 120, 3, 'sun', 'hi', 1],
  ].map(([id, name, type, x, y, zone, factionId, risk, missionCount]) => ({
    id: id as string,
    displayName: { en: name as string, 'pt-BR': name as string },
    description: {
      en: `${name as string} — a node in the sector.`,
      'pt-BR': `${name as string} — um nó no setor.`,
    },
    type: type as string,
    x: x as number,
    y: y as number,
    zone: zone as number,
    factionId: factionId as string,
    isolation: 1,
    services: { buy: true, sell: true, repair: true, missions: true },
    risk: risk as WorldResponse['locations'][number]['risk'],
    missionCount: missionCount as number,
  })),
  routes: [
    ['tycho-ceres', 'tycho', 'ceres', 420, 2],
    ['tycho-vesta', 'tycho', 'vesta', 480, 2],
    ['vesta-ceres', 'vesta', 'ceres', 430, 2],
    ['vesta-echo', 'vesta', 'echo', 520, 8],
    ['ceres-cair', 'ceres', 'cair', 780, 8],
    ['ceres-gate', 'ceres', 'gate', 400, 5],
    ['cair-spur', 'cair', 'spur', 500, 5],
    ['spur-rennick', 'spur', 'rennick', 460, 5],
    ['gate-hedus', 'gate', 'hedus', 430, 5],
    ['gate-rennick', 'gate', 'rennick', 420, 5],
    ['hedus-marsa', 'hedus', 'marsa', 430, 5],
    ['hedus-echo', 'hedus', 'echo', 460, 8],
    ['rennick-drift', 'rennick', 'drift', 430, 9],
    ['drift-veil', 'drift', 'veil', 460, 9],
    ['spur-drift', 'spur', 'drift', 610, 9],
    ['echo-drift', 'echo', 'drift', 590, 9],
    ['marsa-drift', 'marsa', 'drift', 520, 9],
  ].map(([id, nodeAId, nodeBId, distance, danger]) => ({
    id: id as string,
    nodeAId: nodeAId as string,
    nodeBId: nodeBId as string,
    distance: distance as number,
    danger: danger as number,
    hot: (danger as number) >= 8,
  })),
});
