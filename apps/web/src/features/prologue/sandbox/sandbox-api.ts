import type { ApiInterceptor, InterceptedRequest } from '../../../api/client';
import { ApiError } from '../../../api/client';
import type { Placement } from '../../../api/generated';
import {
  PROLOGUE_BRIDGE,
  PROLOGUE_CARGO,
  PROLOGUE_ENGINE,
  PROLOGUE_HULL,
  PROLOGUE_HULL_UPGRADED,
  PROLOGUE_TANK,
} from '../prologue-fixtures';
import {
  SANDBOX_DIALOGUE,
  SANDBOX_DISPLAY,
  SANDBOX_FACTIONS,
  SANDBOX_FORMATS,
  SANDBOX_MATERIALS,
  SANDBOX_NOTICES,
  SANDBOX_STATS,
  SANDBOX_TUTORIAL_PROGRESS,
  catalogListOf,
  descriptionOf,
  inventoryItemOf,
} from './sandbox-fixtures';
import { activeOf, boardOf, moduleKindOf, offerOf } from './sandbox-offers';
import { reportListOf, reportOf } from './sandbox-reports';
import { assertSavable, enginePreviewOf, flaggedLayout, previewOf, shipOf } from './sandbox-ship';
import { SHIP_ID, type Sandbox } from './sandbox-state';
import { tankSpace } from './sandbox-ship';
import {
  SANDBOX_WORLD,
  SANDBOX_PASSENGER_MODULE,
  SCRAP_NAME,
  UPGRADE_SCRAP,
  fuelNeededFor,
  jobsAt,
  marketListingsOf,
} from './sandbox-world';

const CATALOG_PARTS = [
  SANDBOX_PASSENGER_MODULE,
  PROLOGUE_BRIDGE,
  PROLOGUE_TANK,
  PROLOGUE_HULL,
  PROLOGUE_ENGINE,
  PROLOGUE_CARGO,
] as const;

const NOT_FOUND = 404;
const BAD_REQUEST = 400;
const CONFLICT = 409;
const MS = 1000;
/** A beat after the arrival time, so the settle timer never fires a hair early. */
const SETTLE_SLACK_MS = 50;

/**
 * What a refuel costs: always the whole tank, at the opening's refuel price. A part of a tank would leave the next job
 * without fuel, and the story's money only adds up with one full refuel.
 */
function refuelQuoteOf(sandbox: Sandbox) {
  const space = tankSpace(sandbox);
  const units = space.space;
  const cost = units <= 0 ? 0 : sandbox.config.refuelCost;
  return {
    units,
    cost,
    unitPrice: units > 0 ? cost / units : 0,
    fuel: sandbox.state.fuel,
    fuelCap: space.cap,
    space: space.space,
  };
}

type Params = Record<string, string>;
type Handler = (context: {
  sandbox: Sandbox;
  params: Params;
  query: URLSearchParams;
  body: unknown;
}) => unknown;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly names: readonly string[];
  readonly handler: Handler;
}

/** `/v1/ships/:id/assemble` becomes a pattern that captures `id`. */
function route(method: string, template: string, handler: Handler): Route {
  const names: string[] = [];
  const source = template.replace(/:[A-Za-z]+/g, (token) => {
    names.push(token.slice(1));
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), names, handler };
}

const layoutOf = (body: unknown): Placement[] => {
  const layout = (body as { layout?: Placement[] } | null)?.layout;
  if (!Array.isArray(layout)) throw new ApiError(BAD_REQUEST, 'layout is required', 'BAD_REQUEST');
  return layout;
};

const ROUTES: readonly Route[] = [
  route('GET', '/v1/players/me', ({ sandbox }) => ({
    id: sandbox.config.profile.id,
    name: sandbox.config.profile.name,
    credits: sandbox.state.credits,
    locale: sandbox.config.profile.locale,
    role: sandbox.config.profile.role,
    factionId: null,
    // the opening is the guide: the checklist card stays out of the way
    tutorialDone: true,
    prologueOutcome: null,
    ...(sandbox.config.profile.publicId === undefined
      ? {}
      : { publicId: sandbox.config.profile.publicId }),
    isGuest: false,
  })),
  route('GET', '/v1/players/me/stats', () => SANDBOX_STATS),
  route('GET', '/v1/players/me/tutorial-progress', () => SANDBOX_TUTORIAL_PROGRESS),
  route('GET', '/v1/players/me/dialogue', () => SANDBOX_DIALOGUE),
  route('GET', '/v1/players/me/mentor', () => null),
  route('GET', '/v1/factions', () => SANDBOX_FACTIONS),
  route('GET', '/v1/display', () => SANDBOX_DISPLAY),
  route('GET', '/v1/places/art', () => ({ places: {} })),
  route('GET', '/v1/system/notices', () => SANDBOX_NOTICES),
  route('GET', '/v1/materials', () => SANDBOX_MATERIALS),
  route('GET', '/v1/ship-formats', () => SANDBOX_FORMATS),
  route('GET', '/v1/locations', () => SANDBOX_WORLD),
  route('GET', '/v1/parts/catalog', () => catalogListOf(CATALOG_PARTS)),
  route('GET', '/v1/catalog/parts/:partType', ({ params }) => {
    const part = CATALOG_PARTS.find((entry) => entry.catalog.partType === params.partType);
    if (part === undefined) throw new ApiError(NOT_FOUND, 'part not found', 'NOT_FOUND');
    return {
      id: part.catalog.partType,
      kind: 'part',
      displayName: part.name,
      description: descriptionOf(part),
      category: part.catalog.partClass,
      rarity: part.rarity,
    };
  }),
  route('GET', '/v1/ships', ({ sandbox }) => [shipOf(sandbox)]),
  route('GET', '/v1/ships/:id', ({ sandbox }) => shipOf(sandbox)),
  route('GET', '/v1/ships/:id/escort', () => ({
    state: 'unavailable',
    reasons: ['NOT_STUCK'],
    destinationId: null,
    durationSeconds: null,
    arrivesAt: null,
    nextAvailableAt: null,
  })),
  route('GET', '/v1/inventory', ({ sandbox }) =>
    sandbox.state.parts.map((entry) => inventoryItemOf(entry, SHIP_ID)),
  ),
  route('POST', '/v1/ships/:id/preview', ({ sandbox, body }) => previewOf(sandbox, layoutOf(body))),
  route('POST', '/v1/ships/:id/assemble', ({ sandbox, body }) => {
    const layout = layoutOf(body);
    assertSavable(sandbox, layout);
    sandbox.saveLayout(flaggedLayout(sandbox, layout));
    return shipOf(sandbox);
  }),
  route('POST', '/v1/ships/:id/energy-mode', ({ sandbox }) => shipOf(sandbox)),
  route('POST', '/v1/ships/:id/engine-levels', ({ sandbox }) => shipOf(sandbox)),
  route('GET', '/v1/locations/:id/missions', ({ sandbox, params }) =>
    params.id === sandbox.state.locationId ? boardOf(sandbox) : [],
  ),
  route('POST', '/v1/missions/:id/accept', ({ sandbox, params }) => {
    const offer = boardOf(sandbox).find((entry) => entry.id === params.id);
    if (offer === undefined) throw new ApiError(404, 'mission not found', 'NOT_FOUND');
    if (sandbox.state.mission !== null) {
      throw new ApiError(CONFLICT, 'A mission is already active', 'ACTIVE_MISSION_EXISTS');
    }
    if (!offer.eligibility.eligible) {
      throw new ApiError(CONFLICT, 'not eligible', 'NOT_ELIGIBLE', {
        statusCode: CONFLICT,
        message: { error: 'NOT_ELIGIBLE', reasons: offer.eligibility.reasons },
      });
    }
    const job = jobsAt(
      Math.min(sandbox.state.slot, 3) as 0 | 1 | 2 | 3,
      sandbox.state.locationId,
      moduleKindOf(sandbox),
    ).find((entry) => entry.id === params.id);
    if (job === undefined) throw new ApiError(404, 'mission not found', 'NOT_FOUND');
    sandbox.accept(job);
    return offerOf(sandbox, job);
  }),
  route('POST', '/v1/missions/:id/abandon', ({ sandbox }) => {
    sandbox.abandon();
    return { status: 'AVAILABLE' };
  }),
  route('GET', '/v1/missions/active', ({ sandbox }) =>
    sandbox.state.mission === null ? [] : [activeOf(sandbox, sandbox.state.mission)],
  ),
  route('POST', '/v1/ships/:id/dispatch', ({ sandbox, body }) => {
    const mission = sandbox.state.mission;
    const asked = (body as { missionId?: string } | null)?.missionId;
    if (mission === null || mission.status !== 'ACCEPTED' || mission.id !== asked) {
      throw new ApiError(404, 'no accepted mission to dispatch', 'NOT_FOUND');
    }
    const preview = previewOf(sandbox, sandbox.state.layout);
    if (!preview.viability.viable) {
      throw new ApiError(CONFLICT, 'The ship cannot fly', 'SHIP_NOT_VIABLE', {
        statusCode: CONFLICT,
        message: { error: 'SHIP_NOT_VIABLE', problems: preview.viability.problems },
      });
    }
    const needed = fuelNeededFor(mission.job.routes, preview.sheet.fuelUse);
    if (sandbox.state.fuel < needed) {
      throw new ApiError(CONFLICT, 'Not enough fuel', 'INSUFFICIENT_FUEL');
    }
    const flying = sandbox.dispatch(needed);
    const arrival = flying.arrivalAt ?? 0;
    const startedAt = flying.startedAt ?? 0;
    // a real browser run: bring the flight home on time even if nobody asks; a test drives its own clock
    if (sandbox.config.clock === undefined) {
      setTimeout(() => sandbox.settle(), arrival - startedAt + SETTLE_SLACK_MS);
    }
    return {
      missionId: flying.id,
      arrivalAt: new Date(arrival).toISOString(),
      serverTime: new Date(startedAt).toISOString(),
      durationSeconds: (arrival - startedAt) / MS,
    };
  }),
  route('GET', '/v1/locations/:id/market', ({ sandbox, params }) => ({
    locationId: params.id,
    listings: marketListingsOf(sandbox.config.moduleCost, sandbox.state.chosen),
    sellOffers: [],
    sellMinCondition: 1,
  })),
  route('POST', '/v1/market/buy', ({ sandbox, body }) => {
    const { listingId, expectedPrice } = (body ?? {}) as {
      listingId?: string;
      expectedPrice?: number;
    };
    const listing = marketListingsOf(sandbox.config.moduleCost, sandbox.state.chosen).find(
      (entry) => entry.listingId === listingId,
    );
    if (listing === undefined) throw new ApiError(404, 'listing not found', 'NOT_FOUND');
    if (listing.price !== expectedPrice) {
      throw new ApiError(CONFLICT, 'price changed', 'PRICE_CHANGED', {
        statusCode: CONFLICT,
        message: { error: 'PRICE_CHANGED', actual: listing.price },
      });
    }
    if (sandbox.state.credits < listing.price) {
      throw new ApiError(CONFLICT, 'not enough credits', 'INSUFFICIENT_FUNDS');
    }
    const part = CATALOG_PARTS.find((entry) => entry.catalog.partType === listing.partType);
    if (part === undefined) throw new ApiError(404, 'listing not found', 'NOT_FOUND');
    const id = sandbox.buy(part, listing.price);
    return {
      partInstanceId: id,
      partType: listing.partType,
      condition: listing.condition,
      price: listing.price,
      credits: sandbox.state.credits,
    };
  }),
  route('POST', '/v1/ships/:id/refuel/quote', ({ sandbox }) => {
    const quote = refuelQuoteOf(sandbox);
    return { shipId: SHIP_ID, ...quote };
  }),
  route('POST', '/v1/ships/:id/refuel', ({ sandbox }) => {
    const quote = refuelQuoteOf(sandbox);
    if (quote.cost > sandbox.state.credits) {
      throw new ApiError(CONFLICT, 'not enough credits', 'INSUFFICIENT_FUNDS');
    }
    sandbox.refuel(quote.units, quote.cost);
    return {
      shipId: SHIP_ID,
      units: quote.units,
      cost: quote.cost,
      fuel: sandbox.state.fuel,
      fuelCap: quote.fuelCap,
      credits: sandbox.state.credits,
    };
  }),
  // the other port tabs are shown but cannot be used in the opening; their questions get the plain answer
  route('GET', '/v1/locations/:id/mine/info', () => ({
    minable: false,
    tickSeconds: 300,
    maxTicks: 4,
    fuelPerTick: 0,
    spaceUnits: null,
    fillSeconds: null,
    ores: [],
  })),
  route('POST', '/v1/ships/:id/repair/quote', () => {
    throw new ApiError(CONFLICT, 'nothing to repair', 'NO_REPAIR_TARGETS', {
      statusCode: CONFLICT,
      message: { error: 'NO_REPAIR_TARGETS' },
    });
  }),
  route('POST', '/v1/parts/:id/upgrade/quote', ({ sandbox, params }) => {
    const entry = sandbox.state.parts.find((part) => part.id === params.id);
    const partInstanceId = params.id ?? '';
    // only the hull can go up a tier in the opening; the rest of the ship has no next tier to show
    if (entry === undefined || entry.id !== PROLOGUE_HULL.id) {
      return { partInstanceId, eligible: false, reason: 'NO_NEXT_TIER' };
    }
    if (entry.part.rarity !== 'COMMON')
      return { partInstanceId, eligible: false, reason: 'MAX_TIER' };
    const next = PROLOGUE_HULL_UPGRADED;
    return {
      partInstanceId,
      eligible: true,
      nextPartType: next.catalog.partType,
      nextDisplayName: next.name,
      cost: sandbox.config.upgradeCost,
      materials: [
        {
          materialId: 'scrap',
          displayName: SCRAP_NAME,
          needed: UPGRADE_SCRAP,
          have: sandbox.state.scrap,
        },
      ],
      nextRarity: next.rarity,
      nextDescription: descriptionOf(next),
      nextCatalog: next.catalog,
    };
  }),
  route('POST', '/v1/parts/:id/upgrade', ({ sandbox, params }) => {
    const entry = sandbox.state.parts.find((part) => part.id === params.id);
    if (entry === undefined || entry.id !== PROLOGUE_HULL.id || entry.part.rarity !== 'COMMON') {
      throw new ApiError(CONFLICT, 'cannot upgrade', 'NO_NEXT_TIER');
    }
    if (sandbox.state.credits < sandbox.config.upgradeCost) {
      throw new ApiError(CONFLICT, 'not enough credits', 'INSUFFICIENT_FUNDS');
    }
    if (sandbox.state.scrap < UPGRADE_SCRAP) {
      throw new ApiError(CONFLICT, 'not enough scrap', 'INSUFFICIENT_MATERIALS');
    }
    sandbox.upgradeHull(PROLOGUE_HULL_UPGRADED, sandbox.config.upgradeCost, UPGRADE_SCRAP);
    return {
      partInstanceId: entry.id,
      partType: PROLOGUE_HULL_UPGRADED.catalog.partType,
      displayName: PROLOGUE_HULL_UPGRADED.name,
      rarity: PROLOGUE_HULL_UPGRADED.rarity,
      condition: 100,
      cost: sandbox.config.upgradeCost,
      credits: sandbox.state.credits,
    };
  }),
  route('GET', '/v1/reports', ({ sandbox }) => reportListOf(sandbox)),
  route('GET', '/v1/reports/:missionId', ({ sandbox, params, query }) => {
    const report = reportOf(sandbox, params.missionId ?? '', query.get('view') ?? 'summary');
    if (report === null) throw new ApiError(404, 'report not found', 'NOT_FOUND');
    sandbox.emit({ type: 'report_opened', missionId: params.missionId ?? '' });
    return report;
  }),
  route('POST', '/v1/ships/:id/engine-preview', ({ sandbox, body }) => {
    const levels = (body ?? {}) as { chem?: number; ion?: number };
    return enginePreviewOf(sandbox, levels.chem ?? 1, levels.ion ?? 1);
  }),
];

function matchRoute(request: InterceptedRequest): { route: Route; params: Params } | null {
  const path = request.path.split('?')[0] ?? request.path;
  for (const candidate of ROUTES) {
    if (candidate.method !== request.method) continue;
    const match = candidate.pattern.exec(path);
    if (match === null) continue;
    const params: Params = {};
    candidate.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { route: candidate, params };
  }
  return null;
}

/**
 * The fake server of the opening: it answers the calls the game's real screens make, from the sandbox. A call it does
 * not know goes to the network (so the auth and the final onboarding calls keep working).
 */
export function sandboxInterceptor(sandbox: Sandbox): ApiInterceptor {
  return async (request) => {
    const found = matchRoute(request);
    if (found === null) return { handled: false };
    // the world is never behind the clock: a flight that is over is settled before anything answers
    sandbox.settle();
    const query = new URLSearchParams(request.path.split('?')[1] ?? '');
    const value = await found.route.handler({
      sandbox,
      params: found.params,
      query,
      body: request.body,
    });
    return { handled: true, value };
  };
}
