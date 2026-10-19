import type { LocalizedText, PartUpgradeQuoteResponse } from '../../api/generated';

/** One thing an upgrade asks for, against what the pilot holds: the credits, or a material. */
export interface UpgradeNeed {
  id: string;
  kind: 'credits' | 'material';
  /** The material's name (credits have none). */
  name?: LocalizedText;
  have: number;
  needed: number;
  /** How much more the pilot needs (0 when met). */
  missing: number;
  met: boolean;
}

/** Where a card sits: ready to pay, short of credits only, or short of materials (whatever else). */
export type UpgradeReadiness = 'ready' | 'credits' | 'materials';

/**
 * Everything one upgrade asks for, in the order it is read and fixed: the credits first, then each material.
 * All of it comes from the quote (cost, materials with `have` and `needed`) and the wallet.
 */
export function upgradeNeeds(quote: PartUpgradeQuoteResponse, wallet: number): UpgradeNeed[] {
  const cost = quote.cost ?? 0;
  const credits: UpgradeNeed = {
    id: 'credits',
    kind: 'credits',
    have: wallet,
    needed: cost,
    missing: Math.max(0, cost - wallet),
    met: wallet >= cost,
  };
  const materials = (quote.materials ?? []).map((need): UpgradeNeed => ({
    id: need.materialId,
    kind: 'material',
    name: need.displayName,
    have: need.have,
    needed: need.needed,
    missing: Math.max(0, need.needed - need.have),
    met: need.have >= need.needed,
  }));
  return [credits, ...materials];
}

export function readinessOf(needs: readonly UpgradeNeed[]): UpgradeReadiness {
  if (needs.some((need) => need.kind === 'material' && !need.met)) return 'materials';
  if (needs.some((need) => need.kind === 'credits' && !need.met)) return 'credits';
  return 'ready';
}

/** The first thing missing, in the order of the list (credits, then the materials), if anything is. */
export function firstMissing(needs: readonly UpgradeNeed[]): UpgradeNeed | undefined {
  return needs.find((need) => !need.met);
}
