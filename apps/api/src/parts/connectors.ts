import { randomUUID } from 'node:crypto';
import { generateConnectors } from './connector-rules.js';

export type ConnectorKind = 'none' | 'central' | 'split' | 'universal';
export type ConnectorSide = 'N' | 'E' | 'S' | 'W';

export interface ConnectorCell {
  readonly dx: number;
  readonly dy: number;
  readonly side: ConnectorSide;
  readonly kind: ConnectorKind;
}

export interface ConnectorLayout {
  readonly cells: readonly ConnectorCell[];
}

const ROTATE_CW: Record<ConnectorSide, ConnectorSide> = { N: 'E', E: 'S', S: 'W', W: 'N' };

export const RIGHT_ANGLE = 90;

/** A placement's `rot` (0 or 90) rotates connector sides the same way it already rotates
    width/height in canPlace/validateLayout — the catalog/instance data is always stored
    unrotated; this applies the transform where placements are evaluated. */
export function rotateSide(side: ConnectorSide, rot: number): ConnectorSide {
  return rot === RIGHT_ANGLE ? ROTATE_CW[side] : side;
}

/** central<->central, split<->split, universal<->anything-but-none. central and split never
    match each other. none never matches anything, including another none. */
export function compatible(a: ConnectorKind, b: ConnectorKind): boolean {
  if (a === 'none' || b === 'none') return false;
  if (a === 'universal' || b === 'universal') return true;
  return a === b;
}

/** The connector kind at one cell's one side — 'universal' everywhere when `layout` is null
    (the fallback: every part type with no admin-authored candidates, and every instance
    created before this feature shipped), 'none' for any (cell, side) a non-null layout simply
    doesn't list. */
export function sideKindAt(
  layout: ConnectorLayout | null,
  dx: number,
  dy: number,
  side: ConnectorSide,
): ConnectorKind {
  if (layout === null) return 'universal';
  const match = layout.cells.find((cell) => cell.dx === dx && cell.dy === dy && cell.side === side);
  return match?.kind ?? 'none';
}

/** Generates a part's concrete connector layout from its catalog row's admin-defined rules
    (connector-rules.ts), called once at instance-creation time — never re-rolled. Returns null
    (the universal fallback) when the part type has no rules configured, which is also exactly
    what an instance created before this feature existed already has. `seed` defaults to a fresh
    UUID (kits, scavenge finds); the market passes a listing-derived seed so the layout shown
    before buying is the one the buyer gets. */
export function rollConnectors(
  row: { connectorRules: unknown; w: number; h: number },
  seed: string = randomUUID(),
): ConnectorLayout | null {
  return generateConnectors(row.connectorRules, row.w, row.h, seed);
}
