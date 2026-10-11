// What makes a board worth reading: the offers differ. A new offer is judged against the live
// ones at its location by two rules, loosened step by step only when the world is too small to
// satisfy them (so a board is never left short):
//   1. no two offers of the same type for the same destination (mining: the same material too);
//   2. no more than `missions.board_max_same_type` offers of one type.

export interface OfferShape {
  readonly type: string;
  readonly destinationId: string;
  readonly cargo?: unknown;
}

/** How strictly a draft is judged: both rules, only the "same type and destination" rule, or not at all. */
export const STRICT = 0;
export const SAME_JOB_ONLY = 1;
export const ANYTHING_GOES = 2;
export type Strictness = typeof STRICT | typeof SAME_JOB_ONLY | typeof ANYTHING_GOES;

function materialOf(offer: OfferShape): string {
  const cargo = offer.cargo;
  if (typeof cargo === 'object' && cargo !== null && 'materialId' in cargo) {
    return String(cargo.materialId);
  }
  return '';
}

/** Two offers are the same job: same type, same destination, and (mining) the same material. */
export function offerKey(offer: OfferShape): string {
  return offer.type === 'MINING'
    ? `${offer.type}>${offer.destinationId}>${materialOf(offer)}`
    : `${offer.type}>${offer.destinationId}`;
}

export function isVariedEnough(
  draft: OfferShape,
  live: readonly OfferShape[],
  maxSameType: number,
  strictness: Strictness,
): boolean {
  if (strictness === ANYTHING_GOES) return true;
  const key = offerKey(draft);
  if (live.some((offer) => offerKey(offer) === key)) return false;
  if (strictness === SAME_JOB_ONLY) return true;
  return live.filter((offer) => offer.type === draft.type).length < maxSameType;
}
