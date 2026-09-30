import type { LocalizedText } from '../../api/generated';

/** The minimal shape of an installed part this matcher needs — satisfied directly by
    `InventoryItem` (both Port's and My Ship's inventory query already return this shape). */
export interface InstalledPartForCompare {
  id: string;
  displayName: LocalizedText;
  catalog: { partClass: string; w: number; h: number };
}

/**
 * Which installed part (if any) a market candidate would replace, for the "if you swap this
 * in" comparison. Same class is required; among same-class parts, one with the identical
 * footprint (the candidate could actually occupy its slot) is preferred over an arbitrary one.
 * Returns undefined when nothing of the candidate's class is installed — the comparison is
 * then a pure addition instead of a swap.
 */
export function findReplaceCandidate(
  installed: readonly InstalledPartForCompare[],
  candidate: { catalog: { partClass: string; w: number; h: number } },
): InstalledPartForCompare | undefined {
  const sameClass = installed.filter((part) => part.catalog.partClass === candidate.catalog.partClass);
  if (sameClass.length === 0) return undefined;
  const sameFootprint = sameClass.find(
    (part) => part.catalog.w === candidate.catalog.w && part.catalog.h === candidate.catalog.h,
  );
  return sameFootprint ?? sameClass[0];
}
