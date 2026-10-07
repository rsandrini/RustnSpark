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

const SIDE_ORDER: readonly ConnectorSide[] = ['N', 'E', 'S', 'W'];
const QUARTERS_PER_TURN = 4;
const HALF_TURN_QUARTERS = 2;

export const RIGHT_ANGLE = 90;

/** Every legal placement rotation: clockwise quarter turns (0, 90, 180, 270). */
export const ROTATIONS: readonly number[] = Array.from(
  { length: QUARTERS_PER_TURN },
  (_, quarter) => quarter * RIGHT_ANGLE,
);

function quarterTurns(rot: number): number {
  return Math.round(rot / RIGHT_ANGLE);
}

/** The world-facing side an unrotated-AUTHORED side ends up on after `rot` degrees clockwise
    (any multiple of 90 — placements are 0|90 today, 4-way once part-direction rules land). The
    catalog/instance data is always stored unrotated; this applies the transform where
    placements are evaluated. Pinned by packages/contract/fixtures/connector-vectors.json,
    which the web mirror (hangar/connectors.ts) also tests against. */
export function rotateSide(side: ConnectorSide, rot: number): ConnectorSide {
  const index = SIDE_ORDER.indexOf(side) + quarterTurns(rot);
  return SIDE_ORDER[((index % QUARTERS_PER_TURN) + QUARTERS_PER_TURN) % QUARTERS_PER_TURN]!;
}

/** Inverse of `rotateSide`: the authored side that faces `side` in the world at `rot`. */
export function authoredSideAt(side: ConnectorSide, rot: number): ConnectorSide {
  return rotateSide(side, -rot);
}

/** Which authored cell of a w x h part occupies world-footprint offset (wx, wy) once placed at
    `rot` (clockwise). Rotation moves cells, not just sides: authored (dx, dy) of a w x h part
    lands at (h-1-dy, dx) after one quarter turn, so a lookup into the authored layout must
    undo that — indexing it with the rotated footprint's offsets directly is wrong for any
    non-square part. */
export function worldToAuthoredCell(
  wx: number,
  wy: number,
  w: number,
  h: number,
  rot: number,
): { dx: number; dy: number } {
  const turns = ((quarterTurns(rot) % QUARTERS_PER_TURN) + QUARTERS_PER_TURN) % QUARTERS_PER_TURN;
  // world footprint dims after `turns` quarter turns of a w x h part
  const swapped = turns % HALF_TURN_QUARTERS !== 0;
  let width = swapped ? h : w;
  let height = swapped ? w : h;
  let x = wx;
  let y = wy;
  for (let turn = 0; turn < turns; turn += 1) {
    [x, y, width, height] = [y, width - 1 - x, height, width];
  }
  return { dx: x, dy: y };
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
