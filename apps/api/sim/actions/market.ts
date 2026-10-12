/**
 * Trading at the port, exactly like `economy/market.service.ts`: the shelf IS the day's roll.
 * Every active catalog row passes `inStockToday` against the pilot's shelf chance — the
 * installed bridge's `market_rarity_by_bridge` table, so a common bridge mostly sees common
 * parts and LEGENDARY never shows — plus the six used slots `usedOffer` draws from that same
 * in-stock pool. Every listing is one physical item per port per day: the first buyer takes it
 * until the day rolls (`soldListings` mirrors live's buy-event window, keyed off the snapshot
 * date plus simulated elapsed time as the UTC day). Prices go through the same `buyPrice`/
 * `sellPrice` calculators `PricingService` calls, materials follow the sellMaterial rule, and
 * the wallet always moves through the ledger, so the run's cash stays reconciled.
 *
 * The policy reads `marketShelf` for ports it is not docked at — the same way it already
 * compares fuel prices across the map — but `buyListing` re-derives everything at the moment
 * of purchase, docked, exactly as live `buy()` does: a listing can vanish between plan and
 * purchase (the day rolled, another buy took it, the bridge changed the pool).
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { buyPrice, sellPrice, type PartPriceInput } from '../../src/economy/price.calculator.js';
import { inStockToday } from '../../src/economy/market-stock.js';
import {
  catalogListingId,
  dayKey,
  parseListingId,
  USED_OFFER_COUNT,
  usedListingId,
  usedOffer,
} from '../../src/economy/used-offers.js';
import { allocatePower, powerPartOf } from '../../src/resolution/power/power.js';
import { checkViability } from '../../src/ships/viability.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { installedParts, type PlayerState, type ShipPartState } from '../core/state.js';
import { portFactsOf } from '../core/world.js';

/** The pricing context `PricingService.priceInput` builds, over snapshot rows. */
export function priceInputAt(
  snapshot: Snapshot,
  factionId: string,
  locationId: string,
  basePrice: number,
  condition: number,
): PartPriceInput {
  const facts = portFactsOf(snapshot, locationId, factionId);
  return {
    basePrice,
    isolation: facts.isolation,
    factionRelation: facts.factionRelation,
    mood: facts.mood,
    condition,
  };
}

export interface BuyOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly price?: number;
  readonly partId?: string;
  readonly condition?: number;
}

/** One listing on today's shelf at `locationId` — catalog (new) or one of the six used slots. */
export interface ShelfListing {
  readonly listingId: string;
  readonly kind: 'catalog' | 'used';
  readonly partType: string;
  readonly condition: number;
  readonly price: number;
}

/** The shelf's UTC day: the snapshot's date plus the run's elapsed seconds (restock at midnight). */
export function shelfDayAt(state: PlayerState, snapshot: Snapshot): string {
  return dayKey(new Date(Date.parse(snapshot.takenAt) + state.clock.now() * 1000));
}

/** Live `MarketService.shelfChance`: the installed bridge's rarity table, else the fallback. */
function shelfChanceOf(
  state: PlayerState,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): Readonly<Record<string, number>> {
  for (const part of state.ship.parts) {
    const row = catalogByType.get(part.partType);
    if (row === undefined) continue;
    if (row.partClass === 'BRIDGE') {
      return rules.economy.market_rarity_by_bridge[row.rarity] ?? rules.economy.market_rarity_chance;
    }
  }
  return rules.economy.market_rarity_chance;
}

/** Today's in-stock pool at a port: active rows in partType order (the used shelf's index base). */
function inStockPool(
  snapshot: Snapshot,
  locationId: string,
  day: string,
  chance: Readonly<Record<string, number>>,
): CatalogRow[] {
  return snapshot.catalog
    .filter((row) => row.active)
    .sort((left, right) =>
      left.partType < right.partType ? -1 : left.partType > right.partType ? 1 : 0,
    )
    .filter((row) => inStockToday(locationId, day, row.partType, row.rarity, chance));
}

/** A new shelf day clears the sold set — live only counts buy events since the day started. */
function rollSoldDay(state: PlayerState, day: string): void {
  if (state.soldDay !== day) {
    state.soldListings.clear();
    state.soldDay = day;
  }
}

/**
 * Today's shelf at a port: every in-stock catalog row at condition 100 plus the six used slots,
 * minus what has already sold today. Pure for any location — the policy compares ports the way
 * it already compares fuel prices — while `buyListing` re-derives it all at the dock.
 */
export function marketShelf(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  locationId: string,
): ShelfListing[] {
  const day = shelfDayAt(state, snapshot);
  rollSoldDay(state, day);
  const pool = inStockPool(snapshot, locationId, day, shelfChanceOf(state, rules, catalogByType));
  const listings: ShelfListing[] = pool.map((row) => ({
    listingId: catalogListingId(locationId, row.partType),
    kind: 'catalog' as const,
    partType: row.partType,
    condition: 100,
    price: buyPrice(priceInputAt(snapshot, state.factionId, locationId, row.basePrice, 100), rules),
  }));
  for (let index = 0; index < USED_OFFER_COUNT; index += 1) {
    const offer = usedOffer(locationId, day, index, pool);
    if (offer.part === undefined) continue;
    listings.push({
      listingId: usedListingId(locationId, day, index, offer.part.partType),
      kind: 'used',
      partType: offer.part.partType,
      condition: offer.condition,
      price: buyPrice(
        priceInputAt(snapshot, state.factionId, locationId, offer.part.basePrice, offer.condition),
        rules,
      ),
    });
  }
  return listings.filter((listing) => !state.soldListings.has(listing.listingId));
}

/**
 * Buy the listing into the hold: re-derive the day's roll (never trust a planned listing),
 * refuse the off-shelf and the already-sold, charge `buyPrice` at this port's context, and mark
 * the listing sold for the rest of the day. The ship must be docked at the listing's port (the
 * S7.7 trade lock), exactly like live `buy()`.
 */
export function buyListing(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  listingId: string,
): BuyOutcome {
  const parsed = parseListingId(listingId);
  if (parsed === null) return { ok: false, reason: 'INVALID_LISTING' };
  if (parsed.locationId !== state.locationId) {
    return { ok: false, reason: 'SHIP_NOT_AT_LOCATION' };
  }
  const day = shelfDayAt(state, snapshot);
  rollSoldDay(state, day);
  // A used listing carries the day it was minted on: yesterday's board is stale (live rejects
  // it the same way), and a day rollover between listing and purchase means re-open the board.
  if (parsed.kind === 'used' && parsed.day !== day) {
    return { ok: false, reason: 'INVALID_LISTING' };
  }
  const pool = inStockPool(snapshot, parsed.locationId, day, shelfChanceOf(state, rules, catalogByType));
  let row: CatalogRow;
  let condition = 100;
  if (parsed.kind === 'catalog') {
    const found = pool.find((candidate) => candidate.partType === parsed.partType);
    if (found === undefined) return { ok: false, reason: 'NOT_ON_SHELF' };
    row = found;
  } else {
    // Re-derive the slot from the same pool and roll: the bridge (and with it the pool) may
    // have changed since the board was read — then this index never held this part today.
    const offer = usedOffer(parsed.locationId, day, parsed.index!, pool);
    if (offer.part === undefined || offer.part.partType !== parsed.partType) {
      return { ok: false, reason: 'NOT_ON_SHELF' };
    }
    row = offer.part;
    condition = offer.condition;
  }
  if (state.soldListings.has(listingId)) return { ok: false, reason: 'LISTING_SOLD' };
  const price = buyPrice(
    priceInputAt(snapshot, state.factionId, parsed.locationId, row.basePrice, condition),
    rules,
  );
  if (price > state.wallet) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
  state.wallet -= price;
  state.ledger.record('purchase', -price);
  state.partSeq += 1;
  const partId = `bought-${state.partSeq}`;
  state.storage.push({ id: partId, partType: row.partType, condition });
  state.soldListings.add(listingId);
  return { ok: true, price, partId, condition };
}

export interface SellOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly price?: number;
  readonly credits?: number;
}

/**
 * Sell one loose part from the hold at the current port. Too damaged to sell
 * (`sell_min_condition`) gets no price, exactly like the live board shows no offer for it.
 * Installed parts are left alone: the ship never strips itself to raise cash.
 */
export function sellPart(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  partId: string,
): SellOutcome {
  const index = state.storage.findIndex((part) => part.id === partId);
  if (index === -1) return { ok: false, reason: 'PART_NOT_FOUND' };
  const part = state.storage[index];
  if (part === undefined) return { ok: false, reason: 'PART_NOT_FOUND' };
  const row = snapshot.catalog.find((candidate) => candidate.partType === part.partType);
  if (row === undefined) return { ok: false, reason: 'LISTING_NOT_FOUND' };
  if (part.condition < rules.economy.sell_min_condition) {
    return { ok: false, reason: 'TOO_DAMAGED_TO_SELL' };
  }
  const price = sellPrice(
    priceInputAt(snapshot, state.factionId, state.locationId, row.basePrice, part.condition),
    rules,
  );
  state.storage.splice(index, 1);
  state.wallet += price;
  // Scavenge finds carry their own ledger line, so the report can see what the holds paid out.
  state.ledger.record(part.source === 'scavenge' ? 'scavengeSale' : 'sale', price);
  return { ok: true, price, credits: state.wallet };
}

export interface MaterialSellOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly units?: number;
  readonly credits?: number;
}

/** Sell `quantity` units of `materialId` at the current port (ores and scrap, `pricing.service`). */
export function sellMaterial(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  materialId: string,
  quantity: number,
): MaterialSellOutcome {
  const row = snapshot.materials.find((material) => material.id === materialId);
  if (row === undefined) return { ok: false, reason: 'MATERIAL_NOT_FOUND' };
  const held = state.materials.get(materialId) ?? 0;
  const units = Math.min(held, Math.max(0, quantity));
  if (units <= 0) return { ok: false, reason: 'NONE_HELD' };
  // Scrap sells for exactly its price everywhere; ores take place, faction and mood at full
  // condition (materials have no wear) — `PricingService.sellMaterial`.
  const unit = row.fixedPrice
    ? Math.max(1, row.basePrice)
    : sellPrice(priceInputAt(snapshot, state.factionId, state.locationId, row.basePrice, 100), rules);
  const credits = unit * units;
  const left = held - units;
  if (left <= 0) state.materials.delete(materialId);
  else state.materials.set(materialId, left);
  state.wallet += credits;
  state.ledger.record('oreSale', credits);
  return { ok: true, units, credits };
}

export interface FitOutcome {
  readonly ok: boolean;
  readonly reason?: string;
}

/** The part object a fit would place on the hull (a real hold part, or a phantom buy). */
export interface FitCandidate {
  readonly id: string;
  readonly partType: string;
  readonly condition: number;
}

function hypotheticalPartsOf(
  state: PlayerState,
  fitted: FitCandidate,
  replaceId?: string,
): ShipPartState[] {
  return state.ship.parts
    .filter((part) => part.id !== replaceId)
    .concat({ id: fitted.id, partType: fitted.partType, condition: fitted.condition });
}

/**
 * Would this fit leave the ship able to fly? The spending policy asks before it commits — the
 * bot never trades its ability to fly for a stat line. Two gates, matching what a mission then
 * demands: viability's hard problems, and the board's cruise-power check (viability only warns
 * on power, but `canTakeMission` refuses every mission and travel when it does not allocate —
 * fitting a power-hungry part would brick the run).
 */
export function fitWouldBeViable(
  state: PlayerState,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  fitted: FitCandidate,
  replaceId?: string,
): boolean {
  const hypothetical = hypotheticalPartsOf(state, fitted, replaceId);
  const installed = installedParts({ ...state.ship, parts: hypothetical }, catalogByType);
  const sheet = deriveSheet(installed, rules);
  if (!checkViability(sheet, installed, rules).viable) return false;
  const power = installed.map((part) =>
    powerPartOf(part.instance.id, part.catalog, rules.power.idle_demand),
  );
  const cruise = allocatePower(power, 'cruise', rules);
  return cruise.demand <= cruise.supply;
}

/**
 * Move a loose part from the hold onto the ship, optionally swapping it with the installed
 * `replaceId` (the displaced part drops into the hold). A fit that would leave the ship
 * non-viable is refused. No credits and no time move: equipping is a port action, like the
 * live layout update.
 */
export function fitPart(
  state: PlayerState,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  storageId: string,
  replaceId?: string,
): FitOutcome {
  const index = state.storage.findIndex((part) => part.id === storageId);
  if (index === -1) return { ok: false, reason: 'PART_NOT_FOUND' };
  const fitted = state.storage[index];
  if (fitted === undefined) return { ok: false, reason: 'PART_NOT_FOUND' };
  const displaced =
    replaceId === undefined
      ? undefined
      : state.ship.parts.find((part) => part.id === replaceId);
  if (replaceId !== undefined && displaced === undefined) {
    return { ok: false, reason: 'INSTALLED_NOT_FOUND' };
  }
  if (!fitWouldBeViable(state, rules, catalogByType, fitted, replaceId)) {
    return { ok: false, reason: 'NOT_VIABLE' };
  }
  state.storage.splice(index, 1);
  state.ship.parts = hypotheticalPartsOf(state, fitted, replaceId);
  if (displaced !== undefined) state.storage.push(displaced);
  return { ok: true };
}
