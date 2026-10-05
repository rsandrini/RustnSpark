# Ship Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 20×20 square assembly grid with an admin-drawn, named `ShipFormat` (a set of grid cells, anchored on the bridge) that a player selects independently of their installed bridge, gated by that bridge's rarity.

**Architecture:** A new `ShipFormat` table holds each format's cell set (`[[x,y],...]`, relative to the bridge at `(0,0)`) and a `minRarity` gate. `Ship` gains a `formatId` FK (defaulting to a seeded `classic_square` format that exactly reproduces today's grid). Placement validation (`validateLayout`) swaps its fixed-bounds check for format-cell-set membership; everything else about layout validation (overlap, bridge-reachability) is untouched. The admin draws formats through the existing generic entity-tuning system (one new field type, no new admin page); the player picks a format through a new small picker in Hangar.

**Tech Stack:** NestJS + Prisma (API), React + Vite (web), Zod (shared contract), Jest (API tests), Vitest (web tests).

**Spec:** `docs/superpowers/specs/2026-10-02-ship-format-design.md`

## Global Constraints

- Format is purely spatial: it never adds its own stats (no structure/mass bonus). Ship stats keep coming entirely from installed parts.
- The admin drawing canvas ceiling is `[-15, 15)` on both axes — enforced server-side, not just client-side.
- Every format's cell set must include `[0, 0]` (the bridge's anchor cell).
- `minRarity` uses the existing `Rarity` enum (`COMMON < UNCOMMON < RARE < EPIC < LEGENDARY`), same ordering already used by `part-upgrade.calculator.ts`.
- No retroactive effect on existing ships beyond the one-time `classic_square` backfill — the migration must not change any existing ship's buildable shape.
- Switching to a format that no longer fits the current layout always succeeds; any now-out-of-shape placement is dropped to inventory, exactly like manually removing that part (same persisted result, not a new removal code path).
- This plan does not touch bridge-reachability (`DISCONNECTED`) or anything in the Connectors v0.1 spec — those are untouched by Ship Format.

## Review Focus

1. A ship with **no bridge installed** (loose starter kit) must still see `classic_square` (and any other `minRarity: COMMON` format) in its unlocked list — `GET /v1/ship-formats` must not throw or return an empty list just because there's no bridge yet.
2. Switching format must **re-validate the full current layout**, not just newly-placed cells — a part placed long before the switch, now outside the new shape, must be dropped exactly like one placed moments ago.
3. The admin drawing tool's ±15 ceiling and `[0,0]`-required rule must be enforced by the **API**, not only the widget — a direct `POST`/`PATCH` to the entity-tuning endpoint with an out-of-bounds or `[0,0]`-missing cell list must be rejected.
4. Retiring a format (`active: false`) must not affect ships currently using it — only new format-selection lists filter by `active`.
5. The migration backfill must produce **exactly** today's 400-cell square (`-10 <= x < 10`, `-10 <= y < 10`) — an off-by-one here would silently shrink or grow every existing ship's buildable area.

---

## Task 1: `ShipFormat` table, `Ship.formatId`, and the `classic_square` seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/0032_ship_format/migration.sql`
- Create: `apps/api/prisma/seed-data/ship-formats.ts`
- Modify: `apps/api/prisma/seed.ts`
- Test: `apps/api/test/integration/seed.int-spec.ts`

**Interfaces:**
- Produces: Prisma model `ShipFormat { id: String, displayName: Json, description: Json, cells: Json, minRarity: Rarity, active: Boolean }`; `Ship.formatId: String` (FK to `ShipFormat.id`, default `"classic_square"`).
- Produces: `seedShipFormats(prisma: PrismaClient): Promise<void>` exported from `prisma/seed-data/ship-formats.ts`, called from `prisma/seed.ts`'s `seed()`.

- [ ] **Step 1: Add the `ShipFormat` model and `Ship.formatId` to `schema.prisma`**

Open `apps/api/prisma/schema.prisma` and find the `Ship` model (search for `model Ship {`). Add a new model right before it, and add the new field + relation inside `Ship`:

```prisma
model ShipFormat {
  id          String   @id
  displayName Json
  description Json
  cells       Json
  minRarity   Rarity
  active      Boolean  @default(true)
  ships       Ship[]
}

model Ship {
  id                String            @id @default(dbgenerated("gen_random_uuid()"))
  ownerPlayerId     String
  name              String
  layout            Json
  // ...every existing field stays exactly as it is...
  formatId          String            @default("classic_square")
  format            ShipFormat        @relation(fields: [formatId], references: [id])
}
```

(Do not retype every existing `Ship` field from memory — open the file, find the real field list, and insert `formatId`/`format` alongside it without disturbing anything else.)

- [ ] **Step 2: Write the migration SQL**

Create `apps/api/prisma/migrations/0032_ship_format/migration.sql`:

```sql
-- Ship Format: an admin-drawn set of grid cells a player picks independently of their bridge,
-- gated by that bridge's rarity (2026-10-02-ship-format-design.md). Purely spatial — no stats
-- of its own. classic_square reproduces today's exact 20x20 grid so no existing ship changes
-- shape; every existing Ship is backfilled onto it by its new column's own default.
--
-- classic_square's row is inserted HERE, not left to seed-data: this database already has
-- existing Ship rows (this is a running dev environment, not a fresh install), and Postgres
-- validates a new FOREIGN KEY constraint against every existing row in the same statement —
-- the ADD CONSTRAINT below would fail immediately if classic_square didn't already exist by
-- then. seed-data/ship-formats.ts (Step 3) still runs this same insert, idempotently, purely
-- so a from-scratch `prisma migrate deploy && prisma db seed` on a fresh database documents
-- the format the same way every other seeded catalog row is documented in seed-data/ — but
-- the migration itself cannot depend on seed-data having already run.

CREATE TABLE "ShipFormat" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "cells" JSONB NOT NULL,
    "minRarity" "Rarity" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShipFormat_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ShipFormat" ("id", "displayName", "description", "cells", "minRarity", "active")
VALUES (
    'classic_square',
    '{"en": "Classic Square", "pt-BR": "Quadrado Clássico"}',
    '{"en": "The original 20x20 assembly grid, unlocked from the start.", "pt-BR": "A grade de montagem 20x20 original, disponível desde o início."}',
    (
        SELECT jsonb_agg(jsonb_build_array(x.n, y.n))
        FROM generate_series(-10, 9) AS x(n), generate_series(-10, 9) AS y(n)
    ),
    'COMMON',
    true
);

ALTER TABLE "Ship" ADD COLUMN "formatId" TEXT NOT NULL DEFAULT 'classic_square';

ALTER TABLE "Ship" ADD CONSTRAINT "Ship_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "ShipFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

The `ALTER TABLE "Ship" ADD COLUMN ... DEFAULT 'classic_square'` backfills every existing row's new column in this same statement (Postgres fills a new NOT NULL column with its default for all existing rows as part of the ALTER TABLE), and by the time the next statement adds the FK constraint, `classic_square` already exists — so the constraint's validation against every existing `Ship` row succeeds.

- [ ] **Step 3: Write the seed data (idempotent — the migration above already inserted this row)**

Create `apps/api/prisma/seed-data/ship-formats.ts`, matching the exact same `classic_square` content the migration just inserted directly:

```typescript
import type { PrismaClient } from '@prisma/client';

function classicSquareCells(): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = -10; y < 10; y += 1) {
    for (let x = -10; x < 10; x += 1) {
      cells.push([x, y]);
    }
  }
  return cells;
}

export async function seedShipFormats(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.shipFormat.findUnique({ where: { id: 'classic_square' } });
  if (existing !== null) return;
  await prisma.shipFormat.create({
    data: {
      id: 'classic_square',
      displayName: { en: 'Classic Square', 'pt-BR': 'Quadrado Clássico' },
      description: {
        en: 'The original 20x20 assembly grid, unlocked from the start.',
        'pt-BR': 'A grade de montagem 20x20 original, disponível desde o início.',
      },
      cells: classicSquareCells(),
      minRarity: 'COMMON',
      active: true,
    },
  });
}
```

- [ ] **Step 4: Call the new seeder from `seed.ts`**

Open `apps/api/prisma/seed.ts`, find the `seed()` function and its other `seedX(prisma)` calls (e.g. `seedMissionTemplates`, visible from the earlier-round `mining_job_generic` addition this session). Add:

```typescript
import { seedShipFormats } from './seed-data/ship-formats.js';
// ...
await seedShipFormats(prisma);
```

Ordering relative to other seed steps doesn't matter here — the migration already guaranteed `classic_square` exists before any `Ship` row could reference it; this call is a no-op on every environment except a from-scratch database seeded without ever having run this migration's `INSERT` (which cannot happen through this project's normal `migrate deploy` → `db seed` boot order, but costs nothing to keep as a documented, idempotent safety net).

- [ ] **Step 5: Run the migration and regenerate the Prisma client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: migration `0032_ship_format` applies with no errors; `@prisma/client` regenerates with `ShipFormat` and `Ship.formatId`/`Ship.format` typed.

- [ ] **Step 6: Write the failing test for the backfill**

Open `apps/api/test/integration/seed.int-spec.ts`. In the existing `'seeds the expected catalog and world row counts'` test, add:

```typescript
    const classicSquare = await prisma.shipFormat.findUnique({ where: { id: 'classic_square' } });
    expect(classicSquare).not.toBeNull();
    expect((classicSquare!.cells as [number, number][]).length).toBe(400);
    expect(classicSquare!.minRarity).toBe('COMMON');
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd apps/api && npm run test:int -- seed.int-spec.ts -t "seeds the expected"`
Expected: FAIL — `prisma.shipFormat` does not exist yet, or `classicSquare` is null (if Steps 1-5 were somehow skipped; if they were done, this should already pass — if so, skip to Step 9 and note the discrepancy in your ledger).

- [ ] **Step 8: Confirm it passes**

Run: `cd apps/api && npm run test:int -- seed.int-spec.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 9: Commit**

```bash
cd apps/api
git add prisma/schema.prisma prisma/migrations/0032_ship_format prisma/seed-data/ship-formats.ts prisma/seed.ts test/integration/seed.int-spec.ts
git commit -m "Add ShipFormat table, Ship.formatId, and the classic_square seed"
```

---

## Task 2: Format-aware placement bounds in `geometry.ts`

**Files:**
- Modify: `apps/api/src/ships/geometry.ts`
- Modify: `apps/api/test/unit/ships/geometry.spec.ts` (this file **already exists** with 6 tests calling `validateLayout(placements, catalog)` — two arguments. All 6 need a third argument added once Step 3 lands, or they fail to compile.)

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task is pure geometry logic, format cells are passed in as plain data by its caller in Task 3).
- Produces: `validateLayout(placements: Placement[], catalog: ReadonlyMap<string, PartCatalog>, formatCells: ReadonlySet<string>): LayoutError[]` — same name, new required third parameter. `cellKey(x: number, y: number): string` — exported helper (`` `${x},${y}` ``, matching the key format `occupied` already uses internally) so callers can build a `formatCells` set from a raw `[number, number][]` array.

- [ ] **Step 1: Write the failing tests**

Open the existing `apps/api/test/unit/ships/geometry.spec.ts`. It defines one `catalog` map (bridge + hull) shared by all 6 existing tests, each calling `validateLayout(placements, catalog)`. Add a cell set matching what those tests actually need — every existing test places parts within `gx`/`gy` in `[-16, 17]` (the out-of-bounds test uses `gx: 16`), so a cell set reproducing the real `classic_square`-sized bound (`[-10, 10)`) would break the "out of bounds" test's assumption that `gx: 15` is in-bounds. Give the existing tests a generously-sized square (`[-20, 20)`) so none of their existing in-bounds/out-of-bounds assumptions change, and add this plan's new format-specific tests in a second `describe` block using a tighter, irregular shape to prove the format (not just a bigger square) is actually respected:

```typescript
import { describe, expect, it } from '@jest/globals';
import { cellKey, validateLayout } from '../../../src/ships/geometry.js';
import type { PartCatalog, Placement } from '../../../src/parts/part.types.js';

describe('validateLayout', () => {
  const catalog: ReadonlyMap<string, PartCatalog> = new Map([
    [
      'bridge',
      {
        partType: 'bridge',
        partClass: 'BRIDGE',
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
      },
    ],
    [
      'hull',
      {
        partType: 'hull',
        partClass: 'DEFENSE',
        w: 2,
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
      },
    ],
  ]);

  // Generous square matching every existing test's own in-bounds/out-of-bounds assumptions
  // below (the "out of bounds" test places a part at gx: 16, which must stay out of THIS set
  // while gx: 15 — used by the same test's bridge placement — must stay inside it).
  function wideSquareCells(): Set<string> {
    const cells = new Set<string>();
    for (let y = -20; y < 20; y += 1) {
      for (let x = -20; x < 20; x += 1) {
        cells.add(cellKey(x, y));
      }
    }
    return cells;
  }
  const cells = wideSquareCells();

  it('accepts a valid connected layout', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 1, gy: 0, rot: 0 },
    ];
    expect(validateLayout(placements, catalog, cells)).toEqual([]);
  });

  it('rejects overlapping parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });

  it('rejects disconnected parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 5, gy: 5, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('DISCONNECTED');
  });

  it('rejects parts placed out of bounds', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 15, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 16, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('OUT_OF_BOUNDS');
  });

  it('supports 90-degree rotation swapping dimensions', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: -2, rot: 90 },
    ];
    expect(validateLayout(placements, catalog, cells)).toEqual([]);
  });

  it('detects overlap caused by rotation', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 90 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });
});

describe('validateLayout — format cell bounds', () => {
  const bridgeOnly: ReadonlyMap<string, PartCatalog> = new Map([
    [
      'p-bridge',
      {
        partType: 'bridge',
        partClass: 'BRIDGE',
        w: 1,
        h: 1,
        mass: 1,
        structureCost: 10,
        partHp: 10,
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
      },
    ],
  ]);
  // A small cross: (0,0) is the bridge's own cell, plus the four neighbors.
  const CROSS_CELLS = new Set(['0,0', '1,0', '-1,0', '0,1', '0,-1']);

  it('accepts a part inside the format shape', () => {
    const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 }];
    expect(validateLayout(placements, bridgeOnly, CROSS_CELLS)).toEqual([]);
  });

  it('rejects a cell outside the format shape, even though it would fit a plain square', () => {
    // (1,1) is inside a 20x20 square but NOT one of the cross's cells.
    const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx: 1, gy: 1, rot: 0 }];
    const errors = validateLayout(placements, bridgeOnly, CROSS_CELLS);
    expect(errors).toEqual([
      { code: 'OUT_OF_BOUNDS', partInstanceId: 'p-bridge', message: expect.any(String) },
    ]);
  });

  it('accepts every arm of the cross', () => {
    for (const [gx, gy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx, gy, rot: 0 }];
      expect(validateLayout(placements, bridgeOnly, CROSS_CELLS)).toEqual([]);
    }
  });
});

describe('cellKey', () => {
  it('matches the key format used to build a format cell set', () => {
    expect(cellKey(3, -2)).toBe('3,-2');
  });
});
```

This fully replaces the existing file's content (the first `describe` block is the original 6 tests with `cells` threaded in; the other two `describe` blocks are new).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npm run test:unit -- geometry.spec.ts`
Expected: FAIL — `validateLayout` only takes 2 arguments today (TS error) and `cellKey` doesn't exist.

- [ ] **Step 3: Update `validateLayout` to take format cells**

Open `apps/api/src/ships/geometry.ts`. Replace the whole file's bounds logic:

```typescript
import type { PartCatalog, Placement, LayoutError } from '../parts/part.types.js';

/** Yard cells run [-GRID_HALF_SIZE, GRID_HALF_SIZE) on both axes — retained only as the admin
    format-drawing tool's canvas ceiling (apps/web's grid editor), not a gameplay constant
    anymore: which cells actually exist now comes from the ship's own ShipFormat. */
export const GRID_HALF_SIZE = 10;
const RIGHT_ANGLE = 90;

/** The same "x,y" key format `validateLayout`'s internal occupancy map already used — exported
    so callers can turn a format's raw `[[x,y],...]` cell list into the Set this function needs. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function validateLayout(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string>,
): LayoutError[] {
  const errors: LayoutError[] = [];
  const occupied = new Map<string, string>();
  const placedIds = new Set(placements.map((p) => p.partInstanceId));

  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined) {
      errors.push({
        code: 'DISCONNECTED',
        partInstanceId: placement.partInstanceId,
        message: `Unknown part instance: ${placement.partInstanceId}`,
      });
      continue;
    }

    const width = placement.rot === RIGHT_ANGLE ? part.h : part.w;
    const height = placement.rot === RIGHT_ANGLE ? part.w : part.h;

    for (let dx = 0; dx < width; dx += 1) {
      for (let dy = 0; dy < height; dy += 1) {
        const x = placement.gx + dx;
        const y = placement.gy + dy;
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
        if (existing !== undefined && existing !== placement.partInstanceId) {
          if (!hasError(errors, 'OVERLAP')) {
            errors.push({
              code: 'OVERLAP',
              partInstanceId: placement.partInstanceId,
              message: `Part ${placement.partInstanceId} overlaps ${existing}.`,
            });
          }
        }
        occupied.set(key, placement.partInstanceId);
      }
    }
  }

  const bridgePlacement = placements.find((p) => {
    const part = catalog.get(p.partInstanceId);
    return part?.partClass === 'BRIDGE';
  });

  if (placements.length > 0 && bridgePlacement === undefined) {
    errors.push({ code: 'DISCONNECTED', message: 'No bridge found in layout.' });
  }

  if (bridgePlacement !== undefined && placements.length > 1) {
    const reachable = reachablePartIds(occupied, bridgePlacement);
    for (const id of placedIds) {
      if (!reachable.has(id)) {
        if (!hasError(errors, 'DISCONNECTED')) {
          errors.push({
            code: 'DISCONNECTED',
            message: 'Some parts are not connected to the bridge.',
          });
        }
        break;
      }
    }
  }

  return errors;
}

function hasError(errors: LayoutError[], code: LayoutError['code']): boolean {
  return errors.some((error) => error.code === code);
}

function reachablePartIds(occupied: ReadonlyMap<string, string>, start: Placement): Set<string> {
  const startKey = cellKey(start.gx, start.gy);
  if (!occupied.has(startKey)) {
    return new Set();
  }

  const visitedCells = new Set<string>();
  const reachableParts = new Set<string>();
  const queue: string[] = [startKey];
  visitedCells.add(startKey);

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const partId = occupied.get(cell);
    if (partId !== undefined) {
      reachableParts.add(partId);
    }
    for (const neighbor of edgeNeighbors(cell)) {
      if (!occupied.has(neighbor) || visitedCells.has(neighbor)) {
        continue;
      }
      visitedCells.add(neighbor);
      queue.push(neighbor);
    }
  }

  return reachableParts;
}

function edgeNeighbors(cell: string): string[] {
  const [xRaw, yRaw] = cell.split(',');
  const x = Number(xRaw);
  const y = Number(yRaw);
  return [cellKey(x + 1, y), cellKey(x - 1, y), cellKey(x, y + 1), cellKey(x, y - 1)];
}
```

(This is the full file — the only behavioral changes from today are: the bounds check now tests `formatCells.has(key)` instead of comparing against `GRID_HALF_SIZE`, and the three inline `` `${x},${y}` `` key constructions are replaced with the exported `cellKey` helper so Task 3 can build a matching Set. Bridge-reachability/`DISCONNECTED` logic is untouched, per this plan's Global Constraints.)

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd apps/api && npm run test:unit -- geometry.spec.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Run the full unit suite to confirm no regression**

Run: `cd apps/api && npm run test:unit`
Expected: Every OTHER caller of `validateLayout` currently fails to compile (it's called from `ships.service.ts` with only 2 arguments) — this is expected and fixed in Task 3. If the TypeScript project reference causes `test:unit` itself to fail to build, note that in your ledger and proceed to Task 3 immediately; do not attempt to make `ships.service.ts` compile from inside this task.

- [ ] **Step 6: Commit**

```bash
cd apps/api
git add src/ships/geometry.ts test/unit/ships/geometry.spec.ts
git commit -m "geometry: validateLayout takes the ship's format cells, not a fixed square"
```

---

## Task 3: Thread format cells through `ships.service.ts`; expose `yard.cells` in the contract

**Files:**
- Modify: `apps/api/src/ships/ships.service.ts`
- Modify: `packages/contract/src/index.ts`
- Modify: `apps/api/test/integration/parts-ships.int-spec.ts`

**Interfaces:**
- Consumes: `validateLayout(placements, catalog, formatCells: ReadonlySet<string>)` and `cellKey` from Task 2.
- Produces: `ShipResponse.yard: { cells: [number, number][] }` (replaces `{ halfSize: number }`) in both the API's `ShipsService.toResponse` and the shared contract.

- [ ] **Step 1: Add `yard` to the test file's local `ShipResponse` type**

Open `apps/api/test/integration/parts-ships.int-spec.ts`. Its own local `ShipResponse` interface (near the top of the file, alongside `SheetShape`/`PreviewResponse`) has no `yard` field at all yet. Add one:

```typescript
interface ShipResponse {
  id: string;
  ownerPlayerId: string;
  name: string;
  fuel: number;
  status: string;
  currentLocationId: string;
  stance: string;
  layout: Array<Record<string, unknown>>;
  sheet: SheetShape;
  yard: { cells: [number, number][] };
}
```

- [ ] **Step 2: Write the failing test**

In the same file, inside the `describe('onboarding', ...)` block (near its other tests — this is the block that already onboards a player and assembles the starter kit), add:

```typescript
    it('yard reports the ship\'s format cells, not a fixed square (round-11, Ship Format)', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();
      const ship = asShip(await onboard(token, 'luna'));

      const response = await request(httpServer(testApp.app))
        .get(`/v1/ships/${ship.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      const body = asShip(response);
      expect(body.yard.cells).toHaveLength(400);
      expect(body.yard.cells).toContainEqual([0, 0]);
      expect(body.yard.cells).toContainEqual([-10, -10]);
      expect(body.yard.cells).not.toContainEqual([10, 10]); // half-open upper bound
    });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "yard reports the ship's format cells"`
Expected: FAIL — `body.yard.cells` is `undefined` (the response still sends `halfSize`), or a TS compile error from Step 1's new field not matching the real (still `halfSize`-shaped) response yet — either is the expected failure at this point.

- [ ] **Step 4: Update `ships.service.ts`**

Open `apps/api/src/ships/ships.service.ts`.

Replace the import:
```typescript
import { GRID_HALF_SIZE } from './geometry.js';
```
with:
```typescript
import { cellKey, validateLayout } from './geometry.js';
```
(`validateLayout` was already imported separately below — remove the now-duplicate `import { validateLayout } from './geometry.js';` line a few lines down, so `geometry.js` is imported once.)

Add a private helper near `loadShipWithRules` (around line 246):

```typescript
  private async loadFormatCells(formatId: string): Promise<Set<string>> {
    const format = await this.prisma.shipFormat.findUniqueOrThrow({ where: { id: formatId } });
    const cells = format.cells as [number, number][];
    return new Set(cells.map(([x, y]) => cellKey(x, y)));
  }
```

Update `assertLayoutValid` (around line 258) to accept and use it — change its signature and the one call to `validateLayout` inside it:

```typescript
  private assertLayoutValid(
    layout: Placement[],
    playerParts: PartInstanceWithCatalog[],
    shipId: string,
    formatCells: ReadonlySet<string>,
  ): void {
    const layoutIds = new Set(layout.map((placement) => placement.partInstanceId));
    if (layoutIds.size !== layout.length) {
      throw new BadRequestException({
        error: 'INVALID_LAYOUT',
        message: 'duplicate part instance in layout',
      });
    }

    for (const placement of layout) {
      const part = playerParts.find((p) => p.id === placement.partInstanceId);
      if (!part) {
        throw new ForbiddenException('layout references a part not owned by player');
      }
      if (part.location === 'INSTALLED' && part.shipId !== shipId) {
        throw new ConflictException('part is installed in another ship');
      }
    }

    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const geometryErrors = validateLayout(layout, catalogMap, formatCells);
    if (geometryErrors.length > 0) {
      throw new BadRequestException({
        error: 'INVALID_LAYOUT',
        problems: geometryErrors.map((error) => ({ code: error.code, message: error.message })),
      });
    }
  }
```

Update every call site of `assertLayoutValid` to pass the ship's format cells — there are three (`assemble`, `autoAssemble`, `preview`'s layout branch). Each already has `ship` in scope from `loadShipWithRules`/`loadShip`. For each call site, load the cells first:

In `assemble` (around line 101-106):
```typescript
  async assemble(shipId: string, layout: Placement[]): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const formatCells = await this.loadFormatCells(ship.formatId);
    this.assertLayoutValid(layout, playerParts, shipId, formatCells);
    // ...rest of the method is unchanged...
```

In `autoAssemble` (around line 120-134), same pattern — add the `loadFormatCells` call right before its existing `assertLayoutValid` call and pass it through.

In `preview` (around line 143-172), the layout-provided branch calls `assertLayoutValid` twice (once for the caller-provided `layout`, once for the auto-`arrange`d fallback) — both need the same `formatCells`, loaded once at the top of the method body (right after `loadShipWithRules`/`findPlayerParts`), reused for both branches.

Update `toResponse` (around line 349-368) to build `yard.cells` instead of `yard.halfSize`:

```typescript
  private async toResponse(ship: Ship, rules: GameRules): Promise<ShipResponse> {
    const parts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const installed = parts
      .filter((part) => part.location === 'INSTALLED' && part.shipId === ship.id)
      .map(toInstalledPart);
    const sheet = deriveSheet(installed, rules);
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
      shipClass: deriveShipClass(installed, rules),
      yard: { cells: format.cells as [number, number][] },
      activity,
    };
  }
```

- [ ] **Step 5: Update the contract**

Open `packages/contract/src/index.ts`. Find `ShipResponseSchema` (around line 183-203). Replace:
```typescript
  /** The assembly yard: cells run [-halfSize, halfSize) on both axes. */
  yard: z.object({ halfSize: z.number() }),
```
with:
```typescript
  /** The assembly yard: exactly these cells (relative to the bridge at [0,0]) are buildable —
      the ship's own ShipFormat selection, not a fixed bound. */
  yard: z.object({ cells: z.array(z.tuple([z.number(), z.number()])) }),
```

- [ ] **Step 6: Fix every web test fixture that builds a raw `yard: { halfSize: 10 }`**

There are exactly 6 occurrences across the web test suite (confirmed by `grep -rln "halfSize" apps/web/src` at plan-writing time): `apps/web/src/test/msw/handlers.ts` (two — the shared `ship()` fixture function, and one inline `ok<ShipResponse>({...})` response in a different handler), `apps/web/src/features/hangar/hangar.spec.tsx` (one), `apps/web/src/features/board/board.spec.tsx` (one), `apps/web/src/features/port/port.spec.tsx` (two). **Do not touch `apps/web/src/features/hangar/hangar.page.tsx` or `ship-yard.tsx` in this task** — those are production code fixed in Task 6/7; this step only fixes test fixtures that construct a raw `ShipResponse`-shaped object.

In `apps/web/src/test/msw/handlers.ts`, add a small exported helper near the top (alongside the file's other fixture-building functions like `sheet()`):

```typescript
export function classicSquareCells(): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = -10; y < 10; y += 1) {
    for (let x = -10; x < 10; x += 1) {
      cells.push([x, y]);
    }
  }
  return cells;
}
```

Replace both `yard: { halfSize: 10 }` occurrences in this file with `yard: { cells: classicSquareCells() }`.

In `apps/web/src/features/board/board.spec.tsx` and `apps/web/src/features/port/port.spec.tsx`, add `classicSquareCells` to each file's existing import from `'../../test/msw/handlers'` (both files already import other named helpers from that module — add this one to the same import line rather than a new import statement), and replace each file's `yard: { halfSize: 10 }` occurrence(s) with `yard: { cells: classicSquareCells() }`.

- [ ] **Step 7: Run the test from Step 2 to verify it passes**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "yard reports the ship's format cells"`
Expected: PASS.

- [ ] **Step 8: Run the full API unit + integration suites**

Run: `cd apps/api && npm run test:unit && npm run test:int`
Expected: unit suite fully green. Integration suite green except any test that directly asserts `body.yard.halfSize` (fix those the same way as Step 6 — update to `yard.cells`, same classic-square list). Record every file you touched this step in your ledger.

- [ ] **Step 9: Typecheck the API**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: clean. Fix any remaining `halfSize` reference this surfaces in API source (not web — web is expected to still fail until Task 6/7).

- [ ] **Step 10: Commit**

```bash
cd apps/api && cd ../.. 
git add apps/api/src/ships/ships.service.ts packages/contract/src/index.ts apps/api/test
git commit -m "ships.service: thread format cells through layout validation; yard.cells replaces halfSize"
```

---

## Task 4: `GET /v1/ship-formats` and `POST /v1/ships/:id/format`

**Files:**
- Modify: `apps/api/src/ships/ships.service.ts`
- Modify: `apps/api/src/ships/ships.controller.ts`
- Modify: `apps/api/src/ships/dto/ship-operations.dto.ts`
- Modify: `packages/contract/src/index.ts`
- Test: same integration file as Task 3

**Interfaces:**
- Consumes: `loadFormatCells`, `cellKey` from Tasks 2/3.
- Produces: `ShipsService.listFormats(playerId: string): Promise<ShipFormatSummary[]>`; `ShipsService.setFormat(shipId: string, formatId: string): Promise<ShipResponse>`. `ShipFormatSchema` in the contract.

- [ ] **Step 1: Write the failing tests**

In the integration file from Task 3, add:

```typescript
  it('lists unlocked formats, always including classic_square, and switches format dropping out-of-shape parts', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const ship = asShip(await onboard(token, 'luna'));
    await assembleStarterKit(httpServer(testApp.app), token, ship.id);

    // Add a second format with a tiny shape (just the bridge's own cell) directly via Prisma,
    // to exercise the drop-to-inventory path without needing the admin API in this test.
    await prisma.shipFormat.create({
      data: {
        id: 'tiny_test_format',
        displayName: { en: 'Tiny', 'pt-BR': 'Minúsculo' },
        description: { en: 'test', 'pt-BR': 'teste' },
        cells: [[0, 0]],
        minRarity: 'COMMON',
        active: true,
      },
    });

    const list = await request(httpServer(testApp.app))
      .get('/v1/ship-formats')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const ids = (list.body as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toContain('classic_square');
    expect(ids).toContain('tiny_test_format');

    const before = asShip(
      await request(httpServer(testApp.app))
        .get(`/v1/ships/${ship.id}`)
        .set('Authorization', `Bearer ${token}`),
    );
    const placedCount = before.layout.length;
    expect(placedCount).toBeGreaterThan(1); // the assembled starter kit has more than just the bridge

    const switched = asShip(
      await request(httpServer(testApp.app))
        .post(`/v1/ships/${ship.id}/format`)
        .set('Authorization', `Bearer ${token}`)
        .send({ formatId: 'tiny_test_format' }),
    );
    expect(switched.yard.cells).toEqual([[0, 0]]);
    // Only whatever occupies (0,0) — the bridge — can still be placed; everything else dropped.
    expect(switched.layout.length).toBeLessThan(placedCount);

    const inventory = await request(httpServer(testApp.app))
      .get('/v1/inventory')
      .set('Authorization', `Bearer ${token}`);
    const installedStill = (inventory.body as Array<{ location: string }>).filter(
      (p) => p.location === 'INSTALLED',
    );
    expect(installedStill.length).toBe(switched.layout.length);
  });

  it('rejects a format switch above the bridge\'s rarity', async () => {
    await freshSeededApp();
    const { token } = await seedAndToken();
    const ship = asShip(await onboard(token, 'luna'));
    await prisma.shipFormat.create({
      data: {
        id: 'legendary_only',
        displayName: { en: 'Legendary', 'pt-BR': 'Lendário' },
        description: { en: 'test', 'pt-BR': 'teste' },
        cells: [[0, 0]],
        minRarity: 'LEGENDARY',
        active: true,
      },
    });

    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${ship.id}/format`)
      .set('Authorization', `Bearer ${token}`)
      .send({ formatId: 'legendary_only' });
    expect(response.status).toBe(409);
    expect((response.body as { message: { error: string } }).message.error).toBe(
      'FORMAT_NOT_UNLOCKED',
    );
  });

  it('lists only classic_square when the ship has no bridge installed yet', async () => {
    // Review Focus #1: a brand-new ship (starter kit still loose) has no installed bridge at
    // all — the format list must not throw or come back empty just because of that.
    await freshSeededApp();
    const { token } = await seedAndToken();
    await onboard(token, 'luna'); // starter kit is loose; nothing is installed yet

    const list = await request(httpServer(testApp.app))
      .get('/v1/ship-formats')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const ids = (list.body as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toEqual(['classic_square']);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "lists unlocked formats|rejects a format switch|no bridge installed"`
Expected: FAIL — `GET /v1/ship-formats` and `POST /v1/ships/:id/format` are 404 (routes don't exist).

- [ ] **Step 3: Add the DTO**

Open `apps/api/src/ships/dto/ship-operations.dto.ts`. Add, near `StanceDto`:

```typescript
export class SetFormatDto {
  @IsString()
  formatId!: string;
}
```

(Check the file's existing imports — `IsString` is very likely already imported from `class-validator` for another DTO in the same file; add it to the existing import if not.)

- [ ] **Step 4: Add the service methods**

In `apps/api/src/ships/ships.service.ts`, add near `setStance`:

```typescript
  async listFormats(playerId: string): Promise<Array<{
    id: string;
    displayName: unknown;
    description: unknown;
    cells: [number, number][];
    minRarity: string;
  }>> {
    const ship = await this.prisma.ship.findFirst({ where: { ownerPlayerId: playerId } });
    const bridgeRarity = await this.currentBridgeRarity(ship);
    const rarityRank = RARITY_ORDER.indexOf(bridgeRarity);
    const formats = await this.prisma.shipFormat.findMany({ where: { active: true } });
    return formats
      .filter((format) => RARITY_ORDER.indexOf(format.minRarity) <= rarityRank)
      .map((format) => ({
        id: format.id,
        displayName: format.displayName,
        description: format.description,
        cells: format.cells as [number, number][],
        minRarity: format.minRarity,
      }));
  }

  async setFormat(shipId: string, formatId: string): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const target = await this.prisma.shipFormat.findUnique({ where: { id: formatId } });
    if (!target || !target.active) {
      throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
    }
    const bridgeRarity = await this.currentBridgeRarity(ship);
    if (RARITY_ORDER.indexOf(target.minRarity) > RARITY_ORDER.indexOf(bridgeRarity)) {
      throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
    }

    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const newCells = new Set((target.cells as [number, number][]).map(([x, y]) => cellKey(x, y)));
    const currentLayout = (ship.layout as unknown as Placement[]) ?? [];

    const fits = (placement: Placement): boolean => {
      const part = catalogMap.get(placement.partInstanceId);
      if (part === undefined) return false;
      const width = placement.rot === 90 ? part.h : part.w;
      const height = placement.rot === 90 ? part.w : part.h;
      for (let dx = 0; dx < width; dx += 1) {
        for (let dy = 0; dy < height; dy += 1) {
          if (!newCells.has(cellKey(placement.gx + dx, placement.gy + dy))) return false;
        }
      }
      return true;
    };
    const keptLayout = currentLayout.filter(fits);

    await this.prisma.$transaction(async (tx) => {
      await tx.ship.update({ where: { id: shipId }, data: { formatId, layout: toJsonInput(keptLayout) } });
      const droppedIds = currentLayout
        .filter((p) => !fits(p))
        .map((p) => p.partInstanceId);
      if (droppedIds.length > 0) {
        await tx.partInstance.updateMany({
          where: { id: { in: droppedIds } },
          data: { location: 'INVENTORY', shipId: null },
        });
      }
    });

    const updated = await this.loadShip(shipId);
    return this.toResponse(updated, rules);
  }

  private async currentBridgeRarity(ship: Ship): Promise<string> {
    const bridgeInstalled = await this.prisma.partInstance.findFirst({
      where: { shipId: ship.id, location: 'INSTALLED', partCatalog: { partClass: 'BRIDGE' } },
      include: { partCatalog: true },
    });
    return bridgeInstalled?.partCatalog.rarity ?? 'COMMON';
  }
```

Add near the top of the file, alongside other module-level constants:

```typescript
const RARITY_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
```

(This mirrors the same ordering convention already established in `part-upgrade.calculator.ts` and `apps/web/src/features/parts/part-detail.tsx`'s `lowestRarity` from earlier this session — do not import either of those directly, `ships.service.ts` doesn't currently depend on `economy/part-upgrade.calculator.ts` and shouldn't start for one shared constant; a local copy matching the same five-value order is the established pattern in this codebase for this exact enum ordering.)

Check `toJsonInput` is already imported in this file (it is, confirmed at the top: `import { toJsonInput } from '../common/prisma-json.js';`) — no new import needed for it.

- [ ] **Step 5: Add the controller routes**

In `apps/api/src/ships/ships.controller.ts`, add near the `stance` method:

```typescript
  @Get('formats')
  listFormats(@CurrentUser() user: CurrentUserPayload) {
    return this.shipsService.listFormats(user.playerId);
  }

  @Post(':id/format')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  setFormat(@Param('id') shipId: string, @Body() dto: SetFormatDto) {
    return this.shipsService.setFormat(shipId, dto.formatId);
  }
```

Add `SetFormatDto` to the existing DTO import line at the top of the file.

**Route ordering note:** `@Get('formats')` must be declared on the controller BEFORE `@Get(':id')` in NestJS route matching, or `:id` will greedily match the literal path segment `formats`. Check the existing method order — `list()` (`@Get()`) and `get()` (`@Get(':id')`) are declared in that order; add `listFormats` directly after `list()` and before `get()`.

- [ ] **Step 6: Add the contract schema**

In `packages/contract/src/index.ts`, near `ShipResponseSchema`, add:

```typescript
export const ShipFormatSchema = z.object({
  id: z.string(),
  displayName: LocalizedTextSchema,
  description: LocalizedTextSchema,
  cells: z.array(z.tuple([z.number(), z.number()])),
  minRarity: z.string(),
});
export type ShipFormat = z.infer<typeof ShipFormatSchema>;
```

- [ ] **Step 7: Run the tests from Step 1 to verify they pass**

Run: `cd apps/api && npm run test:int -- parts-ships.int-spec.ts -t "lists unlocked formats|rejects a format switch|no bridge installed"`
Expected: PASS, all three.

- [ ] **Step 8: Run the full API suites and typecheck**

Run: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/ships packages/contract/src/index.ts
git commit -m "Add GET /v1/ship-formats and POST /v1/ships/:id/format"
```

---

## Task 5: Admin — `grid-cells` field type and the `ship-formats` entity

**Files:**
- Modify: `apps/api/src/admin/tuning/entity-schemas.ts`
- Modify: `apps/api/src/admin/tuning/entity-tuning.service.ts`
- Test: `apps/api/test/integration/entity-tuning.int-spec.ts`

**Interfaces:**
- Produces: `EntityFieldType` gains `'grid-cells'`. `ENTITY_SCHEMAS['ship-formats']` and `ENTITY_MODEL_DELEGATE['ship-formats'] = 'shipFormat'`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/integration/entity-tuning.int-spec.ts`, add (mirroring the file's existing `validPartPayload`-style helper and `createAdmin`/`loginAdmin` pattern already shown above):

```typescript
function validShipFormatPayload(id: string): Record<string, unknown> {
  return {
    id,
    displayName: { en: 'Test Format', 'pt-BR': 'Formato de Teste' },
    description: { en: 'A test format.', 'pt-BR': 'Um formato de teste.' },
    cells: [[0, 0], [1, 0]],
    minRarity: 'COMMON',
  };
}

describe('ship-formats entity (Ship Format, round 11)', () => {
  it('creates a format with a valid cell list', async () => {
    await seed(prisma);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(httpServer(testApp.app), admin);

    const response = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/ship-formats')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: validShipFormatPayload('cross_test'), reason: 'test' });
    expect(response.status).toBe(201);
  });

  it('rejects a cell list missing [0,0]', async () => {
    await seed(prisma);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(httpServer(testApp.app), admin);

    const payload = validShipFormatPayload('no_origin');
    payload.cells = [[1, 0], [2, 0]];
    const response = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/ship-formats')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: payload, reason: 'test' });
    expect(response.status).toBe(400);
  });

  it('rejects a cell beyond the +/-15 drawing ceiling', async () => {
    await seed(prisma);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(httpServer(testApp.app), admin);

    const payload = validShipFormatPayload('too_big');
    payload.cells = [[0, 0], [20, 0]];
    const response = await request(httpServer(testApp.app))
      .post('/v1/admin/tuning/ship-formats')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: payload, reason: 'test' });
    expect(response.status).toBe(400);
  });
});
```

(The request body shape `{ data, reason }` and success status `201` above are confirmed against this same file's existing `'creates a new part and it appears in the list and is retrievable'` test and `entity-tuning.controller.ts`'s `create` handler.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && npm run test:int -- entity-tuning.int-spec.ts -t "ship-formats entity"`
Expected: FAIL — `Unknown entity: ship-formats`.

- [ ] **Step 3: Add the `grid-cells` field type**

Open `apps/api/src/admin/tuning/entity-schemas.ts`. Change:
```typescript
export type EntityFieldType =
  'string' | 'integer' | 'float' | 'boolean' | 'json' | 'enum' | 'locale-map';
```
to:
```typescript
export type EntityFieldType =
  'string' | 'integer' | 'float' | 'boolean' | 'json' | 'enum' | 'locale-map' | 'grid-cells';
```

In `buildBaseValidator`, add a case:
```typescript
    case 'grid-cells':
      return z
        .array(z.tuple([z.number().int(), z.number().int()]))
        .refine((cells) => cells.some(([x, y]) => x === 0 && y === 0), {
          message: 'cells must include the bridge anchor [0, 0]',
        })
        .refine(
          (cells) => cells.every(([x, y]) => Math.abs(x) <= 15 && Math.abs(y) <= 15),
          { message: 'cells must stay within the +/-15 drawing ceiling' },
        );
```

- [ ] **Step 4: Register the `ship-formats` entity**

Still in `entity-schemas.ts`, add a field list and register it:

```typescript
const SHIP_FORMAT_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique format code', 'Código único do formato'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'cells',
    type: 'grid-cells',
    required: true,
    description: localeMap(
      'Buildable cells, relative to the bridge at [0,0]',
      'Células construíveis, relativas à ponte em [0,0]',
    ),
  },
  {
    name: 'minRarity',
    type: 'enum',
    required: true,
    enumValues: RARITY_VALUES,
    description: localeMap(
      'Minimum bridge rarity that unlocks this format',
      'Raridade mínima de ponte que desbloqueia este formato',
    ),
  },
];
```

Add to `ENTITY_SCHEMAS`:
```typescript
  'ship-formats': { entity: 'ship-formats', model: 'shipFormat', fields: SHIP_FORMAT_FIELDS },
```

- [ ] **Step 5: Register the Prisma delegate mapping**

Open `apps/api/src/admin/tuning/entity-tuning.service.ts`. Add to `ENTITY_MODEL_DELEGATE`:
```typescript
  'ship-formats': 'shipFormat',
```

(`ID_FIELD` needs no new entry — `ShipFormat`'s primary key is `id`, which is the map's existing default.)

- [ ] **Step 6: Run the tests from Step 1 to verify they pass**

Run: `cd apps/api && npm run test:int -- entity-tuning.int-spec.ts -t "ship-formats entity"`
Expected: PASS.

- [ ] **Step 7: Run the full API suites**

Run: `cd apps/api && npm run test:unit && npm run test:int`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/admin/tuning
git commit -m "Admin: register ship-formats entity with a new grid-cells field type"
```

---

## Task 6: Web — `canPlace` and `ShipYard` render from format cells, not `halfSize`

**Files:**
- Modify: `apps/web/src/features/hangar/hangar.geometry.ts`
- Modify: `apps/web/src/features/hangar/ship-yard.tsx`
- Modify: `apps/web/src/features/hangar/hangar.page.tsx`
- Modify: `apps/web/src/styles/index.css`
- Create: `apps/web/src/features/hangar/hangar.geometry.spec.ts` (confirmed not to exist yet at plan-writing time)
- Test: `apps/web/src/features/hangar/hangar.spec.tsx`

**Interfaces:**
- Consumes: `ShipResponse.yard.cells: [number, number][]` from Task 3/4's contract change.
- Produces: `canPlace(layout, catalogById, partInstanceId, gx, gy, rot, cells: ReadonlySet<string>): boolean` (replaces the `halfSize: number` parameter). `ShipYardProps.cells: readonly [number, number][]` (replaces `halfSize: number`).

- [ ] **Step 1: Write the failing test for `canPlace`**

Find or create `apps/web/src/features/hangar/hangar.geometry.spec.ts`. Add:

```typescript
import { describe, expect, it } from 'vitest';
import { canPlace } from './hangar.geometry';
import type { PartCatalogStats } from '../../api/generated';

function catalog(w: number, h: number): PartCatalogStats {
  return {
    partType: 'x', partClass: 'UTILITY', w, h, mass: 1, structureCost: 1, partHp: 1, basePrice: 0,
    pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0,
    fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false,
    lifeSupport: false,
  };
}

describe('canPlace — format cell set', () => {
  it('rejects a cell outside the format even when it would fit inside the old square bound', () => {
    const cells = new Set(['0,0']); // a 1-cell format
    const catalogById = new Map([['p1', catalog(1, 1)]]);
    expect(canPlace([], catalogById, 'p1', 1, 0, 0, cells)).toBe(false);
    expect(canPlace([], catalogById, 'p1', 0, 0, 0, cells)).toBe(true);
  });

  it('rejects a multi-cell part that only partially fits the format', () => {
    const cells = new Set(['0,0']); // too small for a 2x1 part
    const catalogById = new Map([['p1', catalog(2, 1)]]);
    expect(canPlace([], catalogById, 'p1', 0, 0, 0, cells)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/features/hangar/hangar.geometry.spec.ts`
Expected: FAIL — `canPlace`'s last parameter is still `halfSize: number`, a `Set` doesn't satisfy that type (TS error) or the bounds logic is wrong at runtime if run under `--no-check`.

- [ ] **Step 3: Update `canPlace`**

Replace `apps/web/src/features/hangar/hangar.geometry.ts` in full:

```typescript
import type { PartCatalogStats, Placement } from '../../api/generated';

// Pure client-side geometry for drag/snap feedback: footprints swap on right-angle rotation.
// Which cells exist comes from the ship's own format (`ship.yard.cells`), which also
// re-validates every preview and the save (D20) — the client owns no copy of the shape beyond
// what it was just given to render.

export function footprint(
  catalog: PartCatalogStats,
  rot: 0 | 90,
): { width: number; height: number } {
  return rot === 90
    ? { width: catalog.h, height: catalog.w }
    : { width: catalog.w, height: catalog.h };
}

export function canPlace(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  partInstanceId: string,
  gx: number,
  gy: number,
  rot: 0 | 90,
  cells: ReadonlySet<string>,
): boolean {
  const catalog = catalogById.get(partInstanceId);
  if (catalog === undefined) return false;
  const { width, height } = footprint(catalog, rot);
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      if (!cells.has(`${gx + dx},${gy + dy}`)) return false;
    }
  }
  for (const placement of layout) {
    if (placement.partInstanceId === partInstanceId) continue;
    const other = catalogById.get(placement.partInstanceId);
    if (other === undefined) continue;
    const otherFoot = footprint(other, placement.rot);
    const overlaps =
      gx < placement.gx + otherFoot.width &&
      placement.gx < gx + width &&
      gy < placement.gy + otherFoot.height &&
      placement.gy < gy + height;
    if (overlaps) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run the test from Step 1 to verify it passes**

Run: `cd apps/web && npx vitest run src/features/hangar/hangar.geometry.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update `ShipYard` to render from `cells`**

Open `apps/web/src/features/hangar/ship-yard.tsx`. This requires several coordinated changes:

Replace the `halfSize: number` prop with `cells: readonly [number, number][]` in `ShipYardProps`:
```typescript
  /** Which cells exist, from the ship's own format — relative to the bridge at [0,0]. */
  cells: readonly [number, number][];
```

Replace the component's destructured prop and the `cellCount`/`clampView`/`fitView`/cell-loop/grid-lines logic. The bounding box replaces `halfSize`/`cellCount` everywhere they currently gate zoom/pan:

```typescript
export function ShipYard({
  layout,
  lookById,
  cells,
  catalogById,
  nameById,
  selectedId,
  draggingId,
  onSelect,
  onCellClick,
  onCellHover,
  onDragStart,
  onDragEnd,
  onHoverPart,
}: ShipYardProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);

  const bounds = (() => {
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const [x, y] of cells) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + 1);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + 1);
    }
    return { minX, maxX, minY, maxY };
  })();
  const cellCount = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const clampView = useCallback(
    (view: View): View => {
      const span = Math.min(cellCount, Math.max(MIN_SPAN, view.span));
      const limitX = (bounds.maxX - bounds.minX) / 2 - span / 2;
      const limitY = (bounds.maxY - bounds.minY) / 2 - span / 2;
      return {
        span,
        cx: Math.min(centerX + limitX, Math.max(centerX - limitX, view.cx)),
        cy: Math.min(centerY + limitY, Math.max(centerY - limitY, view.cy)),
      };
    },
    [cellCount, bounds, centerX, centerY],
  );
```

(The rest of `clampView`'s callers — `fitView`, `zoomBy`, the wheel/pan handlers — are unchanged; they already just call `clampView`/read `cellCount` by name, both of which now come from the bounding box instead of `halfSize`.)

`fitView`'s own default-view fallback (`clampView({ cx: 0, cy: 0, span: Math.min(cellCount, 20) })`, both occurrences) becomes `clampView({ cx: centerX, cy: centerY, span: Math.min(cellCount, 20) })`.

The initial `useState<View>(() => clampView({ cx: 0, cy: 0, span: 20 }))` becomes `useState<View>(() => clampView({ cx: centerX, cy: centerY, span: 20 }))`.

Replace the cell-enumeration loop:
```typescript
  const cells: Array<{ gx: number; gy: number }> = [];
  for (let gy = -halfSize; gy < halfSize; gy += 1) {
    for (let gx = -halfSize; gx < halfSize; gx += 1) {
      cells.push({ gx, gy });
    }
  }

  const gridLines: string[] = [];
  for (let i = 0; i <= cellCount; i += 1) {
    const coordinate = -halfSize + i;
    gridLines.push(`M${coordinate},${-halfSize} V${halfSize}`);
    gridLines.push(`M${-halfSize},${coordinate} H${halfSize}`);
  }
```
with:
```typescript
  const cellList = cells.map(([gx, gy]) => ({ gx, gy }));
```

(Renamed to `cellList` to avoid shadowing the `cells` prop — update the two JSX usages below, `cells.map((cell) => ...` in the render, to `cellList.map((cell) => ...`. The separate `gridLines` path and its `<path className="yard-grid" .../>` element are removed entirely — Step 6 below gives each cell's own rect a visible border instead, which works for any shape without a separate line-mesh computation.)

Remove the `<path className="yard-grid" d={gridLines.join(' ')} />` line from the JSX (just before the `{cells.map(...)}` block), and update that block's variable name:
```tsx
        {cellList.map((cell) => (
          <rect
            key={`${cell.gx},${cell.gy}`}
            className="yard-cell"
            data-gx={cell.gx}
            data-gy={cell.gy}
            x={cell.gx}
            y={cell.gy}
            width={1}
            height={1}
            onClick={() => {
              if (gesture.current.moved) return;
              onCellClick(cell.gx, cell.gy);
            }}
            onPointerEnter={() => onCellHover(cell.gx, cell.gy)}
          />
        ))}
```

- [ ] **Step 6: Give each cell its own border instead of the removed grid-line mesh**

Open `apps/web/src/styles/index.css`. Find `.yard-grid` and `.yard-cell` (search for `/* hangar yard (S10.4)`). Replace:
```css
.yard-grid {
  stroke: var(--line);
  stroke-width: 0.03;
  fill: none;
  opacity: 0.7;
  pointer-events: none;
}

.yard-cell {
  fill: transparent;
}
```
with:
```css
.yard-cell {
  fill: transparent;
  stroke: var(--line);
  stroke-width: 0.03;
  opacity: 0.7;
}
```

(`.yard-cell:hover` stays exactly as it is.)

- [ ] **Step 7: Update `hangar.page.tsx`'s two `canPlace` call sites and the `ShipYard` prop**

Open `apps/web/src/features/hangar/hangar.page.tsx`. Replace:
```typescript
  const yardHalfSize = ship?.yard.halfSize ?? 0;
```
with:
```typescript
  const yardCellSet = useMemo(
    () => new Set((ship?.yard.cells ?? []).map(([x, y]) => `${x},${y}`)),
    [ship],
  );
```

(`useMemo` is already imported in this file — confirmed at the top: `import { useEffect, useMemo, useState } from 'react';`.)

Update both `canPlace(...)` call sites (lines ~260 and ~302) to pass `yardCellSet` as the last argument instead of `yardHalfSize`.

Update the `<ShipYard halfSize={ship.yard.halfSize} .../>` prop (line ~494) to `<ShipYard cells={ship.yard.cells} .../>`.

- [ ] **Step 8: Fix the `hangar.spec.tsx` fixture and any test asserting `.yard-grid`**

Run: `grep -n "halfSize\|yard-grid" apps/web/src/features/hangar/hangar.spec.tsx`

This file doesn't currently import anything from `'../../test/msw/handlers'` — add `import { classicSquareCells } from '../../test/msw/handlers';` to its import block (Task 3 Step 6 is what adds and exports `classicSquareCells` from that module). Replace the file's one `yard: { halfSize: 10 }` fixture (in the `'never rounds mobility up past 1...'` test, whose fixture ship has `layout: []` so the exact cell shape doesn't matter beyond being well-formed) with `yard: { cells: classicSquareCells() }`.

If any test asserts `container.querySelector('.yard-grid')` or similar, update it to check `.yard-cell` elements instead (there is likely no such test — `.yard-grid` was purely visual — but check with `grep -n "yard-grid" apps/web/src/features/hangar/*.spec.tsx` to be sure).

- [ ] **Step 9: Run the full web test suite**

Run: `cd apps/web && npx vitest run`
Expected: every test in `hangar.spec.tsx` and anything else referencing `ship.yard`/`canPlace`/`ShipYard` passes. Fix any fixture this surfaces the same way as Step 8.

- [ ] **Step 10: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/features/hangar apps/web/src/styles/index.css
git commit -m "Hangar: render the yard from the ship's format cells, not a fixed halfSize"
```

---

## Task 7: Web — format picker in Hangar

**Files:**
- Modify: `apps/web/src/features/hangar/hangar.page.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/pt-BR.json`
- Modify: `apps/web/src/test/msw/handlers.ts`
- Test: `apps/web/src/features/hangar/hangar.spec.tsx`

**Interfaces:**
- Consumes: `GET /v1/ship-formats`, `POST /v1/ships/:id/format` from Task 4.

- [ ] **Step 1: Add the MSW handlers**

Open `apps/web/src/test/msw/handlers.ts`. Find where `ship()`'s fixture and other `/v1/ships/:id/...` handlers are defined (same area as `/v1/ships/:id/preview`, confirmed earlier this session around line 502). Add:

```typescript
  http.get('/v1/ship-formats', () =>
    ok([
      {
        id: 'classic_square',
        displayName: { en: 'Classic Square', 'pt-BR': 'Quadrado Clássico' },
        description: { en: 'The original grid.', 'pt-BR': 'A grade original.' },
        cells: Array.from({ length: 20 }, (_, i) => i - 10).flatMap((x) =>
          Array.from({ length: 20 }, (_, j) => j - 10).map((y) => [x, y] as [number, number]),
        ),
        minRarity: 'COMMON',
      },
    ]),
  ),
  http.post('/v1/ships/:id/format', () => ok(ship())),
```

(Place these alongside the ship-related handlers in the same exported array; match this file's existing `ok(...)` helper and `ship()` fixture function exactly as already used by neighboring handlers.)

Update the `ship()` fixture function itself (wherever it builds the `yard` field) — it must now return `yard: { cells: [...] }` matching the format above, not `yard: { halfSize: 10 }` (this was likely already fixed in Task 6's Step 8/9 pass if it broke a test then; if not, fix it now).

- [ ] **Step 2: Write the failing test**

In `apps/web/src/features/hangar/hangar.spec.tsx`, add:

```typescript
  it('shows a format picker and switches the yard shape on selection', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    fireEvent.click(await screen.findByRole('button', { name: 'Format' }));
    const option = await screen.findByRole('button', { name: 'Classic Square' });
    fireEvent.click(option);

    await waitFor(() => {
      // The yard re-renders with the (mocked) format's cells once the switch resolves.
      expect(document.querySelector('[data-gx="-10"][data-gy="-10"]')).not.toBeNull();
    });
  });
```

(This matches Step 4's implementation below exactly: a toggle button labeled "Format" reveals a list of plain buttons, one per unlocked format, labeled by that format's own display name — the same "click to open, click an option" shape as this file's existing "colorBy" toggle in `ship-yard.tsx`.)

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/features/hangar/hangar.spec.tsx -t "format picker"`
Expected: FAIL — no "Format" button exists yet.

- [ ] **Step 4: Add the picker to `hangar.page.tsx`**

Add a query for the format list and a mutation for switching, near the other `useQuery`/`useMutation` calls:

```typescript
  const formatsQuery = useQuery({
    queryKey: ['shipFormats'],
    queryFn: () => client.get<ShipFormat[]>('/v1/ship-formats'),
  });
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);
  const setFormat = useMutation({
    mutationFn: (formatId: string) =>
      client.post<ShipResponse>(`/v1/ships/${ship?.id ?? ''}/format`, { formatId }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ships'], (ships: ShipResponse[] | undefined) =>
        ships?.map((s) => (s.id === updated.id ? updated : s)),
      );
      setFormatPickerOpen(false);
    },
  });
```

(Add `ShipFormat` to the existing `import type { ... } from '../../api/generated';` block at the top of the file.)

Place the picker UI near the yard's existing Rotate/Remove controls — the `t('hangar.actions.rotate')`/`t('hangar.actions.remove')` buttons, around lines 522-532:

```tsx
      <div className="format-picker">
        <button type="button" className="btn" onClick={() => setFormatPickerOpen((v) => !v)}>
          {t('hangar.format.button')}
        </button>
        {formatPickerOpen && (
          <ul className="format-picker-list" aria-label={t('hangar.format.label')}>
            {(formatsQuery.data ?? []).map((format) => (
              <li key={format.id}>
                <button
                  type="button"
                  className="btn"
                  disabled={setFormat.isPending}
                  onClick={() => setFormat.mutate(format.id)}
                >
                  {pickLocalized(format.displayName, i18n.language)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 5: Add i18n keys**

In `apps/web/src/i18n/en.json`, find the `hangar` block's `stage` sub-object (added in an earlier round this session) and add a sibling:
```json
    "format": {
      "button": "Format",
      "label": "Choose a ship format"
    },
```

In `apps/web/src/i18n/pt-BR.json`, the same key with:
```json
    "format": {
      "button": "Formato",
      "label": "Escolher um formato de nave"
    },
```

- [ ] **Step 6: Run the test from Step 2 to verify it passes**

Run: `cd apps/web && npx vitest run src/features/hangar/hangar.spec.tsx -t "format picker"`
Expected: PASS.

- [ ] **Step 7: Run the full web suite and typecheck**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/hangar/hangar.page.tsx apps/web/src/i18n apps/web/src/test/msw/handlers.ts
git commit -m "Hangar: add the format picker"
```

---

## Task 8: Admin — the grid-cells drawing widget

**Files:**
- Create: `apps/web/src/admin/tuning/GridCellsEditor.tsx`
- Modify: `apps/web/src/admin/tuning/SchemaForm.tsx`
- Test: `apps/web/src/admin/tuning/GridCellsEditor.spec.tsx`

**Interfaces:**
- Produces: `GridCellsEditor({ value, onChange }: { value: [number, number][] | undefined; onChange: (cells: [number, number][]) => void })` — a small paint grid.

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/admin/tuning/GridCellsEditor.spec.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GridCellsEditor } from './GridCellsEditor';

describe('GridCellsEditor', () => {
  it('always includes [0,0] pre-painted and locked', () => {
    render(<GridCellsEditor value={[[0, 0]]} onChange={vi.fn()} />);
    const origin = screen.getByTestId('grid-cell-0-0');
    expect(origin).toHaveClass('painted');
    fireEvent.click(origin);
    expect(origin).toHaveClass('painted'); // still painted: clicking the anchor does nothing
  });

  it('toggles a non-anchor cell on click and reports the new cell list', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('grid-cell-1-0'));
    expect(onChange).toHaveBeenCalledWith([[0, 0], [1, 0]]);
  });

  it('erases a painted cell on a second click', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0], [1, 0]]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('grid-cell-1-0'));
    expect(onChange).toHaveBeenCalledWith([[0, 0]]);
  });

  it('defaults to just the anchor cell when value is empty/undefined', () => {
    render(<GridCellsEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByTestId('grid-cell-0-0')).toHaveClass('painted');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run src/admin/tuning/GridCellsEditor.spec.tsx`
Expected: FAIL — the module doesn't exist.

- [ ] **Step 3: Write `GridCellsEditor`**

Create `apps/web/src/admin/tuning/GridCellsEditor.tsx`:

```typescript
const CANVAS_HALF_SIZE = 15;

export interface GridCellsEditorProps {
  value: [number, number][] | undefined;
  onChange: (cells: [number, number][]) => void;
}

// A small paint grid for authoring a Ship Format's cell set (2026-10-02-ship-format-design.md):
// click a cell to toggle it in/out. The bridge's anchor cell (0,0) is always painted and cannot
// be erased — every format is drawn "from" the bridge outward.
export function GridCellsEditor({ value, onChange }: GridCellsEditorProps) {
  const cells = value ?? [[0, 0]];
  const painted = new Set(cells.map(([x, y]) => `${x},${y}`));

  const toggle = (x: number, y: number) => {
    if (x === 0 && y === 0) return;
    const key = `${x},${y}`;
    const next = painted.has(key)
      ? cells.filter(([cx, cy]) => !(cx === x && cy === y))
      : [...cells, [x, y] as [number, number]];
    onChange(next);
  };

  const coords: number[] = [];
  for (let i = -CANVAS_HALF_SIZE; i <= CANVAS_HALF_SIZE; i += 1) coords.push(i);

  return (
    <div className="grid-cells-editor" role="group" aria-label="Format cells">
      {coords.map((y) => (
        <div key={y} className="grid-cells-row">
          {coords.map((x) => {
            const isAnchor = x === 0 && y === 0;
            const isPainted = painted.has(`${x},${y}`);
            return (
              <button
                key={x}
                type="button"
                data-testid={`grid-cell-${x}-${y}`}
                className={`grid-cells-cell${isPainted ? ' painted' : ''}${isAnchor ? ' anchor' : ''}`}
                aria-pressed={isPainted}
                disabled={isAnchor}
                onClick={() => toggle(x, y)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests from Step 1 to verify they pass**

Run: `cd apps/web && npx vitest run src/admin/tuning/GridCellsEditor.spec.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Wire it into `SchemaForm`'s field dispatch**

Open `apps/web/src/admin/tuning/SchemaForm.tsx`. Add an import:
```typescript
import { GridCellsEditor } from './GridCellsEditor';
```

In `renderInput`, add a new branch alongside the existing `field.type === 'json'` branch:
```typescript
    if (field.type === 'grid-cells') {
      return (
        <GridCellsEditor
          value={value as [number, number][] | undefined}
          onChange={(cells) => handleChange(field.name, cells)}
        />
      );
    }
```

- [ ] **Step 6: Run the full web suite and typecheck**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all green/clean. (`EntityFieldType` in `apps/web/src/api/generated.ts` is re-exported from `@rustandspark/contract` — confirm `'grid-cells'` is reachable there; if the web app has its own separate copy of `EntityFieldType` rather than importing the API's type, find and update it the same way Task 5 updated the API's version.)

- [ ] **Step 7: Add minimal CSS**

In `apps/web/src/styles/index.css`, add near the other admin-tuning styles (search for `.yard-cell` or any existing `tuning` class to find that area):
```css
.grid-cells-editor {
  display: inline-block;
  border: 1px solid var(--line);
}

.grid-cells-row {
  display: flex;
}

.grid-cells-cell {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid var(--line);
  background: transparent;
  cursor: pointer;
}

.grid-cells-cell.painted {
  background: var(--spark);
}

.grid-cells-cell.anchor {
  background: var(--bad);
  cursor: default;
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/admin/tuning apps/web/src/styles/index.css
git commit -m "Admin: add the grid-cells drawing widget for Ship Format authoring"
```

---

## Final Integration Check

- [ ] Run the complete suite one more time end to end: `cd apps/api && npm run test:unit && npm run test:int && npx tsc --noEmit -p tsconfig.json`, then `cd apps/web && npx vitest run && npx tsc --noEmit -p tsconfig.json`.
- [ ] Rebuild and restart the docker dev stack (`docker compose build api web && docker compose up -d --wait api web && docker compose restart api web`, per this project's established 502-workaround), then live-verify in a browser: a fresh ship can still assemble on `classic_square`; the Format picker lists it; switching to a tiny admin-created test format drops out-of-shape parts to inventory; the admin UI's new Ship Formats entity can create/edit a format by painting cells.
