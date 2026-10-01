import type { LocalizedText } from '../../api/generated';

/** The minimal shape of an installed part this matcher needs — satisfied directly by
    `InventoryItem` (both Port's and My Ship's inventory query already return this shape). */
export interface InstalledPartForCompare {
  id: string;
  displayName: LocalizedText;
  catalog: { partClass: string; w: number; h: number };
}

/**
 * Every installed part a market candidate could replace, for the owner's "add it, or replace
 * one of these" picker — same class as the candidate, same-footprint matches (the candidate
 * could actually occupy that slot) ranked first. Empty when nothing of the candidate's class is
 * installed — the comparison is then only ever a pure addition, nothing to pick between.
 */
export function rankReplaceCandidates(
  installed: readonly InstalledPartForCompare[],
  candidate: { catalog: { partClass: string; w: number; h: number } },
): InstalledPartForCompare[] {
  const sameClass = installed.filter((part) => part.catalog.partClass === candidate.catalog.partClass);
  const sameFootprint = sameClass.filter(
    (part) => part.catalog.w === candidate.catalog.w && part.catalog.h === candidate.catalog.h,
  );
  const rest = sameClass.filter((part) => !sameFootprint.includes(part));
  return [...sameFootprint, ...rest];
}

/**
 * The single best installed part a market candidate would replace — `rankReplaceCandidates`'s
 * first result, for a caller that just wants today's one default guess (e.g. the lightweight
 * hover card, which has no picker of its own). Returns undefined when nothing of the
 * candidate's class is installed — the comparison is then a pure addition instead of a swap.
 */
export function findReplaceCandidate(
  installed: readonly InstalledPartForCompare[],
  candidate: { catalog: { partClass: string; w: number; h: number } },
): InstalledPartForCompare | undefined {
  return rankReplaceCandidates(installed, candidate)[0];
}
