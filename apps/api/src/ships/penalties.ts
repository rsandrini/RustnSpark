import type { GameRules } from '../config/game-config.types.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import type { InstalledPart, LayoutError, PartCatalog, Placement } from '../parts/part.types.js';
import { directionErrors } from './direction.js';
import { deriveSheet } from './sheet.deriver.js';
import type { ShipSheet } from './sheet.types.js';

// What a flight warning costs. A ship with warnings flies, but the parts that cannot do their job
// do not pull their weight: the penalties are applied to the parts the flight is resolved from, so
// travel time, combat and everything downstream see the weaker ship.
//
//  - EXHAUST_BLOCKED: a blocked engine gives no thrust.
//  - FACING_BLOCKED / FACING_CONNECTOR: a blocked weapon does not fire.
//  - A power deficit no longer slows the engines: engines run at full thrust and the systems that
//    draw power fight for what there is (resolution/power/power.ts).
//  - Battery shortfalls are not applied here: combat already runs on an energy budget and skips
//    the attacks and shield regeneration it cannot pay for.

export type PenaltyCode = 'EXHAUST_BLOCKED' | 'FACING_BLOCKED' | 'FACING_CONNECTOR';

export interface AppliedPenalty {
  readonly code: PenaltyCode;
  /** Parts that lost output (blocked engines/weapons); empty for the ship-wide energy penalty. */
  readonly partInstanceIds: readonly string[];
  /** The share of output kept (0 for a blocked part, generated/consumed for the energy penalty). */
  readonly kept: number;
}

export function applyPenalties(
  parts: readonly InstalledPart[],
  directionProblems: readonly LayoutError[],
  rules: GameRules,
): { parts: InstalledPart[]; penalties: AppliedPenalty[] } {
  const penalties: AppliedPenalty[] = [];
  const zeroed = new Map<string, 'pot' | 'pdf'>();
  for (const problem of directionProblems) {
    if (problem.partInstanceId === undefined) continue;
    if (problem.code === 'EXHAUST_BLOCKED') zeroed.set(problem.partInstanceId, 'pot');
    else if (problem.code === 'FACING_BLOCKED' || problem.code === 'FACING_CONNECTOR') {
      zeroed.set(problem.partInstanceId, 'pdf');
    }
  }
  for (const code of ['EXHAUST_BLOCKED', 'FACING_BLOCKED', 'FACING_CONNECTOR'] as const) {
    const ids = directionProblems.flatMap((p) => (p.code === code && p.partInstanceId !== undefined ? [p.partInstanceId] : []));
    if (ids.length > 0) penalties.push({ code, partInstanceIds: ids, kept: 0 });
  }

  if (penalties.length === 0) return { parts: [...parts], penalties };
  const adjusted = parts.map((part) => {
    const stat = zeroed.get(part.instance.id);
    if (stat === undefined) return part;
    const catalog = { ...part.catalog };
    catalog[stat] = 0;
    return { ...part, catalog };
  });
  return { parts: adjusted, penalties };
}

/** The ship as it actually flies: the connected parts with the warnings' penalties applied, the sheet
    derived from them, and what was applied (for the report). */
export function flightShip(
  connected: readonly InstalledPart[],
  placements: readonly Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
  rules: GameRules,
): { parts: InstalledPart[]; sheet: ShipSheet; penalties: AppliedPenalty[] } {
  const direction = directionErrors(placements, catalog, connectorsByInstance);
  const { parts, penalties } = applyPenalties(connected, direction, rules);
  return { parts, sheet: deriveSheet(parts, rules), penalties };
}
