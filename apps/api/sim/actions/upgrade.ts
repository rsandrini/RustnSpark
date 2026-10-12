/**
 * Upgrading a part in place to its next rarity tier, priced and gated exactly like
 * `economy/part-upgrade.service.ts`: the next tier comes from the catalog's own naming
 * convention (`nextTierPartTypeOf`), the part must sit at full condition (`NOT_FULL_CONDITION`),
 * the wallet pays `partUpgradeCost` (the price gap marked up by rarity), and the materials come
 * out through `upgradeNeeds` — scrap from the least valuable scrap first, the same order the
 * live `consume` uses. Only installed parts are upgraded here: the bot's spending rule targets
 * the slot that is flying.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { nextTierPartTypeOf, partUpgradeCost } from '../../src/economy/part-upgrade.calculator.js';
import { upgradeNeeds, type MaterialNeed } from '../../src/economy/upgrade-materials.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { FULL_CONDITION } from '../core/fleet.js';
import type { PlayerState } from '../core/state.js';

const SCRAP = 'scrap';
const SCRAP_PREFIX = 'scrap_';

export type UpgradeFailReason =
  | 'PART_NOT_FOUND'
  | 'NOT_INSTALLED'
  | 'MAX_TIER'
  | 'NO_NEXT_TIER'
  | 'NOT_FULL_CONDITION';

export interface UpgradeQuote {
  readonly ok: boolean;
  readonly reason?: UpgradeFailReason;
  readonly partId?: string;
  readonly partType?: string;
  readonly nextPartType?: string;
  readonly cost?: number;
  /** What the upgrade also asks for besides money (`upgradeNeeds`, by current rarity). */
  readonly needs?: readonly MaterialNeed[];
}

function planUpgrade(
  state: PlayerState,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  partId: string,
): UpgradeQuote {
  const part = state.ship.parts.find((candidate) => candidate.id === partId);
  if (part === undefined) {
    const loose = state.storage.some((candidate) => candidate.id === partId);
    return { ok: false, reason: loose ? 'NOT_INSTALLED' : 'PART_NOT_FOUND' };
  }
  const row = catalogByType.get(part.partType);
  if (row === undefined) return { ok: false, reason: 'NO_NEXT_TIER' };
  const nextPartType = nextTierPartTypeOf(part.partType, row.rarity);
  if (nextPartType === null) return { ok: false, reason: 'MAX_TIER' };
  const nextRow = catalogByType.get(nextPartType);
  if (nextRow === undefined || !nextRow.active) return { ok: false, reason: 'NO_NEXT_TIER' };
  // An upgrade is rarity and stats, never a different footprint: a part that grows would no
  // longer fit where it sits.
  if (nextRow.w !== row.w || nextRow.h !== row.h) return { ok: false, reason: 'NO_NEXT_TIER' };
  // An upgrade changes what the part IS, not its wear — a damaged one is repaired first.
  if (part.condition < FULL_CONDITION) return { ok: false, reason: 'NOT_FULL_CONDITION' };
  const multiplier = rules.economy.part_upgrade_price_multiplier[row.rarity] ?? 1;
  const gap = nextRow.basePrice - row.basePrice;
  const cost = partUpgradeCost(row.basePrice, nextRow.basePrice, multiplier);
  const needs = upgradeNeeds(row.rarity, gap, row.w * row.h, rules);
  return { ok: true, partId, partType: part.partType, nextPartType, cost, needs };
}

/** What the upgrade would cost right now, without touching anything. */
export function upgradeQuote(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  partId: string,
): UpgradeQuote {
  return planUpgrade(state, rules, catalogByType, partId);
}

/** What the pilot holds of each need (`scrap` sums every `scrap_` material). */
export function heldForNeed(state: PlayerState, need: MaterialNeed): number {
  if (need.material === SCRAP) {
    let total = 0;
    for (const [materialId, quantity] of state.materials) {
      if (materialId.startsWith(SCRAP_PREFIX)) total += quantity;
    }
    return total;
  }
  return state.materials.get(need.material) ?? 0;
}

/**
 * How much of each material *id* must stay home to cover `needs` — scrap is allocated to the
 * cheapest `scrap_` ids first, the same order `consume` will take it, so the sell pass never
 * sells a unit the next upgrade is counting on.
 */
export function retentionFor(
  state: PlayerState,
  snapshot: Snapshot,
  needs: readonly MaterialNeed[],
): Map<string, number> {
  const keep = new Map<string, number>();
  for (const need of needs) {
    if (need.material === SCRAP) {
      let left = need.quantity;
      for (const row of scrapRowsOf(snapshot)) {
        if (left <= 0) break;
        const held = state.materials.get(row.id) ?? 0;
        const keepHere = Math.min(held, left);
        if (keepHere > 0) keep.set(row.id, keepHere);
        left -= keepHere;
      }
    } else {
      const held = state.materials.get(need.material) ?? 0;
      keep.set(need.material, Math.min(held, need.quantity));
    }
  }
  return keep;
}

function scrapRowsOf(snapshot: Snapshot): { id: string; basePrice: number }[] {
  return snapshot.materials
    .filter((row) => row.id.startsWith(SCRAP_PREFIX))
    .map((row) => ({ id: row.id, basePrice: row.basePrice }))
    .sort((left, right) =>
      left.basePrice !== right.basePrice
        ? left.basePrice - right.basePrice
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0,
    );
}

/** Take the needed units out of the pilot's goods: scrap from the least valuable scrap first. */
function consumeNeeds(
  state: PlayerState,
  snapshot: Snapshot,
  needs: readonly MaterialNeed[],
): boolean {
  for (const need of needs) {
    let left = need.quantity;
    if (need.material === SCRAP) {
      for (const row of scrapRowsOf(snapshot)) {
        if (left <= 0) break;
        const held = state.materials.get(row.id) ?? 0;
        const take = Math.min(left, held);
        if (take <= 0) continue;
        const after = held - take;
        if (after <= 0) state.materials.delete(row.id);
        else state.materials.set(row.id, after);
        left -= take;
      }
    } else {
      const held = state.materials.get(need.material) ?? 0;
      const take = Math.min(left, held);
      state.materials.set(need.material, held - take);
      left -= take;
    }
    if (left > 0) return false;
  }
  return true;
}

export type UpgradeOutcome =
  | { readonly ok: true; readonly partId: string; readonly partType: string; readonly cost: number }
  | {
      readonly ok: false;
      readonly reason: UpgradeFailReason | 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_MATERIALS';
      readonly cost?: number;
      readonly needs?: readonly MaterialNeed[];
    };

/**
 * Upgrade the installed part `partId` in place: plan first (a refusal changes nothing), then
 * charge the wallet, take the materials and swap the part to its next tier — same order the
 * live service's transaction runs in.
 */
export function upgrade(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  partId: string,
): UpgradeOutcome {
  const quote = planUpgrade(state, rules, catalogByType, partId);
  if (!quote.ok) return { ok: false, reason: quote.reason ?? 'NO_NEXT_TIER' };
  const cost = quote.cost ?? 0;
  const needs = quote.needs ?? [];
  if (cost > state.wallet) {
    return { ok: false, reason: 'INSUFFICIENT_FUNDS', cost, needs };
  }
  if (needs.some((need) => heldForNeed(state, need) < need.quantity)) {
    return { ok: false, reason: 'INSUFFICIENT_MATERIALS', cost, needs };
  }
  if (!consumeNeeds(state, snapshot, needs)) {
    return { ok: false, reason: 'INSUFFICIENT_MATERIALS', cost, needs };
  }
  state.wallet -= cost;
  state.ledger.record('upgrade', -cost);
  const part = state.ship.parts.find((candidate) => candidate.id === partId);
  if (part === undefined) return { ok: false, reason: 'PART_NOT_FOUND' };
  part.partType = quote.nextPartType ?? part.partType;
  // Condition carries: the part was at FULL_CONDITION and stays there.
  return { ok: true, partId, partType: part.partType, cost };
}
