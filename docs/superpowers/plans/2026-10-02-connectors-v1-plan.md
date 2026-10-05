# Connectors v0.1 (Topology) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-adjacency ship-layout connectivity with physical connector nodes (central/split/universal, per cell side) — a part only contributes its functional stats when it has an unbroken chain of compatible connectors back to the bridge; disconnection is soft (the layout always saves; mass/structure/HP still count).

**Architecture:** `PartCatalog` gains admin-authored candidate connector layouts; `PartInstance` gets one rolled once at creation (`null` = universal fallback, for both pre-feature instances and unauthored part types — one rule, no backfill ever). `geometry.ts` gains a connector-aware flood-fill (`connectedPartIds`) replacing the old plain-adjacency reachability check, and drops the hard `DISCONNECTED` layout error entirely. A new pure helper (`applyConnectivity`) zeroes a disconnected part's functional catalog stats (not mass/structure/HP) before every real `deriveSheet` call that derives a ship's sheet from its own saved layout — threaded through every such call site so dispatch, scavenge, mining, travel, and the player-facing ship response all agree on what's actually working.

**Tech Stack:** NestJS + Prisma (API), React + Vite (web), Zod (shared contract), Jest (API tests), Vitest (web tests).

**Spec:** `docs/superpowers/specs/2026-10-02-connectors-v1-design.md`

**Dependency note:** This plan assumes `docs/superpowers/plans/2026-10-02-ship-format-plan.md` has already been implemented — specifically, `apps/api/src/ships/geometry.ts`'s `validateLayout` already takes a third `formatCells: ReadonlySet<string>` parameter and `cellKey` is already exported from that file. This plan's Task 3 builds directly on that signature. If Ship Format has NOT been implemented yet, stop and implement it first — the two features both modify `geometry.ts` and are not safe to apply out of order or in parallel.

## Global Constraints

- Connectors are purely structural/topological: no energy/fuel/data routing semantics of any kind.
- A connector is a per-(cell, side) attribute, not a finer sub-edge-position system. `central` matches `central` or `universal`; `split` matches `split` or `universal`; `universal` matches anything; `central` and `split` never match each other.
- Both sides of a shared edge need a connector for that edge to count as a connection — one side empty means never connected there, regardless of the other side.
- `connectorLayouts` empty/absent on a `PartCatalog` row → every instance of it is `connectors: null`, interpreted everywhere as "universal on every side of every occupied cell." This is also what every instance created **before** this feature shipped already has (their `connectors` column is `null` from the migration's own default) — one rule covers both cases, no backfill job.
- A part instance's `connectors` is rolled exactly once, at creation, and never re-rolled — not on catalog edits, not on a migration, not ever.
- Disconnection is soft: `validateLayout` never rejects a layout for having a disconnected part. A disconnected part still counts as `mass`, `structureCost` (`structureUsed`), and `partHp` (`hp`); it stops counting for everything else (`pot`, `pdf`, `bli`, `esc`, `sen`, `crg`, `min`, `energyCont`, `energyCombat`, `batCharge`, `batOutput`, `batInput`, `fuelCap`, `fuelUse`).
- This plan does not implement Connectors v0.2 (mid-mission disconnection) — no combat/resolver changes beyond baking a `connected` flag into the dispatch snapshot for v0.2 to later consume.

## Review Focus

1. **Every real caller of `deriveSheet` that derives a sheet from a ship's own saved layout** must see the same connectivity truth — a ship that looks viable in the Hangar but would silently fail a dispatch-time (or scavenge/mining/travel-time) re-check because one of those call sites wasn't updated is the single most likely bug this plan could ship with. Task 6 exists specifically to make this exhaustive, not partial.
2. A part type with **zero connectors anywhere** (every candidate layout is intentionally sparse, or the catalog simply never defines one for a given side) is legal and not a special case — it's just permanently disconnected unless it's the bridge itself (the flood-fill's root, always counted as connected to itself).
3. `LayoutErrorCode` loses `'DISCONNECTED'` — anywhere that pattern-matches on the full union (frontend error-code-to-message mapping, any `hangar.problems.DISCONNECTED` i18n key) needs that case removed, not just the backend emitter.
4. The admin's connector-layout widget must prevent (client) and reject (server) a candidate placing a connector outside the part's current `w`×`h` footprint — and must re-validate if an admin edits a part's `w`/`h` after candidates already exist for it, since a footprint shrink could leave stale out-of-bounds entries.
5. Rotation: a `central` connector on a part's `S` side must present as `W` after a 90° rotation (matching the existing width/height rotation `canPlace`/`validateLayout` already apply) — both in the connectivity graph (API) and in whatever the yard draws (web), or the two would silently disagree about which parts are connected.

---

## Task 1: `PartCatalog.connectorLayouts` and `PartInstance.connectors` columns

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/0033_connectors/migration.sql`

**Interfaces:**
- Produces: `PartCatalog.connectorLayouts: Json | null`; `PartInstance.connectors: Json | null`.

- [ ] **Step 1: Add the columns to `schema.prisma`**

Open `apps/api/prisma/schema.prisma`. Find `model PartCatalog` and add one field (anywhere among its existing scalar fields, e.g. right after `specialProp`):

```prisma
  connectorLayouts Json?
```

Find `model PartInstance` and add one field (e.g. right after `propRoll`):

```prisma
  connectors    Json?
```

(Do not touch the existing, unused `propRoll Json?` field on `PartInstance` — it has no references anywhere in `src/` and an undocumented original intent; this plan adds a new, separately-named column rather than repurposing it, per the Connectors v0.1 spec's own Review Focus item 3.)

- [ ] **Step 2: Write the migration**

Create `apps/api/prisma/migrations/0033_connectors/migration.sql`:

```sql
-- Connectors v0.1 (2026-10-02-connectors-v1-design.md): physical docking nodes per cell side,
-- replacing plain-adjacency connectivity. Both columns are nullable with no default and no
-- backfill — null means "universal fallback," which is exactly what every part type with no
-- admin-authored candidates (every part type today) and every instance created before this
-- migration (all of them) already is. Nothing existing changes behavior.

ALTER TABLE "PartCatalog" ADD COLUMN "connectorLayouts" JSONB;
ALTER TABLE "PartInstance" ADD COLUMN "connectors" JSONB;
```

(No FK, no NOT NULL, no default-value backfill concern here — unlike Ship Format's `formatId`, these are plain optional columns, so there's no constraint-validation-against-existing-rows hazard to work around.)

- [ ] **Step 3: Run the migration and regenerate the Prisma client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: migration `0033_connectors` applies with no errors; `@prisma/client` regenerates with both new nullable fields typed.

- [ ] **Step 4: Confirm nothing broke**

Run: `cd apps/api && npm run test:unit && npm run test:int`
Expected: fully green — this task only adds nullable columns nothing yet reads or writes.

- [ ] **Step 5: Commit**

```bash
cd apps/api
git add prisma/schema.prisma prisma/migrations/0033_connectors
git commit -m "Add PartCatalog.connectorLayouts and PartInstance.connectors columns"
```

---

## Task 2: Connector types, compatibility, and the random-roll helper

**Files:**
- Create: `apps/api/src/parts/connectors.ts`
- Create: `apps/api/test/unit/parts/connectors.spec.ts`

**Interfaces:**
- Produces: `type ConnectorKind = 'none' | 'central' | 'split' | 'universal'`; `interface ConnectorCell { dx: number; dy: number; side: 'N' | 'E' | 'S' | 'W'; kind: ConnectorKind }`; `type ConnectorLayout = { cells: ConnectorCell[] }`; `compatible(a: ConnectorKind, b: ConnectorKind): boolean`; `sideKindAt(layout: ConnectorLayout | null, dx: number, dy: number, side: 'N'|'E'|'S'|'W'): ConnectorKind`; `rotateSide(side: 'N'|'E'|'S'|'W', rot: 0 | 90): 'N'|'E'|'S'|'W'`; `rollConnectors(connectorLayouts: unknown): ConnectorLayout | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/unit/parts/connectors.spec.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import {
  compatible,
  rollConnectors,
  rotateSide,
  sideKindAt,
  type ConnectorLayout,
} from '../../../src/parts/connectors.js';

describe('compatible', () => {
  it('matches central with central or universal, never with split', () => {
    expect(compatible('central', 'central')).toBe(true);
    expect(compatible('central', 'universal')).toBe(true);
    expect(compatible('central', 'split')).toBe(false);
  });

  it('matches split with split or universal, never with central', () => {
    expect(compatible('split', 'split')).toBe(true);
    expect(compatible('split', 'universal')).toBe(true);
    expect(compatible('split', 'central')).toBe(false);
  });

  it('matches universal with anything but none', () => {
    expect(compatible('universal', 'universal')).toBe(true);
    expect(compatible('universal', 'central')).toBe(true);
    expect(compatible('universal', 'split')).toBe(true);
    expect(compatible('universal', 'none')).toBe(false);
  });

  it('none never matches anything, including another none', () => {
    expect(compatible('none', 'none')).toBe(false);
    expect(compatible('none', 'universal')).toBe(false);
  });
});

describe('sideKindAt', () => {
  it('returns universal for every side when the layout is null (the fallback)', () => {
    expect(sideKindAt(null, 0, 0, 'N')).toBe('universal');
    expect(sideKindAt(null, 3, -2, 'W')).toBe('universal');
  });

  it('returns the listed kind for a cell/side that is present', () => {
    const layout: ConnectorLayout = { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] };
    expect(sideKindAt(layout, 0, 0, 'S')).toBe('central');
  });

  it('returns none for a cell/side not listed, when the layout is non-null', () => {
    const layout: ConnectorLayout = { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] };
    expect(sideKindAt(layout, 0, 0, 'N')).toBe('none');
    expect(sideKindAt(layout, 1, 0, 'S')).toBe('none');
  });
});

describe('rotateSide', () => {
  it('leaves sides unchanged at rot 0', () => {
    expect(rotateSide('N', 0)).toBe('N');
    expect(rotateSide('S', 0)).toBe('S');
  });

  it('rotates one step clockwise at rot 90 (N->E->S->W->N)', () => {
    expect(rotateSide('N', 90)).toBe('E');
    expect(rotateSide('E', 90)).toBe('S');
    expect(rotateSide('S', 90)).toBe('W');
    expect(rotateSide('W', 90)).toBe('N');
  });
});

describe('rollConnectors', () => {
  it('returns null (the universal fallback) when connectorLayouts is empty, absent, or malformed', () => {
    expect(rollConnectors(null)).toBeNull();
    expect(rollConnectors(undefined)).toBeNull();
    expect(rollConnectors([])).toBeNull();
    expect(rollConnectors('not an array')).toBeNull();
  });

  it('picks one of the candidates when connectorLayouts has entries', () => {
    const candidates = [
      { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] },
      { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const result = rollConnectors(candidates);
      expect(result).not.toBeNull();
      seen.add(JSON.stringify(result));
    }
    // Over 50 rolls both candidates should show up — this is a randomness smoke test, not a
    // strict distribution check (astronomically unlikely to false-fail at 50 draws from 2).
    expect(seen.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npm run test:unit -- connectors.spec.ts`
Expected: FAIL — the module doesn't exist.

- [ ] **Step 3: Write `connectors.ts`**

Create `apps/api/src/parts/connectors.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { createRng } from '../common/rng/rng.js';

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

/** A placement's `rot` (0 or 90) rotates connector sides the same way it already rotates
    width/height in canPlace/validateLayout — the catalog/instance data is always stored
    unrotated; this applies the transform where placements are evaluated. */
export function rotateSide(side: ConnectorSide, rot: 0 | 90): ConnectorSide {
  return rot === 90 ? ROTATE_CW[side] : side;
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

/** Picks one candidate layout uniformly at random, called once at instance-creation time —
    never re-rolled. Returns null (the universal fallback) when there is nothing to pick from,
    which is both "this part type has no authored candidates yet" and, by the same rule,
    exactly what an instance created before this feature existed already has. No mission-seed
    context exists at part-creation time (this is structural, not combat/economy-deterministic
    per the spec), so this uses a fresh seed per roll — the same Rng.pick() shape every other
    random choice in this codebase already goes through, just not a replay-chained one. */
export function rollConnectors(connectorLayouts: unknown): ConnectorLayout | null {
  if (!Array.isArray(connectorLayouts) || connectorLayouts.length === 0) return null;
  const candidates = connectorLayouts as ConnectorLayout[];
  const rng = createRng(randomUUID());
  return rng.pick(candidates);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npm run test:unit -- connectors.spec.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/parts/connectors.ts apps/api/test/unit/parts/connectors.spec.ts
git commit -m "Add connector kinds, compatibility, rotation, and the per-instance roll"
```

---

## Task 3: Connector-aware connectivity in `geometry.ts`; drop the hard `DISCONNECTED` block

**Files:**
- Modify: `apps/api/src/ships/geometry.ts`
- Modify: `apps/api/src/parts/part.types.ts`
- Modify: `apps/api/test/unit/ships/geometry.spec.ts`

**Interfaces:**
- Consumes: `compatible`, `sideKindAt`, `rotateSide`, `ConnectorLayout` from Task 2. `validateLayout(placements, catalog, formatCells)` from the Ship Format plan's Task 2 (this task adds a 4th parameter).
- Produces: `connectedPartIds(placements: Placement[], catalog: ReadonlyMap<string, PartCatalog>, connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>): Set<string>`. `validateLayout` gains a 4th parameter `connectorsByInstance` and never emits `'DISCONNECTED'` again. `LayoutErrorCode` becomes `'OUT_OF_BOUNDS' | 'OVERLAP'`.

- [ ] **Step 1: Update `LayoutErrorCode`**

Open `apps/api/src/parts/part.types.ts`. Find:
```typescript
export type LayoutErrorCode = 'OUT_OF_BOUNDS' | 'OVERLAP' | 'DISCONNECTED';
```
Change to:
```typescript
export type LayoutErrorCode = 'OUT_OF_BOUNDS' | 'OVERLAP';
```

- [ ] **Step 2: Write the failing tests**

Open `apps/api/test/unit/ships/geometry.spec.ts` (already exists, extended by the Ship Format plan's Task 2 — it now has a `catalog` map with `bridge`/`hull` entries, a `wideSquareCells()` cell set, plus a `'validateLayout — format cell bounds'` describe block). Make these changes:

Every existing `validateLayout(placements, catalog, cells)` call (6 of them, from the Format plan) needs a 4th argument. Add `const noConnectors = new Map<string, ConnectorLayout | null>();` near the top of the first `describe` block (both `bridge` and `hull` get no entry — `connectedPartIds` must treat a missing map entry as `null`, same as an explicit `null`, since the universal fallback applies either way), and pass it as the 4th argument to each of those 6 calls. Also update the `'validateLayout — format cell bounds'` block's 3 calls the same way, with its own `noConnectors` map (or reuse one — a `Map` with no entries works for every test in the file so far, since none of them intentionally test an incompatible connector yet).

Then add a new import and a new `describe` block:

```typescript
import { connectedPartIds } from '../../../src/ships/geometry.js';
import type { ConnectorLayout } from '../../../src/parts/connectors.js';
```

```typescript
describe('connectedPartIds', () => {
  // 1x1 bridge at (0,0), 1x1 "pod" at (1,0) — adjacent cells sharing the edge between
  // bridge's E side and pod's W side.
  const POD: PartCatalog = {
    partType: 'pod',
    partClass: 'UTILITY',
    w: 1,
    h: 1,
    mass: 0,
    structureCost: 0,
    partHp: 0,
    basePrice: 0,
    pot: 0,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
    fuelCap: 0,
    fuelUse: 0,
    batCharge: 0,
    batOutput: 0,
    batInput: 0,
    pressurized: false,
    lifeSupport: false,
  };
  const BRIDGE: PartCatalog = { ...POD, partType: 'bridge', partClass: 'BRIDGE' };
  const twoPartCatalog = new Map([
    ['p-bridge', BRIDGE],
    ['p-pod', POD],
  ]);
  const placements: Placement[] = [
    { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
    { partInstanceId: 'p-pod', gx: 1, gy: 0, rot: 0 },
  ];

  it('connects two parts whose facing sides both have a compatible connector', () => {
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'E', kind: 'central' }] }],
      ['p-pod', { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'central' }] }],
    ]);
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge', 'p-pod']));
  });

  it('does not connect when one side has no connector at all', () => {
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'E', kind: 'central' }] }],
      ['p-pod', { cells: [] }], // pod's W side explicitly has nothing
    ]);
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge'])); // the bridge is always connected to itself
  });

  it('does not connect central to split', () => {
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'E', kind: 'central' }] }],
      ['p-pod', { cells: [{ dx: 0, dy: 0, side: 'W', kind: 'split' }] }],
    ]);
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge']));
  });

  it('connects when a part has no entry in the map at all (treated as the universal fallback)', () => {
    const connectors = new Map<string, ConnectorLayout | null>(); // neither part has an entry
    const result = connectedPartIds(placements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge', 'p-pod']));
  });

  it('respects rotation: a connector on S becomes W after a 90-degree rotation', () => {
    // Pod placed to the SOUTH of the bridge instead of east, rotated 90 so its originally-S
    // connector now faces north (back toward the bridge).
    const rotatedPlacements: Placement[] = [
      { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'p-pod', gx: 0, gy: 1, rot: 90 },
    ];
    const connectors = new Map<string, ConnectorLayout | null>([
      ['p-bridge', { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] }],
      ['p-pod', { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] }], // rotates to N
    ]);
    const result = connectedPartIds(rotatedPlacements, twoPartCatalog, connectors);
    expect(result).toEqual(new Set(['p-bridge', 'p-pod']));
  });
});

describe('validateLayout — no more DISCONNECTED', () => {
  it('saves a layout with a disconnected part instead of rejecting it', () => {
    const catalog = new Map([
      ['p-bridge', { partType: 'bridge', partClass: 'BRIDGE', w: 1, h: 1, mass: 0, structureCost: 0, partHp: 0, basePrice: 0, pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0, fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false, lifeSupport: false }],
      ['p-far', { partType: 'hull', partClass: 'DEFENSE', w: 1, h: 1, mass: 0, structureCost: 0, partHp: 0, basePrice: 0, pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0, fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false, lifeSupport: false }],
    ]);
    const wideCells = new Set<string>();
    for (let y = -20; y < 20; y += 1) for (let x = -20; x < 20; x += 1) wideCells.add(`${x},${y}`);
    const placements: Placement[] = [
      { partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'p-far', gx: 5, gy: 5, rot: 0 }, // not adjacent to anything
    ];
    const errors = validateLayout(placements, catalog, wideCells, new Map());
    expect(errors).toEqual([]); // no DISCONNECTED, no error at all — it just won't be "connected"
  });
});
```

(Add `import type { Placement, PartCatalog } from '../../../src/parts/part.types.js';` if not already present at the top of the file from the Ship Format plan's edits.)

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/api && npm run test:unit -- geometry.spec.ts`
Expected: FAIL — `connectedPartIds` doesn't exist; `validateLayout` only takes 3 arguments; the `'rejects disconnected parts'` test (from the original/Format-plan content) still expects `'DISCONNECTED'` to appear, which this task is about to remove — **delete that specific assertion's expectation once Step 4 lands** (see the note at the end of Step 4 below).

- [ ] **Step 4: Rewrite `geometry.ts`**

Replace `apps/api/src/ships/geometry.ts` in full:

```typescript
import type { PartCatalog, Placement, LayoutError } from '../parts/part.types.js';
import { compatible, sideKindAt, type ConnectorLayout } from '../parts/connectors.js';

/** Yard cells run [-GRID_HALF_SIZE, GRID_HALF_SIZE) on both axes — retained only as the admin
    format-drawing tool's canvas ceiling, not a gameplay constant: which cells actually exist
    comes from the ship's own ShipFormat. */
export const GRID_HALF_SIZE = 10;
const RIGHT_ANGLE = 90;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

interface OccupiedCell {
  readonly partInstanceId: string;
  /** This cell's offset within its part's own (unrotated) footprint — needed to look up that
      cell's own connector sides, since connector data is authored per (dx, dy), not per
      absolute grid position. */
  readonly dx: number;
  readonly dy: number;
}

function footprintCells(
  placement: Placement,
  part: PartCatalog,
): Array<{ x: number; y: number; dx: number; dy: number }> {
  const width = placement.rot === RIGHT_ANGLE ? part.h : part.w;
  const height = placement.rot === RIGHT_ANGLE ? part.w : part.h;
  const cells: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      cells.push({ x: placement.gx + dx, y: placement.gy + dy, dx, dy });
    }
  }
  return cells;
}

export function validateLayout(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): LayoutError[] {
  const errors: LayoutError[] = [];
  const occupied = new Map<string, OccupiedCell>();

  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined) {
      // A part instance the caller doesn't know about at all can't be geometrically checked —
      // treat it as simply not occupying any cells (OUT_OF_BOUNDS/OVERLAP don't apply to it).
      continue;
    }

    for (const { x, y, dx, dy } of footprintCells(placement, part)) {
      const key = cellKey(x, y);
      if (!formatCells.has(key)) {
        if (!hasError(errors, 'OUT_OF_BOUNDS')) {
          errors.push({
            code: 'OUT_OF_BOUNDS',
            partInstanceId: placement.partInstanceId,
            message: `Part ${placement.partInstanceId} is outside the ship's format.`,
          });
        }
      }
      const existing = occupied.get(key);
      if (existing !== undefined && existing.partInstanceId !== placement.partInstanceId) {
        if (!hasError(errors, 'OVERLAP')) {
          errors.push({
            code: 'OVERLAP',
            partInstanceId: placement.partInstanceId,
            message: `Part ${placement.partInstanceId} overlaps ${existing.partInstanceId}.`,
          });
        }
      }
      occupied.set(key, { partInstanceId: placement.partInstanceId, dx, dy });
    }
  }

  return errors;
}

function hasError(errors: LayoutError[], code: LayoutError['code']): boolean {
  return errors.some((error) => error.code === code);
}

const NEIGHBOR_OFFSETS: ReadonlyArray<{ dx: 0 | 1 | -1; dy: 0 | 1 | -1; from: 'N'|'E'|'S'|'W'; to: 'N'|'E'|'S'|'W' }> = [
  { dx: 0, dy: -1, from: 'N', to: 'S' },
  { dx: 1, dy: 0, from: 'E', to: 'W' },
  { dx: 0, dy: 1, from: 'S', to: 'N' },
  { dx: -1, dy: 0, from: 'W', to: 'E' },
];

/** Bridge-rooted flood-fill (Connectors v0.1): a neighbor cell is only reachable through an
    edge where BOTH facing sides have a compatible connector (rotation-aware) — plain adjacency
    is necessary but no longer sufficient. Returns every part-instance id reachable from the
    bridge, including the bridge's own id (always "connected" to itself, the flood-fill's
    root). A ship with no bridge in the layout returns an empty set. */
export function connectedPartIds(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): Set<string> {
  const occupied = new Map<string, OccupiedCell>();
  const rotByInstance = new Map<string, 0 | 90>();
  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined) continue;
    rotByInstance.set(placement.partInstanceId, placement.rot as 0 | 90);
    for (const { x, y, dx, dy } of footprintCells(placement, part)) {
      occupied.set(cellKey(x, y), { partInstanceId: placement.partInstanceId, dx, dy });
    }
  }

  const bridgePlacement = placements.find((p) => catalog.get(p.partInstanceId)?.partClass === 'BRIDGE');
  if (bridgePlacement === undefined) return new Set();
  const startKey = cellKey(bridgePlacement.gx, bridgePlacement.gy);
  if (!occupied.has(startKey)) return new Set();

  // rotateSide(side, 90) gives the rotated-WORLD side for a given unrotated-AUTHORED side
  // (used when drawing/placing). Here we need the inverse — given a world-facing side, which
  // authored side produced it — which for a 4-cycle 90° clockwise rotation is one step
  // counter-clockwise. A direct reverse-lookup table, rather than three chained forward
  // rotations, keeps that inverse obvious on inspection instead of resting on modular
  // arithmetic ("270 clockwise == 90 counter-clockwise").
  const ROTATE_CCW: Record<'N'|'E'|'S'|'W', 'N'|'E'|'S'|'W'> = { N: 'W', W: 'S', S: 'E', E: 'N' };
  const connectedKindAt = (cell: OccupiedCell, side: 'N'|'E'|'S'|'W'): ReturnType<typeof sideKindAt> => {
    const rot = rotByInstance.get(cell.partInstanceId) ?? 0;
    const authoredSide = rot === 0 ? side : ROTATE_CCW[side];
    return sideKindAt(connectorsByInstance.get(cell.partInstanceId) ?? null, cell.dx, cell.dy, authoredSide);
  };

  const visitedCells = new Set<string>([startKey]);
  const connectedParts = new Set<string>();
  const queue: string[] = [startKey];

  while (queue.length > 0) {
    const key = queue.shift()!;
    const cell = occupied.get(key)!;
    connectedParts.add(cell.partInstanceId);
    const [xRaw, yRaw] = key.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborKey = cellKey(x + offset.dx, y + offset.dy);
      if (visitedCells.has(neighborKey)) continue;
      const neighbor = occupied.get(neighborKey);
      if (neighbor === undefined) continue;
      if (neighbor.partInstanceId === cell.partInstanceId) {
        // Same physical part's own adjacent cell — always "connected" within itself, no
        // connector needed between a part's own cells.
        visitedCells.add(neighborKey);
        queue.push(neighborKey);
        continue;
      }
      const hereKind = connectedKindAt(cell, offset.from);
      const thereKind = connectedKindAt(neighbor, offset.to);
      if (compatible(hereKind, thereKind)) {
        visitedCells.add(neighborKey);
        queue.push(neighborKey);
      }
    }
  }

  return connectedParts;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && npm run test:unit -- geometry.spec.ts`
Expected: PASS, every test in the file, including the rotation test from Step 2 (which exercises exactly the `ROTATE_CCW` path: a `south`-authored connector on a part rotated 90° must present as facing `north` in world space, matching the test's placement of the pod directly south of the bridge).

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `cd apps/api && npm run test:unit && npx tsc --noEmit -p tsconfig.json`
Expected: every OTHER caller of `validateLayout` now fails to compile (3 arguments instead of 4) — this is Task 6's job to fix (`ships.service.ts` and the Ship Format plan's `setFormat` method both call it). Note this in your ledger and do not fix those callers from inside this task; geometry.ts's own test suite and typecheck of `geometry.ts` in isolation is what Step 5/6 confirm here.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ships/geometry.ts apps/api/src/parts/part.types.ts apps/api/test/unit/ships/geometry.spec.ts
git commit -m "geometry: connector-aware connectivity; drop the hard DISCONNECTED block"
```

---

## Task 4: `applyConnectivity` — the structural/functional stat split

**Files:**
- Create: `apps/api/src/ships/connectivity.ts`
- Create: `apps/api/test/unit/ships/connectivity.spec.ts`

**Interfaces:**
- Produces: `applyConnectivity(parts: InstalledPart[], connectedIds: ReadonlySet<string>): InstalledPart[]` — a pure function, no `deriveSheet` changes needed at all.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/unit/ships/connectivity.spec.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import { applyConnectivity } from '../../../src/ships/connectivity.js';
import type { InstalledPart } from '../../../src/parts/part.types.js';

function part(id: string, overrides: Partial<InstalledPart['catalog']> = {}): InstalledPart {
  return {
    instance: { id, partType: 'x', condition: 100 },
    catalog: {
      partType: 'x',
      partClass: 'UTILITY',
      w: 1,
      h: 1,
      mass: 5,
      structureCost: 3,
      partHp: 10,
      basePrice: 0,
      pot: 7,
      pdf: 7,
      bli: 7,
      esc: 7,
      sen: 7,
      crg: 7,
      min: 7,
      energyCont: 7,
      energyCombat: 7,
      fuelCap: 7,
      fuelUse: 7,
      batCharge: 7,
      batOutput: 7,
      batInput: 7,
      pressurized: false,
      lifeSupport: false,
      ...overrides,
    },
  };
}

describe('applyConnectivity', () => {
  it('leaves a connected part entirely unchanged', () => {
    const p = part('a');
    const [result] = applyConnectivity([p], new Set(['a']));
    expect(result).toEqual(p);
  });

  it('zeroes every functional stat for a disconnected part, keeping mass/structureCost/partHp', () => {
    const p = part('a');
    const [result] = applyConnectivity([p], new Set()); // 'a' not in the connected set
    expect(result!.catalog.mass).toBe(5);
    expect(result!.catalog.structureCost).toBe(3);
    expect(result!.catalog.partHp).toBe(10);
    for (const key of [
      'pot', 'pdf', 'bli', 'esc', 'sen', 'crg', 'min',
      'energyCont', 'energyCombat', 'batCharge', 'batOutput', 'batInput', 'fuelCap', 'fuelUse',
    ] as const) {
      expect(result!.catalog[key]).toBe(0);
    }
  });

  it('does not mutate the input', () => {
    const p = part('a');
    applyConnectivity([p], new Set());
    expect(p.catalog.pot).toBe(7); // original object untouched
  });

  it('handles a mix of connected and disconnected parts independently', () => {
    const a = part('a');
    const b = part('b');
    const [resultA, resultB] = applyConnectivity([a, b], new Set(['a']));
    expect(resultA!.catalog.pot).toBe(7);
    expect(resultB!.catalog.pot).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npm run test:unit -- connectivity.spec.ts`
Expected: FAIL — the module doesn't exist.

- [ ] **Step 3: Write `connectivity.ts`**

Create `apps/api/src/ships/connectivity.ts`:

```typescript
import type { InstalledPart } from '../parts/part.types.js';

/** Stats that still count for a disconnected part — it's still physically bolted on, still
    has bulk and hull integrity, it just isn't doing its job. Every other catalog stat is
    "functional" and only counts when connected. */
const STRUCTURAL_KEYS = new Set(['mass', 'structureCost', 'partHp']);

/** Zeroes a disconnected part's functional stats before deriveSheet sums them — deriveSheet
    itself is unchanged; this is a pure pre-processing step every real caller applies first.
    mass/structureCost/partHp are untouched regardless of connection status (Connectors v0.1:
    a disconnected part is dead weight, not an absent one). */
export function applyConnectivity(
  parts: readonly InstalledPart[],
  connectedIds: ReadonlySet<string>,
): InstalledPart[] {
  return parts.map((part) => {
    if (connectedIds.has(part.instance.id)) return part;
    const catalog = { ...part.catalog };
    for (const key of Object.keys(catalog) as Array<keyof typeof catalog>) {
      if (STRUCTURAL_KEYS.has(key) || typeof catalog[key] !== 'number') continue;
      (catalog as Record<string, unknown>)[key] = 0;
    }
    return { ...part, catalog };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npm run test:unit -- connectivity.spec.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

```bash
git add apps/api/src/ships/connectivity.ts apps/api/test/unit/ships/connectivity.spec.ts
git commit -m "Add applyConnectivity: zero a disconnected part's functional stats, keep structural ones"
```

---

## Task 5: Roll connectors at every part-instance creation point

**Files:**
- Create: `apps/api/src/parts/roll-connectors-for-part-type.ts`
- Modify: `apps/api/src/economy/market.service.ts`
- Modify: `apps/api/src/missions/resolve.service.ts`
- Modify: `apps/api/src/players/onboarding.service.ts`
- Modify: `apps/api/src/economy/inventory.service.ts`
- Test: `apps/api/test/integration/parts-ships.int-spec.ts` (onboarding kit), `apps/api/test/integration/market.int-spec.ts` (buy)

**Interfaces:**
- Consumes: `rollConnectors` from Task 2.
- Produces: `rollConnectorsForPartType(tx: Prisma.TransactionClient | PrismaService, partType: string): Promise<ConnectorLayout | null>` — fetches the catalog row and rolls, for the 3 call sites that only have a bare `partType` string in scope (onboarding, inventory's restart kit, scavenge finds). `market.service.ts` already has the full catalog row loaded and calls `rollConnectors` directly without this wrapper.

- [ ] **Step 1: Write the failing test for market buy**

Open `apps/api/test/integration/market.int-spec.ts`. Find an existing test that buys a catalog listing and inspects the created `PartInstance` row (there is one — this file already asserts on `condition`/`rarity` of a freshly-bought instance). Add, in the same `describe` block:

```typescript
  it('rolls connectors once at purchase, from the catalog\'s own candidates (round 11, Connectors v0.1)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.partCatalog.update({
      where: { partType: 'cargo' },
      data: {
        connectorLayouts: [
          { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] },
        ],
      },
    });

    const listing = /* find a 'cargo' catalog listing the same way this file's other buy tests do */;
    const response = await request(httpServer(testApp.app))
      .post('/v1/market/buy')
      .set(auth(player.token))
      .send({ listingId: listing.id, expectedPrice: listing.price });
    expect(response.status).toBe(200);
    const instanceId = (response.body as { id: string }).id;

    const row = await prisma.partInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(row.connectors).toEqual({ cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] });
  });

  it('rolls null (the universal fallback) when the catalog has no connectorLayouts', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    // 'cargo' has no connectorLayouts in the fresh seed — this is the default state of every
    // part type today.
    const listing = /* same lookup pattern as above, for 'cargo' */;
    const response = await request(httpServer(testApp.app))
      .post('/v1/market/buy')
      .set(auth(player.token))
      .send({ listingId: listing.id, expectedPrice: listing.price });
    const instanceId = (response.body as { id: string }).id;
    const row = await prisma.partInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(row.connectors).toBeNull();
  });
```

Before finalizing these, open `market.int-spec.ts` and copy this file's OWN existing pattern for finding a buyable `'cargo'` listing and the exact request/response shape its other buy tests already use (`auth`, `onboardPlayer`, `freshSeededApp` or whatever this specific file's own helpers are actually named — follow this file's own established helper names exactly, the same way Ship Format's Task 3 resolved `parts-ships.int-spec.ts`'s real helpers instead of guessing).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npm run test:int -- market.int-spec.ts -t "rolls connectors once at purchase|rolls null"`
Expected: FAIL — `row.connectors` is `undefined` on the Prisma type until Task 1's migration is applied (it should already be, from Task 1) and the service never sets it.

- [ ] **Step 3: Write `rollConnectorsForPartType`**

Create `apps/api/src/parts/roll-connectors-for-part-type.ts`:

```typescript
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { rollConnectors, type ConnectorLayout } from './connectors.js';

/** For the 3 creation call sites that only have a bare partType string in scope (onboarding's
    starter kit, a restart kit, a scavenge find) — fetches just enough of the catalog row to
    roll. market.service.ts already has the full catalog row loaded elsewhere and calls
    rollConnectors directly instead of this wrapper. */
export async function rollConnectorsForPartType(
  tx: Prisma.TransactionClient | PrismaService,
  partType: string,
): Promise<ConnectorLayout | null> {
  const row = await tx.partCatalog.findUniqueOrThrow({
    where: { partType },
    select: { connectorLayouts: true },
  });
  return rollConnectors(row.connectorLayouts);
}
```

- [ ] **Step 4: Wire it into `market.service.ts`**

Open `apps/api/src/economy/market.service.ts`. Add an import: `import { rollConnectors } from '../parts/connectors.js';`. Find the `tx.partInstance.create` call (confirmed at this file's own line ~281):

```typescript
        const created = await tx.partInstance.create({
          data: {
            partType: catalog.partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
          },
        });
```

Change to:

```typescript
        const created = await tx.partInstance.create({
          data: {
            partType: catalog.partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
            connectors: rollConnectors(catalog.connectorLayouts) as Prisma.InputJsonValue | undefined,
          },
        });
```

(`catalog` here is already the full `PartCatalog` row this method loaded earlier, which now carries `connectorLayouts` once Task 1's migration is applied — no extra query needed. Check this file's existing imports for `Prisma` from `'@prisma/client'`; if not already imported, add `import type { Prisma } from '@prisma/client';` — `toJsonInput`-style casting may already be used elsewhere in this file for a `Json` field; if so, match that exact pattern instead of the inline cast shown here.)

- [ ] **Step 5: Wire it into `resolve.service.ts` (scavenge finds)**

Open `apps/api/src/missions/resolve.service.ts`. Add the import: `import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';`. Find the scavenge-find `tx.partInstance.create` call (confirmed at this file's own line ~194):

```typescript
          await tx.partInstance.create({
            data: {
              partType: found.partType,
              ownerPlayerId: mission.playerId!,
              condition: found.condition,
              location: 'INVENTORY',
            },
          });
```

Change to:

```typescript
          await tx.partInstance.create({
            data: {
              partType: found.partType,
              ownerPlayerId: mission.playerId!,
              condition: found.condition,
              location: 'INVENTORY',
              connectors: (await rollConnectorsForPartType(tx, found.partType)) as Prisma.InputJsonValue | undefined,
            },
          });
```

- [ ] **Step 6: Wire it into `onboarding.service.ts` (starter kit)**

Open `apps/api/src/players/onboarding.service.ts`. Add the import. Find the starter-kit creation (confirmed at this file's own line ~111):

```typescript
    const instances = await Promise.all(
      starterParts.map((partType) =>
        tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
          },
        }),
      ),
    );
```

Change to:

```typescript
    const instances = await Promise.all(
      starterParts.map(async (partType) =>
        tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
            connectors: (await rollConnectorsForPartType(tx, partType)) as Prisma.InputJsonValue | undefined,
          },
        }),
      ),
    );
```

- [ ] **Step 7: Wire it into `inventory.service.ts` (restart kit)**

Open `apps/api/src/economy/inventory.service.ts`. Add the import. Find the restart-kit creation (confirmed at this file's own line ~65):

```typescript
        await tx.partInstance.create({
          data: { partType, ownerPlayerId: playerId, condition, location: 'INVENTORY' },
          include: { partCatalog: true },
        }),
```

Change to:

```typescript
        await tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
            connectors: (await rollConnectorsForPartType(tx, partType)) as Prisma.InputJsonValue | undefined,
          },
          include: { partCatalog: true },
        }),
```

(This call site is inside a `for` loop pushing into `kit`, not a `.map` — the `await` for `rollConnectorsForPartType` fits the existing `await tx.partInstance.create(...)` on the same line without restructuring the loop.)

- [ ] **Step 8: Run the tests from Step 1 to verify they pass**

Run: `cd apps/api && npm run test:int -- market.int-spec.ts -t "rolls connectors once at purchase|rolls null"`
Expected: PASS.

- [ ] **Step 8b: Write and run the "no retroactive reroll" test the spec's own Testing section requires**

The spec's Testing section explicitly lists this as a required case: "re-fetching an existing instance after the catalog gains new candidates shows its `connectors` unchanged (no retroactive reroll)." Nothing rolls on read — this is really a test that reading back an instance never touches `rollConnectors` again — but it's worth pinning explicitly since it's the whole point of "roll once, never reroll." Add to `market.int-spec.ts`, in the same `describe` block as Step 1's tests:

```typescript
  it('does not retroactively reroll an existing instance when its catalog later gains connectorLayouts (no backfill, ever)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const listing = /* same 'cargo' listing lookup as this file's other buy tests */;
    const response = await request(httpServer(testApp.app))
      .post('/v1/market/buy')
      .set(auth(player.token))
      .send({ listingId: listing.id, expectedPrice: listing.price });
    const instanceId = (response.body as { id: string }).id;
    const before = await prisma.partInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(before.connectors).toBeNull(); // bought before the catalog had any candidates

    // An admin now authors real candidates for 'cargo' — simulating entity-tuning's own write
    // path directly, since this test only cares about PartInstance, not the admin endpoint.
    await prisma.partCatalog.update({
      where: { partType: 'cargo' },
      data: { connectorLayouts: [{ cells: [{ dx: 0, dy: 0, side: 'N', kind: 'universal' }] }] },
    });

    const after = await prisma.partInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(after.connectors).toBeNull(); // unchanged — no backfill job touched it
  });
```

Run: `cd apps/api && npm run test:int -- market.int-spec.ts -t "does not retroactively reroll"`
Expected: PASS.

- [ ] **Step 9: Run the full API unit + integration suites and typecheck**

Run: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean (unless Task 3's Step 6 note about other `validateLayout` callers still not compiling applies — if so, that's still Task 6's job, not this one's; everything else should be green).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/parts/roll-connectors-for-part-type.ts apps/api/src/economy/market.service.ts apps/api/src/missions/resolve.service.ts apps/api/src/players/onboarding.service.ts apps/api/src/economy/inventory.service.ts apps/api/test/integration/market.int-spec.ts
git commit -m "Roll connectors once at every part-instance creation point"
```

---

## Task 6: Thread connectivity through every real `deriveSheet` call site

This is the task Review Focus item 1 exists for — every one of these call sites derives a sheet from a ship's own currently-installed parts, and every one must now apply `applyConnectivity` first, or that call site's answer to "is this ship viable / what can it do" will disagree with what the player sees in Hangar.

**Files:**
- Modify: `apps/api/src/ships/ships.service.ts`
- Modify: `apps/api/src/ships/auto-layout.ts`
- Modify: `apps/api/src/ships/geometry.ts`
- Modify: `apps/api/src/missions/dispatch.service.ts`
- Modify: `apps/api/src/missions/scavenge-job.service.ts`
- Modify: `apps/api/src/missions/mining-job.service.ts`
- Modify: `apps/api/src/missions/travel.service.ts`
- Modify: `apps/api/src/missions/missions.service.ts`
- Modify: `apps/api/src/players/onboarding.service.ts`
- Modify: `apps/api/src/economy/refuel.service.ts`
- Modify: `apps/api/src/economy/inventory.service.ts`
- Modify: `apps/api/src/missions/resolution-input.ts`
- Modify: `apps/api/src/missions/dispatch.service.ts` (DispatchSnapshot type, same file as above — listed twice deliberately: one change is the sheet call, the other is the snapshot shape)
- Test: `apps/api/test/unit/ships/auto-layout.spec.ts`, `apps/api/test/integration/parts-ships.int-spec.ts`, `apps/api/test/unit/resolution/mission.resolver.spec.ts` (check whether this file or `resolution-input.spec.ts` covers `buildResolveInput` — search first: `grep -rln "buildResolveInput" apps/api/test`)

**Interfaces:**
- Consumes: `connectedPartIds` (Task 3), `applyConnectivity` (Task 4).
- Produces: `DispatchSnapshot.parts[].connected: boolean` (new field, consumed by `resolution-input.ts` and, later, Connectors v0.2). `loadFormatCells(tx, shipId): Promise<ReadonlySet<string>>` (new, `geometry.ts`).

- [ ] **Step 0: Close a gap the Ship Format plan left behind — `auto-layout.ts` never got threaded for `formatCells` at all, and every direct `validateLayout`/`autoLayout` call site in `ships.service.ts` needs the new `connectorsByInstance` argument too**

Checked against the actual Ship Format plan (`docs/superpowers/plans/2026-10-02-ship-format-plan.md`) via `grep -n "auto-layout" docs/superpowers/plans/2026-10-02-ship-format-plan.md`: zero matches. That plan updated `geometry.ts`'s `validateLayout` to a 3-argument signature (`placements, catalog, formatCells`) and updated its direct callers in `ships.service.ts`, but never touched `apps/api/src/ships/auto-layout.ts`, which has its own internal `validateLayout([...existing, placement], catalog)` call (2 args) — meaning `auto-layout.ts` fails to compile the moment Ship Format lands, before Connectors even enters the picture. This step closes both gaps at once: `formatCells` (Ship Format's missed argument) and `connectorsByInstance` (this plan's own new argument), since threading them separately would mean editing every one of these call sites twice.

Also note: `auto-layout.ts`'s `findPlacement` currently filters `errors.filter((error) => error.partInstanceId === part.instance.id || error.code === 'DISCONNECTED')` — once `LayoutErrorCode` loses `'DISCONNECTED'` (Task 3), comparing against that string literal no longer type-checks (`'DISCONNECTED'` is not assignable to `'OUT_OF_BOUNDS' | 'OVERLAP'`). This is exactly the dead-case-removal Review Focus item 3 warns about, surfacing in a file neither spec's own Review Focus list named explicitly — proof the exhaustive-caller sweep this task does is load-bearing, not a formality.

Add a small shared helper to `apps/api/src/ships/geometry.ts` (near `cellKey`):

```typescript
import type { Prisma } from '@prisma/client';

/** The two services that build a layout before any Ship row has a *chosen* format
    (onboarding's starter kit, a restart kit) still need the ship's actual format cells —
    every ship has a formatId from creation (Ship Format's own default), this just resolves
    it to the cell set `validateLayout`/`autoLayout` need. */
export async function loadFormatCells(
  tx: Prisma.TransactionClient,
  shipId: string,
): Promise<ReadonlySet<string>> {
  const ship = await tx.ship.findUniqueOrThrow({ where: { id: shipId }, select: { formatId: true } });
  const format = await tx.shipFormat.findUniqueOrThrow({
    where: { id: ship.formatId },
    select: { cells: true },
  });
  return new Set((format.cells as [number, number][]).map(([x, y]) => cellKey(x, y)));
}
```

Update `apps/api/src/ships/auto-layout.ts` in full:

```typescript
import type { InstalledPart, PartCatalog, Placement } from '../parts/part.types.js';
import { validateLayout } from './geometry.js';
import type { ConnectorLayout } from '../parts/connectors.js';

const RIGHT_ANGLE = 90;

export function autoLayout(
  parts: InstalledPart[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): Placement[] {
  const ordered = [...parts].sort((a, b) => {
    return Number(b.catalog.partClass === 'BRIDGE') - Number(a.catalog.partClass === 'BRIDGE');
  });

  const placements: Placement[] = [];

  for (const part of ordered) {
    const placement = findPlacement(part, placements, catalog, formatCells, connectorsByInstance);
    if (placement !== null) {
      placements.push(placement);
    }
  }

  return placements;
}

function findPlacement(
  part: InstalledPart,
  existing: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): Placement | null {
  if (part.catalog.partClass === 'BRIDGE') {
    return { partInstanceId: part.instance.id, gx: 0, gy: 0, rot: 0 };
  }

  const rotations = [0, RIGHT_ANGLE];
  const candidates = candidatePositions(existing);

  for (const { gx, gy } of candidates) {
    for (const rot of rotations) {
      const placement: Placement = { partInstanceId: part.instance.id, gx, gy, rot };
      const errors = validateLayout([...existing, placement], catalog, formatCells, connectorsByInstance);
      // No more DISCONNECTED case to special-case (Connectors v0.1 made disconnection soft,
      // never a placement obstacle) — a candidate position is only rejected for OUT_OF_BOUNDS
      // or OVERLAP involving this specific part.
      const relevant = errors.filter((error) => error.partInstanceId === part.instance.id);
      if (relevant.length === 0) {
        return placement;
      }
    }
  }

  return null;
}

function* candidatePositions(existing: Placement[]): Generator<{ gx: number; gy: number }> {
  const seen = new Set<string>();
  const radiusLimit = 20;

  for (const placement of existing) {
    for (let radius = 1; radius <= radiusLimit; radius += 1) {
      for (const { gx, gy } of ringAround(placement.gx, placement.gy, radius)) {
        const key = `${gx},${gy}`;
        if (!seen.has(key)) {
          seen.add(key);
          yield { gx, gy };
        }
      }
    }
  }
}

function* ringAround(
  cx: number,
  cy: number,
  radius: number,
): Generator<{ gx: number; gy: number }> {
  for (let dx = -radius; dx <= radius; dx += 1) {
    yield { gx: cx + dx, gy: cy - radius };
    yield { gx: cx + dx, gy: cy + radius };
  }
  for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
    yield { gx: cx - radius, gy: cy + dy };
    yield { gx: cx + radius, gy: cy + dy };
  }
}
```

Update `apps/api/test/unit/ships/auto-layout.spec.ts` in full — every `autoLayout`/`validateLayout` call gains the two new arguments (a wide `[-20,20)` square, generous enough that none of this file's own placements can ever hit `OUT_OF_BOUNDS`, plus an empty connectors map, so every test's existing pass/fail expectations are unaffected by either new argument):

```typescript
import { describe, expect, it } from '@jest/globals';
import { autoLayout } from '../../../src/ships/auto-layout.js';
import { validateLayout } from '../../../src/ships/geometry.js';
import { buildInstalled, catalogByInstanceId, CATALOG_BY_TYPE } from './fixtures/catalog.js';
import type { ConnectorLayout } from '../../../src/parts/connectors.js';

const wideCells = new Set<string>();
for (let y = -20; y < 20; y += 1) for (let x = -20; x < 20; x += 1) wideCells.add(`${x},${y}`);
const noConnectors = new Map<string, ConnectorLayout | null>();

describe('autoLayout', () => {
  it('places a single part at the origin', () => {
    const parts = buildInstalled(['bridge']);
    const placements = autoLayout(parts, catalogByInstanceId(parts), wideCells, noConnectors);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ partInstanceId: 'bridge-0', gx: 0, gy: 0, rot: 0 });
  });

  it('produces a valid layout for the starter build', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'cargo',
      'cargo',
      'hull',
    ]);
    const placements = autoLayout(parts, catalogByInstanceId(parts), wideCells, noConnectors);
    expect(validateLayout(placements, catalogByInstanceId(parts), wideCells, noConnectors)).toEqual([]);
  });

  it('produces a valid layout for random part subsets', () => {
    const allTypes = Array.from(CATALOG_BY_TYPE.keys()).filter((t) => t !== 'bridge');
    for (let seed = 1; seed <= 20; seed += 1) {
      const subset = allTypes.filter((_, index) => (index + seed) % 3 === 0);
      const parts = buildInstalled(['bridge', ...subset]);
      const placements = autoLayout(parts, catalogByInstanceId(parts), wideCells, noConnectors);
      expect(validateLayout(placements, catalogByInstanceId(parts), wideCells, noConnectors)).toEqual([]);
    }
  });

  it('still places every part even when nothing is connector-compatible (soft disconnection is never a placement obstacle)', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small']);
    // Every instance gets an explicit empty-cells layout — no side has anything, so nothing
    // can ever be "connected" to anything. autoLayout must still place all of them.
    const allDisconnected = new Map<string, ConnectorLayout | null>(
      parts.map((p) => [p.instance.id, { cells: [] }]),
    );
    const placements = autoLayout(parts, catalogByInstanceId(parts), wideCells, allDisconnected);
    expect(placements).toHaveLength(parts.length);
  });
});
```

Update `apps/api/src/ships/ships.service.ts`'s `arrange()` (confirmed at this file's own line ~410) and its 2 call sites (`autoAssemble` at line ~126, `preview`'s else-branch at line ~167) to take and pass through `formatCells`/`connectorsByInstance` — both call sites already have `ship`, `playerParts` in scope:

```typescript
function arrange(
  requested: InstalledPart[],
  formatCells: ReadonlySet<string>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): {
  layout: Placement[];
  placed: InstalledPart[];
  omitted: InstalledPart[];
} {
  const layout = autoLayout(requested, buildCatalogMap(requested), formatCells, connectorsByInstance);
  const placedIds = new Set(layout.map((placement) => placement.partInstanceId));
  return {
    layout,
    placed: requested.filter((part) => placedIds.has(part.instance.id)),
    omitted: requested.filter((part) => !placedIds.has(part.instance.id)),
  };
}
```

At each call site, build the two maps from what's already loaded (`ship.formatId` resolved the same way `toResponse` already does in Step 1 below — reuse that same format-lookup result where the method already loads it for other reasons, or add one `this.prisma.shipFormat.findUniqueOrThrow({ where: { id: ship.formatId } })` call where it doesn't yet), e.g. in `autoAssemble`:

```typescript
    const format = await this.prisma.shipFormat.findUniqueOrThrow({ where: { id: ship.formatId } });
    const formatCells = new Set((format.cells as [number, number][]).map(([x, y]) => cellKey(x, y)));
    const connectorsByInstance = new Map(
      playerParts.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const { layout, omitted } = arrange(candidateParts.map(toInstalledPart), formatCells, connectorsByInstance);
```

(Apply the identical 3-line lookup immediately before `preview`'s own `arrange(...)` call too, using that method's own `ship`/`playerParts` already in scope. Import `cellKey` from `./geometry.js` alongside the existing `validateLayout`/`GRID_HALF_SIZE` import line, and `ConnectorLayout` from `../parts/connectors.js`.)

Update `assertLayoutValid` (confirmed at this file's own line ~257) to add the connectors map to its own `validateLayout` call (its `formatCells` argument is already present from the Ship Format plan's own edit to this method — only the 4th argument is new here):

```typescript
    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const connectorsByInstance = new Map(
      playerParts.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const geometryErrors = validateLayout(layout, catalogMap, formatCells, connectorsByInstance);
```

(`formatCells` here is whatever name/expression the Ship Format plan's own edit to this method already introduced — read the method as it stands after that plan's implementation and add only the `connectorsByInstance` argument in the same call, matching whatever variable name is already there.)

Update `apps/api/src/players/onboarding.service.ts`'s `applyStarterKit` (confirmed line ~111) to resolve both maps before its own `autoLayout` call:

```typescript
    const catalogMap = new Map(installedParts.map((p) => [p.instance.id, p.catalog]));
    const formatCells = await loadFormatCells(tx, shipId);
    const connectorsByInstance = new Map(
      partsWithCatalog.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const layout = autoLayout(installedParts, catalogMap, formatCells, connectorsByInstance);
```

(Add `import { loadFormatCells } from '../ships/geometry.js';` and `import type { ConnectorLayout } from '../parts/connectors.js';`.)

Update `apps/api/src/economy/inventory.service.ts`'s `ensureViableShip` (confirmed line ~65) the same way, using its own `kit`/`kitParts` names:

```typescript
    const catalogMap = new Map(kitParts.map((part) => [part.instance.id, part.catalog]));
    const formatCells = await loadFormatCells(tx, shipId);
    const connectorsByInstance = new Map(
      kit.map((part) => [part.id, part.connectors as ConnectorLayout | null]),
    );
    const layout = autoLayout(kitParts, catalogMap, formatCells, connectorsByInstance);
```

Run `cd apps/api && npx tsc --noEmit -p tsconfig.json` and confirm `auto-layout.ts`, `auto-layout.spec.ts`, and every caller touched above now compile — this is expected to still show errors in every file Step 1 onward hasn't reached yet; only the files this step touched should be clean at this point.

Commit this step on its own, separately from the rest of Task 6, since it stands alone (it has nothing to do with `deriveSheet`):

```bash
git add apps/api/src/ships/geometry.ts apps/api/src/ships/auto-layout.ts apps/api/src/ships/ships.service.ts apps/api/src/players/onboarding.service.ts apps/api/src/economy/inventory.service.ts apps/api/test/unit/ships/auto-layout.spec.ts
git commit -m "Close a Ship Format plan gap: thread formatCells (and connectorsByInstance) through auto-layout.ts"
```

**The one shared pattern, applied at every site below (Steps 1+):** wherever `installed: InstalledPart[]` is built from a ship's own `location === 'INSTALLED'` rows and then passed to `deriveSheet`, insert this immediately before the `deriveSheet` call:

```typescript
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(
      (ship.layout as unknown as Placement[]) ?? [],
      catalogForConnectivity,
      connectorsByInstance,
    );
    const installedConnected = applyConnectivity(installed, connectedIds);
```

...then change the `deriveSheet(installed, rules)` call immediately after to `deriveSheet(installedConnected, rules)`. The exact names `installed`/`installedRows`/`ship` vary slightly per file — each step below gives the real names for that file.

- [ ] **Step 1: `ships.service.ts` — `toResponse` and `preview`**

Add imports: `import { connectedPartIds } from './geometry.js';` (already imports from `./geometry.js`, add to that line) and `import { applyConnectivity } from './connectivity.js';` and `import type { ConnectorLayout } from '../parts/connectors.js';`.

In `toResponse` (around line 349-368, already modified by the Ship Format plan's Task 3 to load `format`), insert the shared pattern before `const sheet = deriveSheet(installed, rules);`:

```typescript
  private async toResponse(ship: Ship, rules: GameRules): Promise<ShipResponse> {
    const parts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const installedRows = parts.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    const installed = installedRows.map(toInstalledPart);
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(
      (ship.layout as unknown as Placement[]) ?? [],
      catalogForConnectivity,
      connectorsByInstance,
    );
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const activity = await this.activityOf(ship);
    const format = await this.prisma.shipFormat.findUniqueOrThrow({ where: { id: ship.formatId } });
    return {
      id: ship.id,
      ownerPlayerId: ship.ownerPlayerId,
      name: ship.name,
      fuel: ship.fuel,
      status: ship.status,
      currentLocationId: ship.currentLocationId,
      stance: ship.stance,
      layout: (ship.layout as unknown as Placement[]) ?? [],
      sheet,
      shipClass: deriveShipClass(installedConnected, rules),
      yard: { cells: format.cells as [number, number][] },
      disconnectedPartIds: installedRows
        .filter((row) => !connectedIds.has(row.id))
        .map((row) => row.id),
      activity,
    };
  }
```

(This replaces the version Ship Format's Task 3 wrote — same method, two plans both touch it; this is the final combined version. `deriveShipClass` also now receives `installedConnected` instead of `installed`, so a ship's class reflects what's actually working too.)

In `preview` (around line 143-183), the same pattern applies to BOTH branches (the caller-provided-`layout` branch and the auto-`arrange`d fallback) — but `preview` doesn't have a `ship.layout` to read from when the caller provides their OWN draft `layout` (that's the whole point of preview — testing a layout that may not be saved yet). Use the `effectiveLayout` variable this method already computes (whichever of the two branches produced it) instead of `ship.layout`:

```typescript
    const sheet = deriveSheet(installed, rules);
    const viability = checkViability(sheet, installed, rules);
    return {
      sheet,
      shipClass: deriveShipClass(installed, rules),
      viability,
      layout: effectiveLayout,
      omittedPartInstanceIds,
    };
```

becomes:

```typescript
    const installedRowsForConnectivity = playerParts.filter((row) =>
      effectiveLayout.some((p) => p.partInstanceId === row.id),
    );
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRowsForConnectivity.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(effectiveLayout, catalogForConnectivity, connectorsByInstance);
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const viability = checkViability(sheet, installedConnected, rules);
    return {
      sheet,
      shipClass: deriveShipClass(installedConnected, rules),
      viability,
      layout: effectiveLayout,
      omittedPartInstanceIds,
      disconnectedPartIds: installedRowsForConnectivity
        .filter((row) => !connectedIds.has(row.id))
        .map((row) => row.id),
    };
```

Leave `previewWithVirtualPart` untouched — it already explicitly documents that it "skips arrange()/assertLayoutValid() entirely," has no real grid slot for the virtual part, and connectivity has no meaning for a part that was never actually placed anywhere.

- [ ] **Step 2: Contract — `ShipResponse.disconnectedPartIds` and `PreviewResponse.disconnectedPartIds`**

The spec (`2026-10-02-connectors-v1-design.md`, API section) describes this as "`ShipResponse` and `PreviewResponse`'s per-part entries gain `connected: boolean` (alongside the existing `condition`/`broken`)." Checked against the actual current contract (`packages/contract/src/index.ts`): neither `ShipResponseSchema` nor `PreviewResponseSchema` has a per-part entries array at all today — `layout` on both is just `Placement[]` (`partInstanceId, gx, gy, rot`), with no `condition`/`broken` anywhere on either schema (those fields live only on the separate `InventoryItem`, returned by `GET /v1/inventory`). The spec's own description of the current shape doesn't match reality, so implementing it literally isn't possible without inventing a per-part array neither response has ever had. A ship-level `disconnectedPartIds: string[]` is the faithful equivalent of the spec's actual intent — "the response says which installed parts aren't contributing" — without introducing a new per-part array this plan would otherwise have to maintain in parallel with `layout`.

Open `packages/contract/src/index.ts`. Add to `ShipResponseSchema` (alongside `yard`):

```typescript
  /** Installed part instance ids with no compatible connector chain back to the bridge right
      now — still counted as mass/structure/HP, not contributing anything else. */
  disconnectedPartIds: z.array(z.string()),
```

Add the identical field to `PreviewResponseSchema` (alongside `omittedPartInstanceIds`):

```typescript
  disconnectedPartIds: z.array(z.string()),
```

- [ ] **Step 3: `dispatch.service.ts` — the viability check and the snapshot**

Add imports for `connectedPartIds`, `applyConnectivity`, `ConnectorLayout`.

Find the block (confirmed at this file's own lines ~215-225):

```typescript
      const rows = await this.parts.findPlayerParts(playerId, tx);
      const installedRows = rows.filter(
        (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
      );
      const installed = installedRows.map((part) => ({
        instance: part,
        catalog: pickCatalogStats(part.partCatalog),
      }));
      const sheet = deriveSheet(installed, rules);
      const viability = checkViability(sheet, installed, rules);
```

Change to:

```typescript
      const rows = await this.parts.findPlayerParts(playerId, tx);
      const installedRows = rows.filter(
        (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
      );
      const installed = installedRows.map((part) => ({
        instance: part,
        catalog: pickCatalogStats(part.partCatalog),
      }));
      const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
      const connectorsByInstance = new Map(
        installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
      );
      const connectedIds = connectedPartIds(
        (ship.layout as unknown as Placement[]) ?? [],
        catalogForConnectivity,
        connectorsByInstance,
      );
      const installed_ = applyConnectivity(installed, connectedIds);
      const sheet = deriveSheet(installed_, rules);
      const viability = checkViability(sheet, installed_, rules);
```

(Named `installed_` only to avoid shadowing/renaming every downstream reference to `installed` in this same method in one step — check what else in this method reads `installed` after this point (the snapshot-building block, Step 4 below) and use `installed_` there too, OR simply rename the original `const installed = ...` binding itself to e.g. `installedRaw` and call the connectivity-applied result `installed`, whichever reads more naturally against this file's own surrounding style — either is correct, pick one and apply it consistently within this one method.)

Then, in the same method's `DispatchSnapshot` construction (confirmed at this file's own lines ~246-260):

```typescript
        parts: installed.map((part) => ({
          id: part.instance.id,
          partType: part.instance.partType,
          condition: part.instance.condition,
          catalog: part.catalog,
        })),
```

Change to read from the connectivity-applied list and add the new field:

```typescript
        parts: installed_.map((part) => ({
          id: part.instance.id,
          partType: part.instance.partType,
          condition: part.instance.condition,
          catalog: part.catalog,
          connected: connectedIds.has(part.instance.id),
        })),
```

(Using `installed_`'s already-zeroed catalog here means `snapshot.parts[].catalog` reflects connectivity too — a disconnected part's snapshot already carries zeroed functional stats, so `resolution-input.ts` in Step 9 below needs no further zeroing, just needs to carry the new `connected` field through for v0.2's future use.)

Update `DispatchSnapshot`'s own interface (same file, confirmed at lines ~31-45):

```typescript
  readonly parts: ReadonlyArray<{
    readonly id: string;
    readonly partType: string;
    readonly condition: number;
    readonly catalog: ReturnType<typeof pickCatalogStats>;
  }>;
```

becomes:

```typescript
  readonly parts: ReadonlyArray<{
    readonly id: string;
    readonly partType: string;
    readonly condition: number;
    readonly catalog: ReturnType<typeof pickCatalogStats>;
    /** Connectors v0.1: whether this part had a compatible connector chain back to the bridge
        at dispatch time. Carried through for Connectors v0.2 (mid-mission disconnection,
        separate future spec) — not consumed by anything yet except being present in the
        stored snapshot. */
    readonly connected: boolean;
  }>;
```

- [ ] **Step 4: `scavenge-job.service.ts`, `mining-job.service.ts`, `travel.service.ts`**

Each of these 3 files has the identical shape at its own `deriveSheet` call (confirmed lines: `scavenge-job.service.ts:62-65`, `mining-job.service.ts:84-87`, `travel.service.ts:202-205`):

```typescript
    const installed = rows
      .filter((part) => part.location === 'INSTALLED' && part.shipId === ship.id)
      .map((part) => ({ instance: part, catalog: pickCatalogStats(part.partCatalog) }));
    const sheet = deriveSheet(installed, rules);
```

In each of the 3 files, change to:

```typescript
    const installedRows = rows.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    const installed = installedRows.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(
      (ship.layout as unknown as Placement[]) ?? [],
      catalogForConnectivity,
      connectorsByInstance,
    );
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
```

Also replace the `checkViability(sheet, installed, rules)` line immediately below (present in all 3 files) with `checkViability(sheet, installedConnected, rules)`. Confirmed via direct inspection of all 3 files: none of them use the `installed` binding again anywhere after that `checkViability` call — `scavenge-job.service.ts` moves on to cooldown bookkeeping, `mining-job.service.ts` only reads `sheet.min` afterward, `travel.service.ts` only reads `blockers`/`ship.status` afterward — so no further renames are needed in any of the 3 files beyond these two lines. Add the same 3 imports (`connectedPartIds`, `applyConnectivity`, `ConnectorLayout`) to each of the 3 files.

- [ ] **Step 5: `missions.service.ts` (3 call sites)**

This file has 3 separate `deriveSheet` calls (confirmed lines ~241, ~510, ~641). Apply the same pattern at each — the exact surrounding variable names differ per call site (`viewer.installed`/`viewer.ship` at two of them, a locally-built `installed` at the third); read each call site's own immediately-preceding 10 lines to find its own `ship`/`rows` names before inserting the shared pattern, following the exact same shape as Step 4 above. Add the same 3 imports once at the top of the file.

- [ ] **Step 6: `onboarding.service.ts`, `refuel.service.ts`, `inventory.service.ts` (3 call sites)**

Apply the same pattern to:
- `onboarding.service.ts`'s own `deriveSheet(installedParts, rules)` call (line ~139).
- `refuel.service.ts`'s `deriveSheet(installed, rules).fuelCap` call (line ~195) — note this one only reads `.fuelCap` off the result, which is a FUNCTIONAL stat (via `fuelCap` summing), so connectivity correctly changes this value too; keep the `.fuelCap` chain, just swap in the connectivity-applied `installed`.
- `inventory.service.ts`'s 3 call sites (lines ~47, ~82, ~120-121) — the `viabilityOf` private method (line ~120) is the one worth checking most carefully: confirm it already receives a `ship` (or can be given one) to read `.layout` from; if it's currently called with just a bare `parts: InstalledPart[]` and no ship/layout context, that's a sign this method's own signature needs a `ship: Ship` parameter added — check its callers before deciding, and if adding `ship` there, update every call site of `viabilityOf` in this same file too.

Add the same 3 imports to each of these 3 files.

- [ ] **Step 7: Create `resolution-input.spec.ts` — `buildResolveInput` has no test coverage at all today**

Confirmed via `grep -rln "buildResolveInput" apps/api/test` → zero matches: `resolution-input.ts` has never been unit-tested directly (only exercised indirectly through integration tests that dispatch a real mission). This step creates its first unit test file rather than extending an existing one.

`buildResolveInput`'s own `deriveSheet` call (`resolution-input.ts:129`) builds `installed: InstalledPart[]` directly from `snapshot.parts`, which — after Task 6 Step 3's change to `dispatch.service.ts` — already carries pre-zeroed catalog stats for any part that was disconnected at dispatch time (the snapshot is built from the connectivity-applied list, not the raw one). **No code change is needed in `resolution-input.ts` itself** — this test exists purely to pin that guarantee so a future refactor of either file can't silently break it.

Create `apps/api/test/unit/missions/resolution-input.spec.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import { buildResolveInput } from '../../../src/missions/resolution-input.js';
import type { DispatchSnapshot } from '../../../src/missions/dispatch.service.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';

function catalog(overrides: Partial<DispatchSnapshot['parts'][number]['catalog']> = {}) {
  return {
    partType: 'x',
    partClass: 'UTILITY' as const,
    w: 1,
    h: 1,
    mass: 5,
    structureCost: 3,
    partHp: 10,
    basePrice: 100,
    pot: 7,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
    fuelCap: 0,
    fuelUse: 0,
    batCharge: 0,
    batOutput: 0,
    batInput: 0,
    pressurized: false,
    lifeSupport: false,
    ...overrides,
  };
}

describe('buildResolveInput', () => {
  it("a disconnected part's functional stats are already zeroed in the resolved sheet (Connectors v0.1, via the dispatch snapshot)", () => {
    const snapshot: DispatchSnapshot = {
      shipId: 'ship-1',
      fuel: 100,
      currentLocationId: 'ceres',
      stance: 'NEUTRAL',
      parts: [
        {
          id: 'p-bridge',
          partType: 'bridge',
          condition: 100,
          catalog: catalog({ partClass: 'BRIDGE', mass: 10, structureCost: 10, partHp: 20, pot: 0 }),
          connected: true,
        },
        {
          id: 'p-disconnected-engine',
          partType: 'engine',
          condition: 100,
          // pot already zeroed here, exactly as dispatch.service.ts's applyConnectivity call
          // would have left it before storing the snapshot — mass/structureCost/partHp are
          // untouched (structural), pot (functional) is zero. This test asserts
          // buildResolveInput does no further processing of its own: it trusts the snapshot.
          catalog: catalog({ mass: 5, structureCost: 3, partHp: 10, pot: 0 }),
          connected: false,
        },
      ],
      legs: [],
    };
    const input = buildResolveInput({
      missionId: 'm-1',
      missionType: 'DELIVERY',
      seed: 'seed-1',
      snapshot,
      context: {
        isolation: 1,
        factionRelation: 'neutral',
        preset: 'CRUISE',
        missionOwner: null,
        missionForcesFlee: false,
        client: null,
      },
      rules: GAME_CONFIG_DEFAULTS,
    });
    expect(input.snapshot.sheet.pot).toBe(0);
    expect(input.snapshot.sheet.mass).toBe(15); // 10 (bridge) + 5 (disconnected engine, still structural)
  });

  it("a connected part's pot still counts normally (baseline, no regression)", () => {
    const snapshot: DispatchSnapshot = {
      shipId: 'ship-1',
      fuel: 100,
      currentLocationId: 'ceres',
      stance: 'NEUTRAL',
      parts: [
        {
          id: 'p-bridge',
          partType: 'bridge',
          condition: 100,
          catalog: catalog({ partClass: 'BRIDGE', mass: 10, structureCost: 10, partHp: 20, pot: 0 }),
          connected: true,
        },
        {
          id: 'p-connected-engine',
          partType: 'engine',
          condition: 100,
          catalog: catalog({ mass: 5, structureCost: 3, partHp: 10, pot: 7 }),
          connected: true,
        },
      ],
      legs: [],
    };
    const input = buildResolveInput({
      missionId: 'm-1',
      missionType: 'DELIVERY',
      seed: 'seed-1',
      snapshot,
      context: {
        isolation: 1,
        factionRelation: 'neutral',
        preset: 'CRUISE',
        missionOwner: null,
        missionForcesFlee: false,
        client: null,
      },
      rules: GAME_CONFIG_DEFAULTS,
    });
    expect(input.snapshot.sheet.pot).toBe(7);
  });
});
```

Run: `cd apps/api && npm run test:unit -- resolution-input.spec.ts`
Expected: PASS, both tests — this is intentionally written test-first-but-already-green, since Task 6 Step 3's `dispatch.service.ts` change (already committed earlier in this same task) is what makes it pass; there is no separate RED step here because the behavior under test lives entirely in a file (`resolution-input.ts`) this step deliberately does not modify. If either test fails, it means Step 3's snapshot construction is not actually pre-zeroing functional stats — treat that as a regression in Step 3, not a reason to add code here.

- [ ] **Step 8: Run the full API suites and typecheck**

Run: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: fully green/clean. This is the task where every remaining `validateLayout`/`deriveSheet` compile error from Tasks 3-5 should finally disappear — if anything still fails to compile, it's a caller this task's steps above missed; find it with `grep -rn "deriveSheet(" apps/api/src` and `grep -rn "validateLayout(" apps/api/src` and apply the same pattern.

- [ ] **Step 9: Add the integration tests proving the gates agree**

In `apps/api/test/integration/parts-ships.int-spec.ts`, add:

```typescript
  it('a disconnected part counts as mass/structure/hp but not its function (Connectors v0.1)', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const ship = asShip(await onboard(token, 'luna'));
    await assembleStarterKit(httpServer(testApp.app), token, ship.id);

    const before = asShip(
      await request(httpServer(testApp.app))
        .get(`/v1/ships/${ship.id}`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(before.disconnectedPartIds).toEqual([]);

    // Pick a non-bridge instance to corrupt — the bridge is always connected to itself (the
    // flood-fill's root), so corrupting it would prove nothing about this test's claim.
    const rows = await prisma.partInstance.findMany({
      where: { id: { in: before.layout.map((p) => p.partInstanceId) } },
      include: { partCatalog: true },
    });
    const bridgeId = rows.find((row) => row.partCatalog.partClass === 'BRIDGE')!.id;
    const targetId = before.layout.find((p) => p.partInstanceId !== bridgeId)!.partInstanceId;

    // Force this part's connectors to something that can never match its neighbors (every real
    // catalog part defaults to the universal fallback, so this directly fabricates a mismatch):
    // an explicit empty-cells layout — no side has anything, so none of its edges can ever be
    // compatible with a neighbor.
    await prisma.partInstance.update({
      where: { id: targetId },
      data: { connectors: { cells: [] } },
    });

    const beforeSheet = before.sheet;
    const after = asShip(
      await request(httpServer(testApp.app))
        .get(`/v1/ships/${ship.id}`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(after.disconnectedPartIds).toContain(targetId);
    expect(after.sheet.mass).toBe(beforeSheet.mass); // structural: unchanged
    expect(after.sheet.pot).toBeLessThanOrEqual(beforeSheet.pot); // functional: can only drop
  });

  it('saving a layout with a disconnected part succeeds (200), not the old DISCONNECTED 400 (Connectors v0.1)', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const ship = asShip(await onboard(token, 'luna'));
    await assembleStarterKit(httpServer(testApp.app), token, ship.id);
    const assembled = asShip(
      await request(httpServer(testApp.app))
        .get(`/v1/ships/${ship.id}`)
        .set('Authorization', `Bearer ${token}`),
    );

    const rows = await prisma.partInstance.findMany({
      where: { id: { in: assembled.layout.map((p) => p.partInstanceId) } },
      include: { partCatalog: true },
    });
    const bridgeId = rows.find((row) => row.partCatalog.partClass === 'BRIDGE')!.id;
    const targetId = assembled.layout.find((p) => p.partInstanceId !== bridgeId)!.partInstanceId;
    await prisma.partInstance.update({
      where: { id: targetId },
      data: { connectors: { cells: [] } },
    });

    // Re-POST the exact same layout now that one of its parts can never connect — this is the
    // save-layout path (`assemble`), not just a read: it must still return 200, since
    // Connectors v0.1 makes disconnection soft (never a save-time error).
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${ship.id}/assemble`)
      .set('Authorization', `Bearer ${token}`)
      .send({ layout: assembled.layout });
    expect(response.status).toBe(200);
    const saved = asShip(response);
    expect(saved.disconnectedPartIds).toContain(targetId);
  });
```

(Confirmed against the real controller: `POST :id/assemble` takes `AssembleDto` with a `layout` field and calls `shipsService.assemble(shipId, dto.layout)` — the route and body shape above match exactly.)

- [ ] **Step 10: Run the new tests to verify they pass, then run the full suites once more**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "Connectors v0.1" && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src packages/contract/src/index.ts apps/api/test
git commit -m "Thread connectivity through every real deriveSheet call site"
```

---

## Task 7: Admin — `connector-layout` field type on the `parts` entity

**Files:**
- Modify: `apps/api/src/admin/tuning/entity-schemas.ts`
- Test: `apps/api/test/integration/entity-tuning.int-spec.ts`

**Interfaces:**
- Produces: `EntityFieldType` gains `'connector-layout'`. The existing `parts` entity's field list gains a `connectorLayouts` field of that type.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/integration/entity-tuning.int-spec.ts`, extend `validPartPayload` (this file's own existing helper, confirmed to build a full valid part payload) — do not remove any existing field it sets, just add:

```typescript
    connectorLayouts: [
      { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] },
    ],
```

Then add new tests:

```typescript
  it('creates a part with connectorLayouts candidates', async () => {
    await seed(prisma);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(httpServer(testApp.app), admin);

    const response = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: validPartPayload('connector_test_part'), reason: 'test' });
    expect(response.status).toBe(201);
    const body = response.body as { row: { connectorLayouts: unknown } };
    expect(body.row.connectorLayouts).toEqual([
      { cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] },
    ]);
  });

  it('rejects a connector cell outside the part\'s own w x h footprint', async () => {
    await seed(prisma);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(httpServer(testApp.app), admin);

    const payload = validPartPayload('connector_oob_part');
    payload.w = 1;
    payload.h = 1;
    payload.connectorLayouts = [{ cells: [{ dx: 5, dy: 0, side: 'S', kind: 'central' }] }];
    const response = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: payload, reason: 'test' });
    expect(response.status).toBe(400);
  });
```

(`connectorLayouts` is optional on the entity, not required — check whether `validPartPayload`-built payloads from OTHER existing tests in this file that don't set it still pass; they should, since this field is optional.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && npm run test:int -- entity-tuning.int-spec.ts -t "connectorLayouts|connector cell outside"`
Expected: FAIL — `connectorLayouts` isn't a recognized field on the `parts` entity yet, and `'connector-layout'` isn't a valid `EntityFieldType`.

- [ ] **Step 3: Add the field type and validation**

Open `apps/api/src/admin/tuning/entity-schemas.ts`. Change:
```typescript
export type EntityFieldType =
  'string' | 'integer' | 'float' | 'boolean' | 'json' | 'enum' | 'locale-map';
```
to:
```typescript
export type EntityFieldType =
  'string' | 'integer' | 'float' | 'boolean' | 'json' | 'enum' | 'locale-map' | 'connector-layout';
```

(If the Ship Format plan's Task 5 already added `'grid-cells'` to this union, this becomes a THIRD variant alongside it: `'... | 'grid-cells' | 'connector-layout'`.)

In `buildBaseValidator`, add:
```typescript
    case 'connector-layout':
      return z.array(
        z.object({
          cells: z.array(
            z.object({
              dx: z.number().int(),
              dy: z.number().int(),
              side: z.enum(['N', 'E', 'S', 'W']),
              kind: z.enum(['none', 'central', 'split', 'universal']),
            }),
          ),
        }),
      );
```

This validates shape only (not the w×h footprint check, which needs the SAME payload's own `w`/`h` fields — a cross-field check `buildBaseValidator` can't express, since it validates one field in isolation). Add the footprint check to `entity-tuning.service.ts`'s existing `validateEntityRules` hook (the same extension point Ship Format's Task... wait, Ship Format didn't need this hook; this is the FIRST plan to use it in this session, but the hook itself already exists and is used by `routes`/`factions`/`mission-templates` today):

```typescript
    if (entity === 'parts' && data.connectorLayouts !== undefined) {
      this.validateConnectorLayouts(data);
    }
```

(Add this line inside the existing `validateEntityRules` method, alongside its existing `if (entity === 'routes')` / `if (entity === 'factions')` / `if (entity === 'mission-templates' ...)` checks.) Add the new private method near the others it sits beside (e.g. `validateRoute`):

```typescript
  private validateConnectorLayouts(data: Record<string, unknown>): void {
    const w = typeof data.w === 'number' ? data.w : undefined;
    const h = typeof data.h === 'number' ? data.h : undefined;
    if (w === undefined || h === undefined) return; // w/h themselves are separately required
    const layouts = data.connectorLayouts as Array<{ cells: Array<{ dx: number; dy: number }> }>;
    for (const layout of layouts) {
      for (const cell of layout.cells) {
        if (cell.dx < 0 || cell.dx >= w || cell.dy < 0 || cell.dy >= h) {
          throw new GameConfigValidationError(
            `connector cell (${cell.dx}, ${cell.dy}) is outside the part's ${w}x${h} footprint`,
            [{ key: 'connectorLayouts', message: 'cell outside part footprint' }],
          );
        }
      }
    }
  }
```

Add `connectorLayouts` to `PART_FIELDS`:
```typescript
  {
    name: 'connectorLayouts',
    type: 'connector-layout',
    required: false,
    description: localeMap(
      'Candidate connector layouts (one picked at random per instance)',
      'Layouts de conectores candidatos (um sorteado por instância)',
    ),
  },
```

- [ ] **Step 4: Run the tests from Step 1 to verify they pass**

Run: `cd apps/api && npm run test:int -- entity-tuning.int-spec.ts -t "connectorLayouts|connector cell outside"`
Expected: PASS.

- [ ] **Step 5: Run the full API suites and typecheck**

Run: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/admin/tuning apps/api/test/integration/entity-tuning.int-spec.ts
git commit -m "Admin: connector-layout field type and footprint validation on the parts entity"
```

---

## Task 8: Player-facing API — `InventoryItem.connectors`

**Files:**
- Modify: `apps/api/src/parts/parts.service.ts`
- Modify: `packages/contract/src/index.ts`
- Test: `apps/api/test/integration/parts-ships.int-spec.ts` (confirmed the right home: `grep -rln "v1/inventory" apps/api/test/integration` finds `contract.int-spec.ts`, `market.int-spec.ts`, and `parts-ships.int-spec.ts` — this file already has a `GET /v1/inventory after onboarding lists starter parts` test at line ~263, and is this plan's primary integration-test home throughout Task 6)

**Interfaces:**
- Produces: `InventoryItem.connectors: ConnectorCell[]` (empty array when the instance's own `connectors` column is `null` — the universal fallback is a property of the connectivity CHECK, not something the client needs materialized; the yard simply draws nothing extra for a part with an empty `connectors` list, same visual treatment either way since "universal" has no special glyph of its own planned in this plan — see Task 9).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/parts-ships.int-spec.ts`, in the same `describe` block as the existing `'GET /v1/inventory after onboarding lists starter parts'` test (confirming a freshly-onboarded, unassembled starter kit's `GET /v1/inventory` response includes a `connectors` field on every item, defaulting to `[]` for every starter part — none of which have catalog `connectorLayouts` authored in the base seed):

```typescript
  it('inventory items carry their own resolved connectors (round 11, Connectors v0.1)', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    await onboard(token, 'luna');

    const response = await request(httpServer(testApp.app))
      .get('/v1/inventory')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const items = response.body as Array<{ connectors: unknown[] }>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.connectors).toEqual([]); // universal fallback: nothing to draw
    }
  });
```

(Names match this file's own established helpers exactly — `freshSeededApp`, `seedAndToken`, `onboard`, `httpServer` — the same ones the existing test right above this one already uses.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "inventory items carry their own resolved connectors"`
Expected: FAIL — `item.connectors` is `undefined`.

- [ ] **Step 3: Update `parts.service.ts`**

Open `apps/api/src/parts/parts.service.ts`. Add `connectors: ConnectorCell[];` to the `InventoryItem` interface (near `broken`), and import `ConnectorCell` from `./connectors.js`.

In the `inventory()` method's `.map`, add:
```typescript
      connectors: ((row.connectors as { cells: ConnectorCell[] } | null)?.cells) ?? [],
```

(Alongside the existing `broken: row.condition <= ...` line.)

- [ ] **Step 4: Update the contract**

In `packages/contract/src/index.ts`, add near `InventoryItemSchema`:

```typescript
export const ConnectorCellSchema = z.object({
  dx: z.number(),
  dy: z.number(),
  side: z.enum(['N', 'E', 'S', 'W']),
  kind: z.enum(['none', 'central', 'split', 'universal']),
});
export type ConnectorCell = z.infer<typeof ConnectorCellSchema>;
```

Add to `InventoryItemSchema`:
```typescript
  connectors: z.array(ConnectorCellSchema),
```

- [ ] **Step 5: Run the test from Step 1 to verify it passes**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "inventory items carry their own resolved connectors"`
Expected: PASS.

- [ ] **Step 6: Run the full API suites and typecheck**

Run: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/parts/parts.service.ts packages/contract/src/index.ts apps/api/test
git commit -m "Expose each inventory item's own resolved connectors"
```

---

## Task 9: Web — connector glyphs, disconnected dimming, and the admin widget

**Files:**
- Modify: `apps/web/src/features/hangar/ship-yard.tsx`
- Modify: `apps/web/src/features/hangar/hangar.page.tsx`
- Modify: `apps/web/src/styles/index.css`
- Create: `apps/web/src/admin/tuning/ConnectorLayoutEditor.tsx`
- Modify: `apps/web/src/admin/tuning/SchemaForm.tsx`
- Test: `apps/web/src/features/hangar/hangar.spec.tsx`
- Test: `apps/web/src/admin/tuning/ConnectorLayoutEditor.spec.tsx`

**Interfaces:**
- Consumes: `InventoryItem.connectors`, `ShipResponse.disconnectedPartIds` from Task 6/8.

- [ ] **Step 1: Write the failing test for dimming a disconnected part**

Open `apps/web/src/features/hangar/hangar.spec.tsx`. Find wherever the file's own `ship()`-equivalent fixture lives (this file builds its own inline `http.get('/v1/ships', ...)` responses rather than importing a shared one — check Task 3's/Ship Format Task 6's own edits to this file for the pattern already established there). Add:

```typescript
  it('dims a disconnected part in the yard and notes the count on the Ship Sheet', async () => {
    server.use(
      onboarded(),
      http.get('/v1/ships', () =>
        HttpResponse.json([
          {
            id: 'ship-1',
            ownerPlayerId: 'player-1',
            name: 'luna starter',
            fuel: 40,
            status: 'IN_PORT',
            currentLocationId: 'ceres',
            stance: 'NEUTRAL',
            layout: [{ partInstanceId: 'part-bridge', gx: 0, gy: 0, rot: 0 }],
            sheet: testSheet,
            shipClass: 'MULTIROLE',
            yard: { cells: classicSquareCells() },
            disconnectedPartIds: ['part-bridge'],
            activity: { kind: 'idle', until: null, missionId: null },
          },
        ]),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    const block = document.querySelector('[data-part-id="part-bridge"]');
    expect(block).toHaveClass('disconnected');
    expect(screen.getByText(/1 part disconnected/i)).toBeInTheDocument();
  });
```

(Add `import { classicSquareCells } from '../../test/msw/handlers';` if not already imported from the Ship Format plan's own edits to this file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/features/hangar/hangar.spec.tsx -t "dims a disconnected part"`
Expected: FAIL — no `.disconnected` class, no "disconnected" text anywhere.

- [ ] **Step 3: Wire `disconnectedPartIds` into `ship-yard.tsx` and `hangar.page.tsx`**

Open `apps/web/src/features/hangar/ship-yard.tsx`. Add a new prop:
```typescript
  /** Instance ids with no compatible connector chain back to the bridge right now. */
  disconnectedPartIds?: ReadonlySet<string>;
```

In the `layout.map((placement) => ...)` block's `className` array for the block `<rect>` (the same array that already includes `look?.broken === true ? 'broken' : ''`), add:
```typescript
                  disconnectedPartIds?.has(placement.partInstanceId) === true ? 'disconnected' : '',
```

Open `apps/web/src/features/hangar/hangar.page.tsx`. Build a `Set` from `ship?.disconnectedPartIds` (mirroring the existing `yardCellSet` memo pattern from the Ship Format plan's Task 6):
```typescript
  const disconnectedPartIds = useMemo(
    () => new Set(ship?.disconnectedPartIds ?? []),
    [ship],
  );
```
Pass it to `<ShipYard disconnectedPartIds={disconnectedPartIds} .../>`.

Add a short note near the Ship Sheet heading (same area the ship-rarity badge was added in an earlier round this session) — conditionally, only when non-empty:
```tsx
      {disconnectedPartIds.size > 0 && (
        <p className="sub disconnected-note">
          {t('hangar.connectors.disconnectedCount', { count: disconnectedPartIds.size })}
        </p>
      )}
```

Add the i18n key to `apps/web/src/i18n/en.json` (near the `hangar` block):
```json
    "connectors": {
      "disconnectedCount": "{{count}} part disconnected",
      "disconnectedCount_other": "{{count}} parts disconnected"
    },
```
(Confirmed via `apps/web/package.json`: this project runs `i18next@^23.16.8`, which uses the CLDR-style `_one`/`_other` plural suffixes shown above, not the older v3-style `_plural` suffix — the keys as written are correct for this project's version.)

And to `apps/web/src/i18n/pt-BR.json`:
```json
    "connectors": {
      "disconnectedCount": "{{count}} peça desconectada",
      "disconnectedCount_other": "{{count}} peças desconectadas"
    },
```

- [ ] **Step 4: Add minimal CSS for `.disconnected`**

In `apps/web/src/styles/index.css`, near `svg .block` and `.block.broken` (search for `.broken` to find the existing rule):
```css
svg .block.disconnected {
  opacity: 0.45;
}
```

- [ ] **Step 5: Run the test from Step 1 to verify it passes**

Run: `cd apps/web && npx vitest run src/features/hangar/hangar.spec.tsx -t "dims a disconnected part"`
Expected: PASS.

- [ ] **Step 6: Write the failing test for the admin `ConnectorLayoutEditor`**

Create `apps/web/src/admin/tuning/ConnectorLayoutEditor.spec.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConnectorLayoutEditor } from './ConnectorLayoutEditor';

describe('ConnectorLayoutEditor', () => {
  it('renders one grid per candidate, sized to w x h', () => {
    render(
      <ConnectorLayoutEditor
        value={[{ cells: [] }]}
        w={2}
        h={1}
        onChange={vi.fn()}
      />,
    );
    // 2x1 footprint: 2 cells, each with 4 clickable sides.
    expect(screen.getAllByTestId(/connector-side-0-0-/)).toHaveLength(4);
    expect(screen.getAllByTestId(/connector-side-1-0-/)).toHaveLength(4);
  });

  it('cycles a side through none -> central -> split -> universal -> none on repeated clicks', () => {
    const onChange = vi.fn();
    render(<ConnectorLayoutEditor value={[{ cells: [] }]} w={1} h={1} onChange={onChange} />);
    const side = screen.getByTestId('connector-side-0-0-S-candidate-0');
    fireEvent.click(side);
    expect(onChange).toHaveBeenLastCalledWith([{ cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] }]);
  });

  it('adds a new candidate', () => {
    const onChange = vi.fn();
    render(<ConnectorLayoutEditor value={[{ cells: [] }]} w={1} h={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add candidate/i }));
    expect(onChange).toHaveBeenCalledWith([{ cells: [] }, { cells: [] }]);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/admin/tuning/ConnectorLayoutEditor.spec.tsx`
Expected: FAIL — the module doesn't exist.

- [ ] **Step 8: Write `ConnectorLayoutEditor`**

Create `apps/web/src/admin/tuning/ConnectorLayoutEditor.tsx`:

```typescript
type ConnectorKind = 'none' | 'central' | 'split' | 'universal';
type ConnectorSide = 'N' | 'E' | 'S' | 'W';
interface ConnectorCell {
  dx: number;
  dy: number;
  side: ConnectorSide;
  kind: ConnectorKind;
}
interface ConnectorLayout {
  cells: ConnectorCell[];
}

const CYCLE: ConnectorKind[] = ['none', 'central', 'split', 'universal'];
const SIDES: ConnectorSide[] = ['N', 'E', 'S', 'W'];

export interface ConnectorLayoutEditorProps {
  value: ConnectorLayout[] | undefined;
  w: number;
  h: number;
  onChange: (layouts: ConnectorLayout[]) => void;
}

function kindAt(layout: ConnectorLayout, dx: number, dy: number, side: ConnectorSide): ConnectorKind {
  return layout.cells.find((c) => c.dx === dx && c.dy === dy && c.side === side)?.kind ?? 'none';
}

function setKind(
  layout: ConnectorLayout,
  dx: number,
  dy: number,
  side: ConnectorSide,
  kind: ConnectorKind,
): ConnectorLayout {
  const rest = layout.cells.filter((c) => !(c.dx === dx && c.dy === dy && c.side === side));
  return kind === 'none' ? { cells: rest } : { cells: [...rest, { dx, dy, side, kind }] };
}

// One small grid per candidate layout, click a cell's side to cycle its connector kind
// (2026-10-02-connectors-v1-design.md). Each candidate is a complete layout the random roll
// at instance-creation time can pick from whole.
export function ConnectorLayoutEditor({ value, w, h, onChange }: ConnectorLayoutEditorProps) {
  const layouts = value ?? [{ cells: [] }];

  const cycleSide = (candidateIndex: number, dx: number, dy: number, side: ConnectorSide) => {
    const layout = layouts[candidateIndex]!;
    const current = kindAt(layout, dx, dy, side);
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]!;
    const updated = [...layouts];
    updated[candidateIndex] = setKind(layout, dx, dy, side, next);
    onChange(updated);
  };

  return (
    <div className="connector-layout-editor">
      {layouts.map((layout, candidateIndex) => (
        <div key={candidateIndex} className="connector-candidate">
          {Array.from({ length: h }, (_, dy) => (
            <div key={dy} className="connector-cell-row">
              {Array.from({ length: w }, (_, dx) => (
                <div key={dx} className="connector-cell">
                  {SIDES.map((side) => (
                    <button
                      key={side}
                      type="button"
                      data-testid={`connector-side-${dx}-${dy}-${side}-candidate-${candidateIndex}`}
                      className={`connector-side connector-side-${side} connector-kind-${kindAt(layout, dx, dy, side)}`}
                      onClick={() => cycleSide(candidateIndex, dx, dy, side)}
                    >
                      {kindAt(layout, dx, dy, side) !== 'none' ? kindAt(layout, dx, dy, side)[0] : ''}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...layouts, { cells: [] }])}>
        Add candidate
      </button>
    </div>
  );
}
```

- [ ] **Step 9: Run the tests from Step 6 to verify they pass**

Run: `cd apps/web && npx vitest run src/admin/tuning/ConnectorLayoutEditor.spec.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 10: Wire it into `SchemaForm.tsx`**

Open `apps/web/src/admin/tuning/SchemaForm.tsx`. Import `ConnectorLayoutEditor`. In `renderInput`, add:
```typescript
    if (field.type === 'connector-layout') {
      return (
        <ConnectorLayoutEditor
          value={value as ConnectorLayout[] | undefined}
          w={typeof values.w === 'number' ? values.w : 1}
          h={typeof values.h === 'number' ? values.h : 1}
          onChange={(layouts) => handleChange(field.name, layouts)}
        />
      );
    }
```

(`values.w`/`values.h` read this SAME form's own other field values — the part entity's `w`/`h` fields, already present in `values` since they're siblings on the same `parts` entity form. Import `ConnectorLayout` as a type from wherever `ConnectorLayoutEditor.tsx` exports it, or inline the same small type shape.)

- [ ] **Step 11: Run the full web suite and typecheck**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/features/hangar apps/web/src/admin/tuning apps/web/src/styles/index.css apps/web/src/i18n
git commit -m "Web: connector glyphs, disconnected dimming, and the admin connector-layout widget"
```

---

## Final Integration Check

- [ ] Run the complete suite end to end: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`, then `cd apps/web && npx vitest run && npx tsc --noEmit -p tsconfig.json`.
- [ ] Rebuild and restart the docker dev stack, then live-verify: an admin can author two connector-layout candidates for a part type; a freshly-bought instance of that type shows one of them; placing it next to another part with no compatible connector dims it in the yard and reduces the ship's functional stats (mobility, firepower, etc.) while mass/structure/HP stay the same; the Ship Sheet shows the disconnected count; the layout still saves successfully (no error) the whole time.
