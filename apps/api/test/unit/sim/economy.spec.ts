/**
 * Phase 3 — jobs, market, upgrades and the spending rule, unit by unit. Prices are recomputed
 * from the same live calculators the actions call, so the tests pin behaviour, not numbers.
 *
 * The snapshot here is the shared fixture plus cloned additions (an UNCOMMON tier, a mining
 * rig, scrap rows, a MINING template): `fixture.ts` itself stays untouched so `bot.spec.ts`
 * keeps flying the same board.
 */
import { describe, expect, it } from '@jest/globals';
import { missionDuration } from '../../../src/missions/duration.calculator.js';
import { buyPrice, sellPrice } from '../../../src/economy/price.calculator.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import { missionContext } from '../../../sim/actions/mission.js';
import { scavenge, scavengeCooldownLeft, scavengeOffer } from '../../../sim/actions/scavenge.js';
import { canMine, mine, miningEligible, miningOffer } from '../../../sim/actions/mining.js';
import {
  buyListing,
  fitPart,
  marketShelf,
  priceInputAt,
  sellMaterial,
  sellPart,
  shelfDayAt,
} from '../../../sim/actions/market.js';
import {
  catalogListingId,
  dayKey,
  USED_OFFER_COUNT,
  usedListingId,
} from '../../../src/economy/used-offers.js';
import { heldForNeed, retentionFor, upgrade, upgradeQuote } from '../../../sim/actions/upgrade.js';
import { catalogIndex, installedParts, shipLevel, starterPlayer } from '../../../sim/core/state.js';
import { buildFillerWorld } from '../../../sim/core/world.js';
import {
  atOrBelowTarget,
  sellList,
  spendPlan,
  type SpendAction,
} from '../../../sim/bots/policy.js';
import { playRun } from '../../../sim/bots/bot.js';
import { fixtureSnapshot } from './fixture.js';
import type { CatalogRow, Snapshot } from '../../../sim/snapshot/types.js';

const TAKEN_AT_MS = Date.parse(fixtureSnapshot().takenAt);
const FIRST_MS = TAKEN_AT_MS;
const SCAVENGE_COOLDOWN_MS = 600_000;

function row(
  overrides: Partial<CatalogRow> & Pick<CatalogRow, 'partType' | 'partClass'>,
): CatalogRow {
  return {
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 1,
    structureCost: 1,
    basePrice: 100,
    scrapValue: 10,
    partHp: 10,
    pot: 0,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
    fuelCap: null,
    fuelUse: null,
    batCharge: null,
    batOutput: null,
    batInput: null,
    specialProp: null,
    active: true,
    ...overrides,
  };
}

/**
 * The fixture plus an upgrade chain, a mining rig and scrap rows (a clone, never the fixture).
 * The clone's bridge is LEGENDARY so the shelf rolls from `market_rarity_by_bridge.LEGENDARY`:
 * COMMON and UNCOMMON are always in stock, which makes the buy-side tests deterministic (the
 * fixture's own COMMON bridge keeps its 14% UNCOMMON / 4.5% RARE / 0% above — the shelf tests
 * use it where "forbidden rarity" is the point).
 */
function econSnapshot(): Snapshot {
  const base = fixtureSnapshot();
  const bridge = base.catalog.find((candidate) => candidate.partType === 'bridge');
  if (bridge === undefined) throw new Error('fixture catalog has no bridge row');
  return {
    ...base,
    catalog: [
      ...base.catalog.filter((candidate) => candidate.partType !== 'bridge'),
      { ...bridge, rarity: 'LEGENDARY' },
      row({
        partType: 'hull_uncommon',
        partClass: 'DEFENSE',
        rarity: 'UNCOMMON',
        w: 2,
        h: 1,
        mass: 5,
        structureCost: 6,
        basePrice: 220,
        scrapValue: 55,
        partHp: 36,
      }),
      // The live row's numbers (UTILITY, min 1): the starter's mining rig.
      row({ partType: 'mining_rig', partClass: 'UTILITY', basePrice: 200, mass: 4, min: 1 }),
      row({
        partType: 'hull_legendary',
        partClass: 'DEFENSE',
        rarity: 'LEGENDARY',
        w: 2,
        h: 1,
        mass: 7,
        structureCost: 9,
        basePrice: 900,
        scrapValue: 225,
        partHp: 60,
      }),
    ],
    materials: [
      ...base.materials,
      {
        id: 'scrap_ceramic',
        displayName: { en: 'Ceramic scrap' },
        description: { en: 'Broken plating.' },
        rarity: 'COMMON' as const,
        basePrice: 3,
        fixedPrice: true,
        active: true,
      },
      {
        id: 'scrap_alloy',
        displayName: { en: 'Alloy scrap' },
        description: { en: 'Denser offcuts.' },
        rarity: 'COMMON' as const,
        basePrice: 9,
        fixedPrice: true,
        active: true,
      },
    ],
    templates: [
      ...base.templates,
      {
        id: 'mining_luna_generic',
        displayName: { en: 'Mining' },
        description: { en: 'Dig here.' },
        type: 'MINING' as const,
        factionId: 'luna',
        requirements: {},
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy: { missionForcesFlee: true },
        active: true,
      },
    ],
  };
}

function hullIdOf(snapshot: Snapshot): string {
  const state = starterPlayer(snapshot, 'luna');
  const hull = state.ship.parts.find((part) => part.partType === 'hull');
  if (hull === undefined) throw new Error('fixture ship has no hull');
  return hull.id;
}

describe('scavenge job', () => {
  const snapshot = fixtureSnapshot();
  const ctx = missionContext(snapshot);
  const world = buildFillerWorld(snapshot);

  it('builds a SCAVENGE offer at the ship’s own port that pays nothing and burns no fuel', () => {
    const state = starterPlayer(snapshot, 'luna');
    const offer = scavengeOffer({ snapshot, world, state, nowMs: FIRST_MS });
    expect(offer).not.toBeNull();
    expect(offer?.type).toBe('SCAVENGE');
    expect(offer?.templateId).toBe('scavenge_generic');
    expect(offer?.reward).toBe(0);
    expect(offer?.originId).toBe('ceres');
    expect(offer?.destinationId).toBe('ceres');
    // The leg borrows its risk from the port's routes (peak danger 2 here) and never leaves.
    expect(offer?.legs[0]?.danger).toBe(2);
    expect(offer?.legs[0]?.env.fuelMult).toBe(0);
  });

  it('runs the job for the scavenging duration, pays nothing, and does not count as a mission', () => {
    const state = starterPlayer(snapshot, 'luna');
    const offer = scavengeOffer({ snapshot, world, state, nowMs: FIRST_MS });
    if (offer === null) throw new Error('expected an offer');
    const sheet = deriveSheet(installedParts(state.ship, catalogIndex(snapshot)), snapshot.rules);
    const { durationSeconds } = missionDuration({
      totalDistance: offer.legs[0]?.distance ?? 0,
      mobility: sheet.mob,
      durationK: snapshot.rules.missions.duration_k,
      timeScale: snapshot.rules.missions.time_scale,
      classCutoffs: snapshot.rules.missions.duration_class_cutoffs,
    });

    const out = scavenge(state, ctx, world, FIRST_MS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.durationSeconds).toBe(durationSeconds);
    expect(
      Math.abs(out.durationSeconds - snapshot.rules.scavenging.duration_seconds),
    ).toBeLessThanOrEqual(2);
    expect(state.clock.now()).toBe(out.durationSeconds);
    // A job is work at the dock, not contract work: the run's tally stays put.
    expect(state.missionsDone).toBe(0);
    expect(state.scavengesDone).toBe(1);
    expect(state.ledger.total('reward')).toBe(0);
    // Whatever the resolver rolled lands in the hold (the scrap materials mirror the counter;
    // a fight could have stolen a found part, so storage is a lower bound on partsFound).
    const scrapHeld = [...state.materials]
      .filter(([materialId]) => materialId.startsWith('scrap_'))
      .reduce((sum, [, quantity]) => sum + quantity, 0);
    expect(scrapHeld).toBe(out.scrapFound);
    const scavengedInHold = state.storage.filter((part) => part.source === 'scavenge');
    expect(scavengedInHold.length).toBeLessThanOrEqual(out.partsFound);
    for (const part of scavengedInHold) expect(part.id.startsWith('scavenged-')).toBe(true);
  });

  it('is deterministic: the same state, port and millisecond roll the same finds', () => {
    const first = scavenge(starterPlayer(snapshot, 'luna'), ctx, world, FIRST_MS);
    const second = scavenge(starterPlayer(snapshot, 'luna'), ctx, world, FIRST_MS);
    expect(second).toEqual(first);
  });

  it('holds the per-port cooldown for exactly rules.scavenging.cooldown_seconds', () => {
    const state = starterPlayer(snapshot, 'luna');
    const first = scavenge(state, ctx, world, FIRST_MS);
    expect(first.ok).toBe(true);

    expect(scavengeCooldownLeft(state, ctx.rules, FIRST_MS)).toBe(600);
    const blocked = scavenge(state, ctx, world, FIRST_MS);
    expect(blocked).toEqual({ ok: false, reason: 'SCAVENGE_COOL_DOWN:600' });

    const almost = scavengeCooldownLeft(state, ctx.rules, FIRST_MS + SCAVENGE_COOLDOWN_MS - 1000);
    expect(almost).toBe(1);
    const afterMs = FIRST_MS + SCAVENGE_COOLDOWN_MS;
    expect(scavengeCooldownLeft(state, ctx.rules, afterMs)).toBe(0);
    const second = scavenge(state, ctx, world, afterMs);
    expect(second.ok).toBe(true);

    expect(state.scavengeAttempts.get('ceres')?.count).toBe(2);
    expect(state.missionsDone).toBe(0);
    expect(state.scavengesDone).toBe(2);
  });

  it('refuses when the port has no route to borrow a leg from', () => {
    const stranded: Snapshot = { ...fixtureSnapshot(), routes: [], routeEnvironments: [] };
    const strandedCtx = missionContext(stranded);
    const strandedWorld = buildFillerWorld(stranded);
    const state = starterPlayer(stranded, 'luna');
    expect(
      scavengeOffer({ snapshot: stranded, world: strandedWorld, state, nowMs: FIRST_MS }),
    ).toBeNull();
    expect(scavenge(state, strandedCtx, strandedWorld, FIRST_MS)).toEqual({
      ok: false,
      reason: 'NO_ROUTE',
    });
  });
});

describe('mining job', () => {
  it('refuses a place with no active MINING template', () => {
    const snapshot = fixtureSnapshot();
    const state = starterPlayer(snapshot, 'luna');
    expect(miningEligible(snapshot, buildFillerWorld(snapshot), 'ceres')).toBe(false);
    expect(canMine(state, missionContext(snapshot), buildFillerWorld(snapshot))).toEqual({
      ok: false,
      reason: 'NOT_MINABLE',
    });
  });

  it('refuses a ship with no mining rig in the sheet', () => {
    const snapshot = econSnapshot();
    const state = starterPlayer(snapshot, 'luna');
    expect(miningEligible(snapshot, buildFillerWorld(snapshot), 'ceres')).toBe(true);
    expect(canMine(state, missionContext(snapshot), buildFillerWorld(snapshot))).toEqual({
      ok: false,
      reason: 'NO_MINING_RIG',
    });
  });

  it('digs a free job that lasts the job duration, does not count as a mission, and yields ore', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const world = buildFillerWorld(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.storage.push({ id: 'rig-1', partType: 'mining_rig', condition: 100 });
    const fitted = fitPart(state, ctx.rules, ctx.catalogByType, 'rig-1');
    expect(fitted).toEqual({ ok: true });
    expect(canMine(state, ctx, world)).toEqual({ ok: true, reason: 'ok' });

    const DIG_MS = FIRST_MS + 2000; // a deterministic job time whose stop yields ore
    const offer = miningOffer({ snapshot, world, state, nowMs: DIG_MS });
    if (offer === null) throw new Error('expected a mining offer');
    expect(offer.type).toBe('MINING');
    expect(offer.cargo).toMatchObject({ materialId: 'ore_iron', contracted: false });
    const sheet = deriveSheet(installedParts(state.ship, ctx.catalogByType), ctx.rules);
    const { durationSeconds } = missionDuration({
      totalDistance: offer.legs[0]?.distance ?? 0,
      mobility: sheet.mob,
      durationK: ctx.rules.missions.duration_k,
      timeScale: ctx.rules.missions.time_scale,
      classCutoffs: ctx.rules.missions.duration_class_cutoffs,
    });

    const out = mine(state, ctx, world, DIG_MS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.materialId).toBe('ore_iron');
    expect(out.durationSeconds).toBe(durationSeconds);
    expect(
      Math.abs(out.durationSeconds - ctx.rules.mining.job_duration_seconds),
    ).toBeLessThanOrEqual(2);
    expect(state.missionsDone).toBe(0);
    expect(state.miningDone).toBe(1);
    expect(state.ledger.total('reward')).toBe(0);
    expect(state.storage.some((part) => part.partType === 'mining_rig')).toBe(false); // fitted, not stowed
    expect(state.ship.parts.some((part) => part.partType === 'mining_rig')).toBe(true);
    // The dig's yield: this seeded stop rolled one unit. A free stop is not guaranteed ore —
    // only paid contracts carry `minimumYield` — so the job time is chosen to yield.
    expect(out.status).toBe('success');
    expect(state.materials.get('ore_iron') ?? 0).toBeGreaterThan(0);
  });

  it('is deterministic: the same port and millisecond dig the same material', () => {
    const first = mine(
      starterPlayer(econSnapshot(), 'luna'),
      missionContext(econSnapshot()),
      buildFillerWorld(econSnapshot()),
      FIRST_MS,
    );
    const second = mine(
      starterPlayer(econSnapshot(), 'luna'),
      missionContext(econSnapshot()),
      buildFillerWorld(econSnapshot()),
      FIRST_MS,
    );
    expect(second).toEqual(first);
  });
});

describe('market: buying', () => {
  const snapshot = fixtureSnapshot();
  const ctx = missionContext(snapshot);

  it('debits buyPrice at the port and files the part pristine in the hold', () => {
    const state = starterPlayer(snapshot, 'luna');
    const price = buyPrice(priceInputAt(snapshot, 'luna', 'ceres', 100, 100), ctx.rules);
    const out = buyListing(state, snapshot, ctx.rules, ctx.catalogByType, 'catalog:ceres:hull');
    expect(out).toEqual({ ok: true, price, partId: 'bought-1', condition: 100 });
    expect(state.wallet).toBe(200 - price);
    expect(state.ledger.total('purchase')).toBe(-price);
    expect(state.storage).toEqual([{ id: 'bought-1', partType: 'hull', condition: 100 }]);
  });

  it('refuses what the wallet cannot pay and changes nothing', () => {
    const state = starterPlayer(snapshot, 'luna');
    const out = buyListing(
      state,
      snapshot,
      ctx.rules,
      ctx.catalogByType,
      'catalog:ceres:shield_basic',
    );
    expect(out).toEqual({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
    expect(state.wallet).toBe(200);
    expect(state.ledger.total('purchase')).toBe(0);
    expect(state.storage).toEqual([]);
  });

  it('refuses a buy away from the ship, a malformed id, and an off-shelf part', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = 'tycho';
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, 'catalog:ceres:hull')).toEqual(
      { ok: false, reason: 'SHIP_NOT_AT_LOCATION' },
    );
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, 'garbage')).toEqual({
      ok: false,
      reason: 'INVALID_LISTING',
    });
    expect(
      buyListing(state, snapshot, ctx.rules, ctx.catalogByType, 'catalog:tycho:hull_x'),
    ).toEqual({ ok: false, reason: 'NOT_ON_SHELF' });
    expect(state.wallet).toBe(200);
  });
});

describe('market: the shelf', () => {
  it('lists today’s board: every active row new at 100, six used slots from the same pool', () => {
    const snapshot = fixtureSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    const shelf = marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, 'ceres');
    const fresh = shelf.filter((listing) => listing.kind === 'catalog');
    const used = shelf.filter((listing) => listing.kind === 'used');
    // The COMMON bridge's fallback: COMMON is always in stock, and these rows are all common.
    expect(fresh.map((listing) => listing.partType).sort()).toEqual([
      'bridge',
      'cargo',
      'engine_chem_small',
      'hull',
      'shield_basic',
      'tank_small',
    ]);
    expect(fresh.every((listing) => listing.condition === 100)).toBe(true);
    expect(used).toHaveLength(USED_OFFER_COUNT);
    // The used slots draw from the in-stock pool and price at their own worn condition.
    for (const listing of used) {
      expect(listing.condition).toBeGreaterThanOrEqual(40);
      expect(listing.condition).toBeLessThanOrEqual(90);
      const row = ctx.catalogByType.get(listing.partType);
      if (row === undefined) throw new Error(`unknown used part ${listing.partType}`);
      expect(listing.price).toBe(
        buyPrice(
          priceInputAt(snapshot, 'luna', 'ceres', row.basePrice, listing.condition),
          ctx.rules,
        ),
      );
    }
    expect(state.soldListings.size).toBe(0);
  });

  it('never lists nor sells a rarity the bridge’s chance forbids', () => {
    const base = fixtureSnapshot();
    // COMMON bridge → market_rarity_by_bridge.COMMON gives LEGENDARY a 0 chance.
    const snapshot: Snapshot = {
      ...base,
      catalog: [
        ...base.catalog,
        row({
          partType: 'hull_legendary',
          partClass: 'DEFENSE',
          rarity: 'LEGENDARY',
          w: 2,
          h: 1,
          basePrice: 900,
        }),
      ],
    };
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    const shelf = marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, 'ceres');
    expect(shelf.some((listing) => listing.partType === 'hull_legendary')).toBe(false);
    expect(
      buyListing(state, snapshot, ctx.rules, ctx.catalogByType, 'catalog:ceres:hull_legendary'),
    ).toEqual({ ok: false, reason: 'NOT_ON_SHELF' });
    expect(state.wallet).toBe(200);
    expect(state.storage).toEqual([]);
  });

  it('stocks what the upgraded bridge allows, and the first buyer takes it for the day', () => {
    const snapshot = econSnapshot(); // LEGENDARY bridge → UNCOMMON chance 1
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.wallet = 10_000;
    const listingId = catalogListingId('ceres', 'hull_uncommon');
    const listed = marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, 'ceres').find(
      (listing) => listing.listingId === listingId,
    );
    expect(listed).toBeDefined();
    expect(listed?.condition).toBe(100);

    const out = buyListing(state, snapshot, ctx.rules, ctx.catalogByType, listingId);
    expect(out).toMatchObject({ ok: true, price: listed?.price, condition: 100 });
    expect(state.storage).toEqual([{ id: 'bought-1', partType: 'hull_uncommon', condition: 100 }]);
    expect(state.wallet).toBe(10_000 - (listed?.price ?? 0));

    // One physical item: gone from the board and un-buyable until the day rolls.
    expect(
      marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, 'ceres').some(
        (listing) => listing.listingId === listingId,
      ),
    ).toBe(false);
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, listingId)).toEqual({
      ok: false,
      reason: 'LISTING_SOLD',
    });
  });

  it('restocks on the day roll and rejects a used listing minted on another day', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.wallet = 10_000;
    const listingId = catalogListingId('ceres', 'hull_uncommon');
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, listingId).ok).toBe(true);

    state.clock.advance(24 * 3600);
    expect(shelfDayAt(state, snapshot)).toBe(
      dayKey(new Date(Date.parse(snapshot.takenAt) + 86_400_000)),
    );
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, listingId).ok).toBe(true);
    expect(state.storage).toHaveLength(2);

    // Yesterday's used ids are stale: the board only sells today's roll.
    const stale = usedListingId('ceres', '2026-10-11', 0, 'hull');
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, stale)).toEqual({
      ok: false,
      reason: 'INVALID_LISTING',
    });
  });

  it('buys a used slot at its worn condition and then it is sold too', () => {
    const snapshot = fixtureSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.wallet = 10_000;
    const used = marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, 'ceres').find(
      (listing) => listing.kind === 'used',
    );
    if (used === undefined) throw new Error('the used shelf is empty');
    const out = buyListing(state, snapshot, ctx.rules, ctx.catalogByType, used.listingId);
    expect(out).toMatchObject({
      ok: true,
      price: used.price,
      condition: used.condition,
    });
    expect(state.storage).toEqual([
      { id: 'bought-1', partType: used.partType, condition: used.condition },
    ]);
    expect(state.ledger.total('purchase')).toBe(-used.price);
    expect(buyListing(state, snapshot, ctx.rules, ctx.catalogByType, used.listingId)).toEqual({
      ok: false,
      reason: 'LISTING_SOLD',
    });
  });
});

describe('market: selling', () => {
  const snapshot = fixtureSnapshot();
  const ctx = missionContext(snapshot);

  it('refuses a part worn below sell_min_condition', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.storage.push({ id: 'wreck', partType: 'hull', condition: 0 });
    const out = sellPart(state, snapshot, ctx.rules, 'wreck');
    expect(out).toEqual({ ok: false, reason: 'TOO_DAMAGED_TO_SELL' });
    expect(state.storage).toHaveLength(1);
    expect(state.wallet).toBe(200);
  });

  it('credits sellPrice on the part’s own condition into the sale line', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.storage.push({ id: 'used', partType: 'hull', condition: 85 });
    const price = sellPrice(priceInputAt(snapshot, 'luna', 'ceres', 100, 85), ctx.rules);
    const out = sellPart(state, snapshot, ctx.rules, 'used');
    expect(out).toMatchObject({ ok: true, price });
    expect(state.wallet).toBe(200 + price);
    expect(state.ledger.total('sale')).toBe(price);
    expect(state.storage).toEqual([]);
  });

  it('files a scavenge find on its own ledger line', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.storage.push({ id: 'find', partType: 'hull', condition: 85, source: 'scavenge' });
    const price = sellPrice(priceInputAt(snapshot, 'luna', 'ceres', 100, 85), ctx.rules);
    expect(sellPart(state, snapshot, ctx.rules, 'find')).toMatchObject({ ok: true, price });
    expect(state.ledger.total('scavengeSale')).toBe(price);
    expect(state.ledger.total('sale')).toBe(0);
  });

  it('sells materials by the material rule: ore through sellPrice, scrap at its fixed price', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.materials.set('ore_iron', 5);
    state.materials.set('scrap_ceramic', 4);

    const oreUnit = sellPrice(priceInputAt(snapshot, 'luna', 'ceres', 10, 100), ctx.rules);
    const ore = sellMaterial(state, snapshot, ctx.rules, 'ore_iron', 2);
    expect(ore).toMatchObject({ ok: true, units: 2, credits: 2 * oreUnit });
    expect(state.materials.get('ore_iron')).toBe(3);
    expect(state.ledger.total('oreSale')).toBe(2 * oreUnit);

    // Scrap never takes place or mood: exactly basePrice per unit (floored at 1).
    expect(sellMaterial(state, snapshot, ctx.rules, 'scrap_ceramic', 99)).toMatchObject({
      ok: true,
      units: 4,
      credits: 4 * 3,
    });
    expect(state.materials.has('scrap_ceramic')).toBe(false);

    expect(sellMaterial(state, snapshot, ctx.rules, 'ore_iron', 0)).toEqual({
      ok: false,
      reason: 'NONE_HELD',
    });
    expect(sellMaterial(state, snapshot, ctx.rules, 'unobtainium', 1)).toEqual({
      ok: false,
      reason: 'MATERIAL_NOT_FOUND',
    });
  });
});

describe('fitting', () => {
  const snapshot = econSnapshot();
  const ctx = missionContext(snapshot);

  it('swaps a loose part into the slot and the displaced one back to the hold', () => {
    const state = starterPlayer(snapshot, 'luna');
    const hullId = hullIdOf(snapshot);
    state.storage.push({ id: 'new-hull', partType: 'hull_uncommon', condition: 100 });
    const out = fitPart(state, ctx.rules, ctx.catalogByType, 'new-hull', hullId);
    expect(out).toEqual({ ok: true });
    expect(state.ship.parts.some((part) => part.id === 'new-hull')).toBe(true);
    expect(state.storage.some((part) => part.id === hullId)).toBe(true);
    expect(state.wallet).toBe(200);
  });

  it('refuses an unknown hold part and a missing installed slot', () => {
    const state = starterPlayer(snapshot, 'luna');
    expect(fitPart(state, ctx.rules, ctx.catalogByType, 'ghost')).toEqual({
      ok: false,
      reason: 'PART_NOT_FOUND',
    });
    state.storage.push({ id: 'new-hull', partType: 'hull_uncommon', condition: 100 });
    expect(fitPart(state, ctx.rules, ctx.catalogByType, 'new-hull', 'ghost')).toEqual({
      ok: false,
      reason: 'INSTALLED_NOT_FOUND',
    });
  });
});

describe('upgrade', () => {
  it('refuses cleanly and changes nothing when the plan cannot be made', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    const hullId = hullIdOf(snapshot);
    const hullPart = state.ship.parts.find((part) => part.id === hullId);
    expect(hullPart?.condition).toBeLessThan(100); // starter parts fly used, never pristine

    const damaged = upgrade(state, snapshot, ctx.rules, ctx.catalogByType, hullId);
    expect(damaged).toEqual({ ok: false, reason: 'NOT_FULL_CONDITION' });
    expect(state.wallet).toBe(200);

    if (hullPart !== undefined) hullPart.condition = 100;
    state.storage.push({ id: 'loose-1', partType: 'hull', condition: 100 });
    expect(upgrade(state, snapshot, ctx.rules, ctx.catalogByType, 'loose-1')).toEqual({
      ok: false,
      reason: 'NOT_INSTALLED',
    });
    expect(upgrade(state, snapshot, ctx.rules, ctx.catalogByType, 'ghost')).toEqual({
      ok: false,
      reason: 'PART_NOT_FOUND',
    });
    // LEGENDARY is the top of its ladder: no next tier exists by naming convention.
    state.ship.parts.push({ id: 'legend', partType: 'hull_legendary', condition: 100 });
    expect(upgrade(state, snapshot, ctx.rules, ctx.catalogByType, 'legend')).toEqual({
      ok: false,
      reason: 'MAX_TIER',
    });
    expect(state.wallet).toBe(200);
    expect(state.ledger.total('upgrade')).toBe(0);

    // The bare fixture has no UNCOMMON row, so the chain stops before pricing.
    const bare = fixtureSnapshot();
    const bareCtx = missionContext(bare);
    const bareState = starterPlayer(bare, 'luna');
    const bareHull = bareState.ship.parts.find((part) => part.partType === 'hull');
    expect(
      upgrade(bareState, bare, bareCtx.rules, bareCtx.catalogByType, bareHull?.id ?? ''),
    ).toEqual({
      ok: false,
      reason: 'NO_NEXT_TIER',
    });
  });

  it('quotes the money and materials without touching anything', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.ship.parts.forEach((part) => {
      if (part.partType === 'hull') part.condition = 100;
    });
    const hullId = hullIdOf(snapshot);
    const quote = upgradeQuote(state, snapshot, ctx.rules, ctx.catalogByType, hullId);
    expect(quote.ok).toBe(true);
    expect(quote.partType).toBe('hull');
    expect(quote.nextPartType).toBe('hull_uncommon');
    // (220 − 100) × the COMMON multiplier 1.1, and ceil(sqrt(120)/5) = 3 scrap.
    expect(quote.cost).toBe(132);
    expect(quote.needs).toEqual([{ material: 'scrap', quantity: 3 }]);
    expect(state.wallet).toBe(200);
    expect(state.ship.parts.find((part) => part.id === hullId)?.partType).toBe('hull');
  });

  it('fails cleanly on money, then on materials — in that order, changing nothing', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.ship.parts.forEach((part) => {
      if (part.partType === 'hull') part.condition = 100;
    });
    const hullId = hullIdOf(snapshot);

    state.materials.set('scrap_ceramic', 3);
    state.wallet = 10;
    const broke = upgrade(state, snapshot, ctx.rules, ctx.catalogByType, hullId);
    expect(broke).toMatchObject({ ok: false, reason: 'INSUFFICIENT_FUNDS', cost: 132 });
    expect(state.wallet).toBe(10);
    expect(state.materials.get('scrap_ceramic')).toBe(3);

    state.wallet = 10_000;
    state.materials.set('scrap_ceramic', 2); // 2 < the 3 the upgrade asks for
    const short = upgrade(state, snapshot, ctx.rules, ctx.catalogByType, hullId);
    expect(short).toMatchObject({ ok: false, reason: 'INSUFFICIENT_MATERIALS' });
    expect(state.wallet).toBe(10_000);
    expect(state.materials.get('scrap_ceramic')).toBe(2);
    expect(state.ship.parts.find((part) => part.id === hullId)?.partType).toBe('hull');
  });

  it('charges the money, takes scrap cheapest-first, and carries the condition', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.ship.parts.forEach((part) => {
      if (part.partType === 'hull') part.condition = 100;
    });
    const hullId = hullIdOf(snapshot);
    state.wallet = 10_000;
    state.materials.set('scrap_ceramic', 1); // basePrice 3: consumed before the alloy
    state.materials.set('scrap_alloy', 5); // basePrice 9

    const out = upgrade(state, snapshot, ctx.rules, ctx.catalogByType, hullId);
    expect(out).toEqual({ ok: true, partId: hullId, partType: 'hull_uncommon', cost: 132 });
    expect(state.wallet).toBe(10_000 - 132);
    expect(state.ledger.total('upgrade')).toBe(-132);
    expect(state.materials.has('scrap_ceramic')).toBe(false);
    expect(state.materials.get('scrap_alloy')).toBe(3); // 5 − (3 − 1)
    const hull = state.ship.parts.find((part) => part.id === hullId);
    expect(hull?.partType).toBe('hull_uncommon');
    expect(hull?.condition).toBe(100);
  });

  it('counts held scrap across every scrap id and allocates retention cheapest-first', () => {
    const snapshot = econSnapshot();
    const state = starterPlayer(snapshot, 'luna');
    state.materials.set('scrap_ceramic', 1);
    state.materials.set('scrap_alloy', 5);
    state.materials.set('ore_iron', 9);

    expect(heldForNeed(state, { material: 'scrap', quantity: 3 })).toBe(6);
    expect(heldForNeed(state, { material: 'ore_iron', quantity: 3 })).toBe(9);
    expect(heldForNeed(state, { material: 'rare_crystals', quantity: 3 })).toBe(0);

    const keep = retentionFor(state, snapshot, [{ material: 'scrap', quantity: 3 }]);
    expect([...keep]).toEqual([
      ['scrap_ceramic', 1],
      ['scrap_alloy', 2],
    ]);
  });
});

describe('shipLevel', () => {
  it('is 1 for an empty hull, 1 for the all-common starter, and the lowest rarity otherwise', () => {
    const bare = fixtureSnapshot();
    const bareCtx = missionContext(bare);
    const empty = starterPlayer(bare, 'luna');
    empty.ship.parts = [];
    expect(shipLevel(empty.ship, bareCtx.catalogByType)).toBe(1);
    expect(shipLevel(starterPlayer(bare, 'luna').ship, bareCtx.catalogByType)).toBe(1);

    const econ = econSnapshot();
    const econCtx = missionContext(econ);
    const state = starterPlayer(econ, 'luna');
    state.ship.parts = [{ id: 'u', partType: 'hull_uncommon', condition: 100 }];
    expect(shipLevel(state.ship, econCtx.catalogByType)).toBe(2);
    // One common part drags the whole hull back to level 1 — every slot must grow together.
    state.ship.parts.push({ id: 'c', partType: 'hull', condition: 100 });
    expect(shipLevel(state.ship, econCtx.catalogByType)).toBe(1);
    state.ship.parts = [{ id: 'l', partType: 'hull_legendary', condition: 100 }];
    expect(shipLevel(state.ship, econCtx.catalogByType)).toBe(5);
  });
});

describe('ratio policy', () => {
  it('starts a fresh behaviour and fires only while the window is at or under target', () => {
    expect(atOrBelowTarget([], 0.75)).toBe(true);
    expect(atOrBelowTarget([true, false, false, false], 0.75)).toBe(true); // 25%
    expect(atOrBelowTarget([true, true, true, false], 0.75)).toBe(true); // exactly 75%
    expect(atOrBelowTarget([true, true, true, true], 0.75)).toBe(false); // 100%
    expect(atOrBelowTarget([true, false], 0.75)).toBe(true); // 50%
  });

  it('keeps the scavenge ratio at or above 75% over a long run (fixed seed, statistical)', () => {
    const flags: boolean[] = [];
    let fired = 0;
    for (let i = 0; i < 500; i += 1) {
      const take = atOrBelowTarget(flags, 0.75);
      flags.push(take);
      if (take) fired += 1;
      if (flags.length > 20) flags.shift();
    }
    expect(fired / 500).toBeGreaterThanOrEqual(0.75);
  });

  it('keeps the mining ratio at or above 50% over a long run', () => {
    const flags: boolean[] = [];
    let fired = 0;
    for (let i = 0; i < 500; i += 1) {
      const take = atOrBelowTarget(flags, 0.5);
      flags.push(take);
      if (take) fired += 1;
      if (flags.length > 20) flags.shift();
    }
    expect(fired / 500).toBeGreaterThanOrEqual(0.5);
  });
});

describe('spending plan', () => {
  it('never spends into the reserve: a broke starter is told to save', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna'); // wallet 200, tank already full
    const plan = spendPlan(state, snapshot, ctx.rules, ctx.catalogByType, []);
    expect(plan.action).toEqual({ kind: 'none', reason: 'reserve' });
    // The sell pass still protects what the next upgrade will ask for.
    expect(plan.keepNeeds).toEqual([{ material: 'scrap', quantity: 3 }]);
    expect(state.wallet).toBe(200);
  });

  it('fits a loose mining rig first, for free, while the sheet has none', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.storage.push({ id: 'rig-9', partType: 'mining_rig', condition: 100 });
    const plan = spendPlan(state, snapshot, ctx.rules, ctx.catalogByType, []);
    expect(plan.action).toMatchObject({
      kind: 'fit',
      storageId: 'rig-9',
      reason: 'fit-mining-rig',
    });
    expect(state.wallet).toBe(200);
    expect(state.ship.parts.some((part) => part.id === 'rig-9')).toBe(false);
  });

  it('takes the cheapest net way up for the lowest-rarity slot', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.wallet = 10_000;
    const hullId = hullIdOf(snapshot);
    const hull = state.ship.parts.find((part) => part.id === hullId);
    if (hull === undefined) throw new Error('fixture ship has no hull');
    hull.condition = 100;

    const plan = spendPlan(state, snapshot, ctx.rules, ctx.catalogByType, []);
    const quote = upgradeQuote(state, snapshot, ctx.rules, ctx.catalogByType, hullId);
    const hullRow = ctx.catalogByType.get('hull');
    if (hullRow === undefined) throw new Error('missing hull row');
    const ports = snapshot.locations.map((location) => location.id);
    const sellOldAt = (locationId: string): number =>
      sellPrice(priceInputAt(snapshot, 'luna', locationId, hullRow.basePrice, 100), ctx.rules);

    // Every way up, recomputed from today's shelf the way the policy ranks them: the cheapest
    // hull_uncommon listing at any port (new or used) net of the old hull's sale, the fill of
    // the missing rig slot, and the in-place upgrade quote.
    const hullNets = ports.flatMap((locationId) =>
      marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, locationId)
        .filter((listing) => listing.partType === 'hull_uncommon')
        .map((listing) => listing.price - sellOldAt(locationId)),
    );
    const rigNets = ports.flatMap((locationId) =>
      marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, locationId)
        .filter((listing) => listing.partType === 'mining_rig')
        .map((listing) => listing.price),
    );
    expect(hullNets.length).toBeGreaterThan(0); // the LEGENDARY bridge stocks UNCOMMON
    const cheapest = Math.min(quote.cost ?? Number.POSITIVE_INFINITY, ...hullNets, ...rigNets);

    // The chosen action really is that cheapest option — resolved back to its net.
    const netOf = (action: SpendAction): number => {
      switch (action.kind) {
        case 'upgrade':
          return quote.cost ?? Number.POSITIVE_INFINITY;
        case 'buy':
          return action.price - (action.targetBase === 'hull' ? sellOldAt(action.locationId) : 0);
        case 'travel-to-buy': {
          // The policy shops for the target's exact next row — for the hull slot that is
          // hull_uncommon, not a used hull of the very tier we are trying to leave.
          const wanted = action.targetBase === 'hull' ? 'hull_uncommon' : action.targetBase;
          const price = Math.min(
            ...marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, action.locationId)
              .filter((listing) => listing.partType === wanted)
              .map((listing) => listing.price),
          );
          return price - (action.targetBase === 'hull' ? sellOldAt(action.locationId) : 0);
        }
        case 'fit':
          return 0;
        default:
          return Number.POSITIVE_INFINITY;
      }
    };
    expect(netOf(plan.action)).toBe(cheapest);
    if (plan.action.kind === 'upgrade') {
      expect(plan.action.partId).toBe(hullId);
    } else {
      expect(['buy', 'travel-to-buy']).toContain(plan.action.kind);
    }
    // The reserve (a full refuel here — the tank is full, so 0 — plus the standing repair
    // fallback of 500) is never touched by the chosen action's cash.
    const cash =
      plan.action.kind === 'buy'
        ? plan.action.price
        : plan.action.kind === 'upgrade'
          ? (quote.cost ?? 0)
          : 0;
    expect(cash).toBeLessThanOrEqual(10_000 - 500);
  });

  it('does nothing and keeps earning when even the cheapest way up is past the reserve', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    const hull = state.ship.parts.find((part) => part.partType === 'hull');
    if (hull !== undefined) hull.condition = 100;
    // One credit under the dearest thing the plan could do — today's own cheapest listing
    // (the used shelf really has one) or the upgrade quote — so the reserve (the refill: the
    // tank is full, 0 — plus the standing repair fallback of 500) leaves nothing affordable.
    const quote = upgradeQuote(state, snapshot, ctx.rules, ctx.catalogByType, hullIdOf(snapshot));
    const cheapestCash = Math.min(
      quote.cost ?? Number.POSITIVE_INFINITY,
      ...snapshot.locations.flatMap((location) =>
        marketShelf(state, snapshot, ctx.rules, ctx.catalogByType, location.id)
          .filter(
            (listing) => listing.partType === 'hull_uncommon' || listing.partType === 'mining_rig',
          )
          .map((listing) => listing.price),
      ),
    );
    expect(Number.isFinite(cheapestCash)).toBe(true);
    state.wallet = 500 + cheapestCash - 1; // available = cheapestCash − 1 → no option fits
    const plan = spendPlan(state, snapshot, ctx.rules, ctx.catalogByType, []);
    expect(plan.action).toEqual({ kind: 'none', reason: 'saving' });
    expect(state.wallet).toBe(500 + cheapestCash - 1);
  });
});

describe('sell list', () => {
  it('sells surplus parts and materials, keeping the target ship and the upgrade’s scrap', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.storage = [
      { id: 'hull-good', partType: 'hull', condition: 100 },
      { id: 'hull-worn', partType: 'hull', condition: 40 },
      { id: 'hull-broken', partType: 'hull', condition: 0 }, // below sell_min_condition
      { id: 'tank-loose', partType: 'tank_small', condition: 100 }, // not in the target kit
      { id: 'rig-loose', partType: 'mining_rig', condition: 100 },
    ];
    state.materials.set('scrap_ceramic', 5);
    state.materials.set('ore_iron', 4);

    const keepNeeds = [{ material: 'scrap', quantity: 2 }];
    const list = sellList(state, snapshot, ctx.rules, ctx.catalogByType, keepNeeds);
    expect([...list.partIds].sort()).toEqual(['hull-worn', 'tank-loose']);
    const materials = new Map(list.materials.map((entry) => [entry.materialId, entry.quantity]));
    expect(materials.get('scrap_ceramic')).toBe(3); // 5 held, 2 reserved for the upgrade
    expect(materials.get('ore_iron')).toBe(4); // ore is never part of an upgrade here
    expect(state.storage).toHaveLength(5); // selling happens in the market actions, not here
  });

  it('keeps the loose rig only while the ship has none, and the kit’s best candidate always', () => {
    const snapshot = econSnapshot();
    const ctx = missionContext(snapshot);
    const state = starterPlayer(snapshot, 'luna');
    state.storage = [
      { id: 'hull-good', partType: 'hull', condition: 100 },
      { id: 'rig-loose', partType: 'mining_rig', condition: 100 },
    ];
    const noRig = sellList(state, snapshot, ctx.rules, ctx.catalogByType, []);
    expect(noRig.partIds).toEqual([]); // best hull for the kit and the only rig stay home

    state.ship.parts.push({ id: 'rig-on', partType: 'mining_rig', condition: 100 });
    const withRig = sellList(state, snapshot, ctx.rules, ctx.catalogByType, []);
    expect(withRig.partIds).toEqual(['rig-loose']); // redundant now: the sheet already mines
  });
});

describe('the run ends with a reason and the jobs counted', () => {
  it('reports scavenges it ran, mining it could not, and the missions budget end', () => {
    const result = playRun({ snapshot: fixtureSnapshot(), seed: 7, missions: 12 });
    expect(result.stalled).toBe(false);
    expect(result.endReason).toBe('missions');
    expect(result.totalMissions).toBe(12);
    expect(result.scavengesDone).toBeGreaterThanOrEqual(1);
    // The bare fixture has no MINING template, so the mining policy never fires.
    expect(result.miningDone).toBe(0);
    const net = Object.values(result.ledgerTotals).reduce((sum, value) => sum + value, 0);
    expect(result.finalWallet - result.startWallet).toBe(net);
  });
});
