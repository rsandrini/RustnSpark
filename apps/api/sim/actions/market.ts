/**
 * Trading at the port, priced exactly like `economy/market.service.ts` and `pricing.service.ts`:
 * a buy is `buyPrice` on the pristine catalog row (condition 100), a sale is `sellPrice` on the
 * part's own condition, and materials follow the same `sellMaterial` rule (scrap sells for its
 * fixed price everywhere; ores take place, faction and mood, capped at 1). The wallet always
 * moves through the ledger, so the run's cash stays reconciled.
 *
 * **Phase 3 v1 assumption (per plan task 2): there is no stock.** The live market rolls
 * `market_rarity_chance` once per port per day and refuses what never hit the shelf (LEGENDARY
 * is a 0 chance); the sim lets the bot buy any active catalog row at the normal price, so rare
 * tiers are directly buyable here — a deliberate simplification to be reported, not modeled.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { buyPrice, sellPrice, type PartPriceInput } from '../../src/economy/price.calculator.js';
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
}

/** Buy `partType` at `locationId` into the hold. The ship must be in that port (S7.7 lock). */
export function buyPart(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  partType: string,
  locationId: string,
): BuyOutcome {
  if (state.locationId !== locationId) {
    return { ok: false, reason: 'SHIP_NOT_AT_LOCATION' };
  }
  const row = catalogByType.get(partType);
  if (row === undefined || !row.active) return { ok: false, reason: 'LISTING_NOT_FOUND' };
  // Catalog listings are always pristine (market.service builds them at condition 100).
  const price = buyPrice(priceInputAt(snapshot, state.factionId, locationId, row.basePrice, 100), rules);
  if (price > state.wallet) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
  state.wallet -= price;
  state.ledger.record('purchase', -price);
  state.partSeq += 1;
  const partId = `bought-${state.partSeq}`;
  state.storage.push({ id: partId, partType, condition: 100 });
  return { ok: true, price, partId };
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
