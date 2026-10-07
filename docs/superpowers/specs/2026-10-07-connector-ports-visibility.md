# Connector ports: visibility + real generation (no more universal)

**Status:** reviewed plan (rev 2, 2026-10-07), not started. Scope: seed real connector
candidate layouts for all part types, make each **listing** carry its one fixed layout,
show ports in Port/Market (before buy) and Hangar (build). Existing ships/instances:
**no backfill** — owner resets DB later.

## Mental model (owner, locked)

- A part type has an admin-editable **pool of possible layouts** (`PartCatalog.
  connectorLayouts`, already authored in admin via `ConnectorLayoutEditor`).
- When a part is **generated/forged**, it gets exactly **one** layout from the pool, and it
  never changes afterwards.
- A part offered at a port is already that generated part: the player sees its final
  layout **before buying**. Buying is **not** a random roll and the player never selects
  a layout.

## Context (verified)

- `PartInstance.connectors` is rolled at all 5 creation points
  (`market.service.ts:288`, `inventory.service.ts:76`, `onboarding.service.ts:122`,
  `resolve.service.ts:201`, restart kit via onboarding) — rolls return `null` →
  **universal fallback** because **0/81** catalog types have `connectorLayouts`.
- **Gap in current code:** the market rolls with a fresh random UUID **at buy time**
  (`rollConnectors`), so the board cannot show what the buyer will get. Shelf contents
  are already deterministic (`stableUnit`, `used-offers.ts`; `buy()` re-derives them).
  The layout must follow the same pattern.
- Client already receives instance ports: `/v1/inventory` → `InventoryItem.connectors`
  (`packages/contract/src/index.ts:146`), includes INSTALLED items → **hangar yard
  needs no API change** (wiring only).
- Market listings (`MarketListingSchema`, contract `:583`) carry `catalog` stats but no
  layout → contract + API change.
- Kinds & rules (`apps/api/src/parts/connectors.ts`): `none | central | split |
  universal` per cell-side; central↔central/universal, split↔split/universal,
  universal↔anything-but-none, **central↔split never**; unlisted cell/side = `none`.
  Intra-part cell edges are always connected (`geometry.ts:~205`). Rotation is `0|90`
  only; world→authored uses a CCW table (`geometry.ts:164-181`).
- Seed: `apps/api/prisma/seed-data/parts.ts` (`PARTS`; `seedParts` :1612 is
  create-if-missing only; seed entry `prisma/seed.ts:21`).
- Yard render: `ship-yard.tsx` `layout.map` (~:414), block rect ~:426. Hover-drag
  live-replaces (`hangar.page.tsx:341`) → dragging block doubles as preview.
- `apps/web/src/api/generated.ts` re-exports `@rustandspark/contract` zod schemas.

## Decisions (locked)

1. **Seed pattern (factory default pool, one candidate per type):** `central` on all 4
   sides of every footprint cell; **ENGINE/WEAPON: exactly one `none` side, default
   `W`**. `split` NOT in seed. Admin may later add more candidates per type (pool).
2. **Palette:** green = connected, red = incorrect, blue = available. Shapes: dot =
   central, bar = split, ring = universal, nothing = none.
3. Marks **always on** (yard blocks + dragging block + tray + cards).
4. Before-buy view on **all three**: card face mini-strip + hover popup + (i) detail
   popup — showing **the listing's own layout** (not the pool).
5. **No backfill** — only newly created parts get real ports. Old instances keep
   `connectors: []`/`null` (functionally universal via server fallback; no marks shown).
6. **Seed honours the tuning policy** (DB wins): seed fills `connectorLayouts` **only
   where the column is NULL**; it never overwrites admin edits. *(Replaces the earlier
   "always overwrite" decision, which contradicted the policy.)* A dev DB whose rows
   exist with NULL layouts is filled by a plain `pnpm db:seed`; no migration needed.
7. **Deterministic layout per listing:** layout index = `stableUnit(...)` over the pool.
   - used listing: key `conn:<locationId>:<day>:<index>` (same identity as the offer)
   - catalog (new) listing: key `conn:<locationId>:<day>:<partType>` (changes daily)
   `market()` and `buy()` call the same pure helper; `buy()` stores exactly that layout
   on the new `PartInstance`. Other creation points (kits, scavenge) keep the random
   roll at creation.
8. **Connector rules shared** in `packages/contract` (`compatible`, `rotateSide`,
   world↔authored cell/side mapping); API `connectors.ts`/`geometry.ts` and the web
   import them. One implementation, no mirroring.
9. No ship-reset script.

## Tasks

### A. Data & server (first)

- **A0** Spike: confirm the API can import runtime code from `@rustandspark/contract`
  (ESM/build order/jest mapping). If not, fall back to mirrored copies + shared fixtures
  and record that here before continuing.
- **A1** Add optional `connectorLayouts` to `SeedPart` + generator: `allCentral(w,h)`
  per cell ×4 sides; ENGINE/WEAPON variant omitting the `W` side of every cell.
  → `apps/api/prisma/seed-data/parts.ts`
- **A2** `seedParts`: create if missing; for existing rows set `connectorLayouts` **only
  when null** (single `updateMany where connectorLayouts is null`-style per type). Done
  when: after `pnpm db:seed`, `SELECT count(*) FILTER (WHERE "connectorLayouts" IS NULL)
  FROM "PartCatalog"` = 0 and the table row count equals `PARTS.length`; a second seed
  run changes nothing; a manually edited row is left untouched.
- **A3** Unit test `apps/api/test/unit/seed-connectors.spec.ts`: every `PARTS` entry has
  ≥1 candidate; every cell (dx,dy) within w×h; ENGINE/WEAPON omit exactly the `W` sides
  of every cell and have all other sides; all other classes have all 4 sides.
- **A4** Pure helper `pickListingConnectors(key, candidates) → ConnectorLayout | null`
  (stableUnit; `null` if no candidates) + unit test (deterministic, uniform-ish over a
  pool, null on empty). → `apps/api/src/economy/used-offers.ts` (or sibling file).
- **A5** `market()` attaches `connectors: ConnectorLayout | null` to each listing using
  A4; `buy()` re-derives the same value and persists it instead of `rollConnectors`.
  Integration test: the layout listed for a listing id equals the layout on the bought
  instance (catalog + used kinds); two different days/slots can differ. Keep the
  existing "null when no layouts" test green.
- **A6** Contract: `ConnectorLayoutSchema`; `MarketListingSchema` += `connectors`
  (nullable). Keep API contract test green. (Catalog stats do **not** get the pool.)

### B. Before buy (Port/Market)

- **B1** Shared read-only component `apps/web/src/features/parts/connector-grid.tsx`:
  footprint grid + per-side marks (state=available); `null`/empty layout → renders
  nothing (no "incorrect").
- **B2a** card-face mini strip (`part-card.tsx`) · **B2b** hover popup · **B2c** (i)
  detail (`part-detail.tsx` PartStatsCard). Data: `listing.connectors`.
- **B3** MSW market listing helper += default layout
  (`apps/web/src/test/msw/handlers.ts`).

### C. Hangar visibility

- **C1** `apps/web/src/features/hangar/connectors.ts`: uses shared contract helpers;
  adds `sideState(own, neighbor|null) → 'connected'|'incorrect'|'available'`
  (neighbor in same part = n/a; `none` own side = no mark). Table-driven tests incl.
  rot 0/90, engine facing rotation (`W`→`N`), and parity fixtures vs the API geometry
  result for the same placement.
- **C2** `ship-yard.tsx`: memo world-cell→part map; inside `layout.map` render marks per
  cell side — class `conn-connected|conn-incorrect|conn-available`, shape by kind;
  dragging block too. **Legacy instances (`connectors` `[]` or null) render no marks**
  (spec asserts it; verify the real API serialization of legacy rows first).
- **C3** `hangar.page.tsx`: `connectorsById` from inventory items → yard.
- **C4** Tray port strip (`hangar/tray-part-row.tsx`) using same logic.
- **C5** i18n keys en + pt-BR (legend/tooltips) — parity enforced by specs.
- **C6** CSS marks (`apps/web/src/styles/index.css`) — reuse existing color tokens.
  Check visual noise on 2×2 parts; no toggle for now.

### D. Verify & ship

- **D1** Gates: lint, typecheck (api+web+contract), full web jest, API jest (unit +
  `entity-tuning`/ships/market int subsets).
- **D2** `docker compose --profile dev up -d --wait --build`; verify via
  `curl http://localhost:8080/` asset hashes.
- **D3** Manual: port card shows the exact layout → buy → same layout in tray strip →
  place → green/blue; red only when a `none`/split side faces a neighbour (engine/weapon
  `none` side, or admin-authored split) — expected to be rare with the all-central seed.
  Mixed hangar note: old (unmarked, universal) parts next to new ones show one-sided
  marks until the owner's DB reset — expected, not a bug.

## Repo gotchas

- Working tree has unrelated uncommitted ship-format / GridCellsEditor work — commit or
  stash before starting so this lands on a clean branch.
- pnpm swallows jest output → run from `apps/api`:
  `node --disable-warning=ExperimentalWarning --experimental-vm-modules ./node_modules/jest/bin/jest.js --selectProjects <p> --runInBand <pattern>`
- `react/jsx-no-literal`: no bare JSX strings (use `t()`)
- `keys.spec` + `i18n.spec`: every new literal key must exist in both locales
- `noUncheckedIndexedAccess` in tsconfig
- Existing deferred failures: `throttle-store.int-spec.ts` (Redis),
  `production-mode.spec.ts`
- Part card meta already shows `w×h`; admin authoring widget exists
  (`ConnectorLayoutEditor.tsx`) — not in scope
- If admin edits the pool between listing and buy, `buy()` re-derives from the current
  pool and the layout may differ from what was listed (rare; accepted — price-changed
  style re-open of the board). Could be tightened later by returning/validating a hash.

## Open question (non-blocking)

- Catalog (new) listings are unlimited stock: with a pool >1, should every purchase the
  same day get the same layout (current plan) or vary per purchase? Same-per-day keeps
  "what you see is what you get" trivially true; varying per purchase would need a
  per-buyer/seq key. Default: same per day.

**Estimate:** 3 days. **Order:** A0→A1→A2→A3, A4→A5→A6, C1, then B1–B3 / C2–C6, then D.
