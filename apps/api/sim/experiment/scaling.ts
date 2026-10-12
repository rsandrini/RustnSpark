/**
 * The bridge-level scaling what-if (plan Phase 5.2). The game does not scale payouts by bridge
 * rarity yet; the sim models it as an optional table of five numbers per axis (common..legendary).
 * All ones is today's game. The hook multiplies the accept-time reward and the numeric
 * requirements (cargo, firepower, mobility) by the entry for the ship's current bridge rarity.
 */
import type { CatalogRow } from '../snapshot/types.js';
import { rarityLevelOf, type PlayerState } from '../core/state.js';
import type { Offer } from '../core/world.js';

export interface BridgeScaling {
  readonly reward: readonly number[];
  readonly cargo: readonly number[];
  readonly firepower: readonly number[];
  readonly mobility: readonly number[];
}

/** Today's game: every axis untouched. */
export const NO_SCALING: BridgeScaling = {
  reward: [1, 1, 1, 1, 1],
  cargo: [1, 1, 1, 1, 1],
  firepower: [1, 1, 1, 1, 1],
  mobility: [1, 1, 1, 1, 1],
};

function axis(raw: unknown, name: string): readonly number[] {
  if (!Array.isArray(raw) || raw.length !== 5 || raw.some((n) => typeof n !== 'number')) {
    throw new Error(`bridgeScaling.${name} must be five numbers`);
  }
  return raw as number[];
}

/** Parses the edit file's `bridgeScaling` block, or NO_SCALING when absent. */
export function parseScaling(raw: unknown): BridgeScaling {
  if (raw === undefined || raw === null) return NO_SCALING;
  if (typeof raw !== 'object') throw new Error('bridgeScaling must be an object');
  const record = raw as Record<string, unknown>;
  return {
    reward: axis(record['reward'], 'reward'),
    cargo: axis(record['cargo'], 'cargo'),
    firepower: axis(record['firepower'], 'firepower'),
    mobility: axis(record['mobility'], 'mobility'),
  };
}

/** Which of the five table entries applies to this ship (no bridge part → the common entry). */
export function bridgeRarityIndex(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): number {
  const bridge = state.ship.parts.find(
    (part) => catalogByType.get(part.partType)?.partClass === 'BRIDGE',
  );
  if (bridge === undefined) return 0;
  // rarityLevelOf is 1..5; the table is 0..4 (common..legendary).
  return Math.max(0, rarityLevelOf(catalogByType.get(bridge.partType)?.rarity ?? 'COMMON') - 1);
}

function scaledAxis(table: readonly number[], index: number): number {
  return table[index] ?? table[0] ?? 1;
}

export function rewardMultiplier(scaling: BridgeScaling, index: number): number {
  return scaledAxis(scaling.reward, index);
}

/**
 * The offer as this bridge sees it: numeric requirements multiplied by the table. Non-numeric
 * requirements pass through untouched — the hook only scales the three numeric axes.
 */
export function scaleOffer(
  offer: Offer,
  scaling: BridgeScaling,
  index: number,
): Offer {
  if (scaling === NO_SCALING) return offer;
  const requirements = { ...(offer.requirements as Record<string, unknown>) };
  const cargo = requirements['cargo'];
  if (typeof cargo === 'number') {
    requirements['cargo'] = Math.round(cargo * scaledAxis(scaling.cargo, index));
  }
  const firepower = requirements['firepower'];
  if (typeof firepower === 'number') {
    requirements['firepower'] = Math.round(firepower * scaledAxis(scaling.firepower, index));
  }
  const mobility = requirements['mobility'];
  if (typeof mobility === 'number') {
    requirements['mobility'] = Math.round(mobility * scaledAxis(scaling.mobility, index));
  }
  return { ...offer, requirements: requirements as Offer['requirements'] };
}
