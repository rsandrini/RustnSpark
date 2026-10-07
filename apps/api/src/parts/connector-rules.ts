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
export function enumerateCombos(rules: ConnectorRules): { combo: SideCombo; weight: number }[] {
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
      if (isAllowed(rules, combo)) out.push({ combo, weight });
      return;
    }
    for (const [kind, w] of options[index]!) pick(index + 1, [...chosen, kind], weight * w);
  };
  pick(0, [], 1);
  return out;
}

function isAllowed(rules: ConnectorRules, combo: SideCombo): boolean {
  const kinds = SIDES.map((side) => combo[side]);
  if (rules.maxConnected !== undefined && kinds.filter((k) => k !== 'none').length > rules.maxConnected) {
    return false;
  }
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
): ConnectorLayout | null {
  const rules = parseConnectorRules(rulesJson);
  if (rules === null) return null;
  const combos = enumerateCombos(rules);
  if (combos.length === 0) return null;
  const total = combos.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = createRng(seed).float() * total;
  for (const entry of combos) {
    roll -= entry.weight;
    if (roll < 0) return expandCombo(entry.combo, w, h);
  }
  return expandCombo(combos[combos.length - 1]!.combo, w, h);
}

/** Factory default (seed): every side central; ENGINE/WEAPON get `none` on the facing side W. */
export function defaultConnectorRules(partClass: string): ConnectorRules {
  const central = [{ kind: 'central' as const, weight: 100 }];
  const none = [{ kind: 'none' as const, weight: 100 }];
  const directional = partClass === 'ENGINE' || partClass === 'WEAPON';
  return { sides: { N: central, E: central, S: central, W: directional ? none : central } };
}
