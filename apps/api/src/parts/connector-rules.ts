import { z } from 'zod';
import { createRng } from '../common/rng/rng.js';
import type { ConnectorCell, ConnectorKind, ConnectorLayout, ConnectorSide } from './connectors.js';

/**
 * Admin-defined rules for GENERATING a part's connectors (connector ports spec, rev 5). Used only
 * when a part is generated; the concrete result is stored on PartInstance.connectors and never
 * changes afterwards, whatever an admin edits later.
 *
 * One kind is rolled per side for the whole part (not per cell) and written onto every perimeter
 * cell edge on that side. Interior edges of a multi-cell part need no connector (a part's own
 * cells are always connected), so they are never written.
 */
export const SIDES: readonly ConnectorSide[] = ['N', 'E', 'S', 'W'];
const MAX_WEIGHT = 1_000_000;
const MAX_SIDES = 4;
const DEFAULT_MIN_CONNECTED = 1;
const KINDS = ['none', 'central', 'split', 'universal'] as const;

const sideKindSchema = z.enum(KINDS);
const weightedKindsSchema = z
  .array(z.object({ kind: sideKindSchema, weight: z.number().min(0).max(MAX_WEIGHT) }))
  .min(1);

export const connectorRulesSchema = z
  .object({
    sides: z.object({
      N: weightedKindsSchema,
      E: weightedKindsSchema,
      S: weightedKindsSchema,
      W: weightedKindsSchema,
    }),
    /** Every connected side of a generated part carries the SAME kind (all central, all split or
        all universal) — the "real" mix: types vary between parts, never within one. */
    oneKindPerPart: z.boolean().optional(),
    /** At least this many sides carry a port. Defaults to 1: a part with no port at all could
        never join a ship. */
    minConnected: z.number().int().min(0).max(MAX_SIDES).optional(),
    maxConnected: z.number().int().min(0).max(MAX_SIDES).optional(),
    maxSplit: z.number().int().min(0).max(MAX_SIDES).optional(),
    forbidden: z
      .array(
        z
          .object({
            N: sideKindSchema.optional(),
            E: sideKindSchema.optional(),
            S: sideKindSchema.optional(),
            W: sideKindSchema.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type ConnectorRules = z.infer<typeof connectorRulesSchema>;
export type SideCombo = Record<ConnectorSide, ConnectorKind>;

/** Tolerant parse of the stored JSON column: anything malformed counts as "no rules". */
export function parseConnectorRules(json: unknown): ConnectorRules | null {
  const parsed = connectorRulesSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Every allowed side combination with its weight (product of the per-side weights). A combo
    with zero total weight, or one breaking `maxConnected`/`maxSplit`/`forbidden`, is dropped. */
export function enumerateCombos(
  rules: ConnectorRules,
  /** Only combos whose connected sides all use these kinds (starter/restart kits: never `split`,
      so any two kit parts can always be joined). */
  allowedKinds?: readonly ConnectorKind[],
): { combo: SideCombo; weight: number }[] {
  const out: { combo: SideCombo; weight: number }[] = [];
  const merged = (side: ConnectorSide): Map<ConnectorKind, number> => {
    const map = new Map<ConnectorKind, number>();
    for (const entry of rules.sides[side]) {
      map.set(entry.kind, (map.get(entry.kind) ?? 0) + entry.weight);
    }
    return map;
  };
  const options = SIDES.map((side) => [...merged(side)].filter(([, weight]) => weight > 0));
  const pick = (index: number, chosen: ConnectorKind[], weight: number): void => {
    if (index === SIDES.length) {
      const combo = Object.fromEntries(SIDES.map((side, i) => [side, chosen[i]!])) as SideCombo;
      const kindsOk =
        allowedKinds === undefined ||
        SIDES.every((side) => combo[side] === 'none' || allowedKinds.includes(combo[side]));
      if (kindsOk && isAllowed(rules, combo)) out.push({ combo, weight });
      return;
    }
    for (const [kind, w] of options[index]!) pick(index + 1, [...chosen, kind], weight * w);
  };
  pick(0, [], 1);
  return out;
}

function isAllowed(rules: ConnectorRules, combo: SideCombo): boolean {
  const kinds = SIDES.map((side) => combo[side]);
  if (rules.oneKindPerPart === true && new Set(kinds.filter((kind) => kind !== 'none')).size > 1) {
    return false;
  }
  const connected = kinds.filter((k) => k !== 'none').length;
  if (connected < (rules.minConnected ?? DEFAULT_MIN_CONNECTED)) return false;
  if (rules.maxConnected !== undefined && connected > rules.maxConnected) return false;
  if (rules.maxSplit !== undefined && kinds.filter((k) => k === 'split').length > rules.maxSplit) {
    return false;
  }
  for (const pattern of rules.forbidden ?? []) {
    const entries = Object.entries(pattern) as [ConnectorSide, ConnectorKind][];
    if (entries.length > 0 && entries.every(([side, kind]) => combo[side] === kind)) return false;
  }
  return true;
}

/** Admin-facing validation: null when the rules can generate something, else a message. */
export function validateConnectorRules(rules: ConnectorRules, partClass?: string): string | null {
  if (enumerateCombos(rules).length === 0) {
    return 'no side combination satisfies the weights, limits and blacklist';
  }
  if (partClass === 'ENGINE' || partClass === 'WEAPON') {
    // W is the fixed facing side in v1 (shared with the part-direction rules): nothing may snap
    // onto an exhaust/muzzle, so the only kind that may ever be rolled there is `none`.
    const facing = rules.sides.W.filter((entry) => entry.weight > 0);
    if (facing.some((entry) => entry.kind !== 'none')) {
      return `${partClass} W side (facing) must be none only`;
    }
  }
  return null;
}

/** Writes one rolled combo onto a w x h footprint: every perimeter cell edge facing outward. */
export function expandCombo(combo: SideCombo, w: number, h: number): ConnectorLayout {
  const cells: ConnectorCell[] = [];
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      const onSide: Record<ConnectorSide, boolean> = {
        N: dy === 0,
        S: dy === h - 1,
        W: dx === 0,
        E: dx === w - 1,
      };
      for (const side of SIDES) {
        if (onSide[side] && combo[side] !== 'none') {
          cells.push({ dx, dy, side, kind: combo[side] });
        }
      }
    }
  }
  return { cells };
}

/** Deterministic for a given seed: the same listing always shows (and buys) the same layout.
    Returns null when no rules are configured → the universal fallback. */
export function generateConnectors(
  rulesJson: unknown,
  w: number,
  h: number,
  seed: string,
  allowedKinds?: readonly ConnectorKind[],
): ConnectorLayout | null {
  const rules = parseConnectorRules(rulesJson);
  if (rules === null) return null;
  // A restriction that leaves nothing to roll falls back to the rules as authored.
  const restricted = allowedKinds === undefined ? [] : enumerateCombos(rules, allowedKinds);
  const combos = restricted.length > 0 ? restricted : enumerateCombos(rules);
  if (combos.length === 0) return null;
  const total = combos.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = createRng(seed).float() * total;
  for (const entry of combos) {
    roll -= entry.weight;
    if (roll < 0) return expandCombo(entry.combo, w, h);
  }
  return expandCombo(combos[combos.length - 1]!.combo, w, h);
}

/** Factory default (seed): every connected side may be central, split or universal with equal
    chance, but one kind per part (`oneKindPerPart`) — so a generated part is all-central,
    all-split or all-universal, ports at the same place on every side. ENGINE/WEAPON get `none`
    on the facing side W. Admin edits the rules per part type; the seed only fills missing ones. */
export function defaultConnectorRules(partClass: string): ConnectorRules {
  const mixed = [
    { kind: 'central' as const, weight: 1 },
    { kind: 'split' as const, weight: 1 },
    { kind: 'universal' as const, weight: 1 },
  ];
  const none = [{ kind: 'none' as const, weight: 1 }];
  const directional = partClass === 'ENGINE' || partClass === 'WEAPON';
  return {
    sides: { N: mixed, E: mixed, S: mixed, W: directional ? none : mixed },
    oneKindPerPart: true,
  };
}

export interface ConnectorRulesPreview {
  /** null when the rules are valid; otherwise why nothing can be generated. */
  problem: string | null;
  /** Every combination the generator can roll, with its chance (sums to 1). */
  combos: { sides: SideCombo; probability: number }[];
  /** A few real generations, drawn the same way a part is generated. */
  samples: ConnectorLayout[];
}

/** What the admin editor shows live: the exact distribution and sample rolls for a rules payload,
    computed by the same enumeration/generation the server uses so the two can never disagree. */
export function previewConnectorRules(
  rulesJson: unknown,
  w: number,
  h: number,
  partClass: string,
  samples: number,
  seedBase: string,
): ConnectorRulesPreview {
  const rules = parseConnectorRules(rulesJson);
  if (rules === null) {
    return { problem: 'the rules are not in a valid shape', combos: [], samples: [] };
  }
  const problem = validateConnectorRules(rules, partClass);
  if (problem !== null) return { problem, combos: [], samples: [] };
  const combos = enumerateCombos(rules);
  const total = combos.reduce((sum, entry) => sum + entry.weight, 0);
  const layouts: ConnectorLayout[] = [];
  for (let index = 0; index < samples; index += 1) {
    const layout = generateConnectors(rules, w, h, `${seedBase}:${index}`);
    if (layout !== null) layouts.push(layout);
  }
  return {
    problem: null,
    combos: combos
      .map((entry) => ({ sides: entry.combo, probability: entry.weight / total }))
      .sort((a, b) => b.probability - a.probability),
    samples: layouts,
  };
}
