# Connector ports: generation rules + visibility (no more universal)

**Status:** reviewed plan (rev 6, 2026-10-07; F done, A–C implemented, D in verification, E next on its own branch), not started. Branch:
`feat/connector-ports-visibility`. Scope: admin-defined **connector generation rules** per
part type, deterministic generation per listing, seed of default rules, ports visible in
Port/Market (before buy) and Hangar (build). Existing ships/instances: **no backfill** —
owner resets DB later.

## Mental model (owner, locked)

- Admin defines, **per part type**, the **rules used to generate** its connections: which
  connection kinds each side (N/E/S/W) may get (with weights), a cap on how many sides can
  be connected / split, and a blacklist of forbidden side combinations.
- Rules are used **only at generation time**. A generated part stores its concrete
  `ConnectorLayout` on the instance and **never changes**, whatever admin edits later.
- A part offered at a port is already that generated part: the player sees its final
  layout **before buying**; buying is not a roll and nothing is selectable.
- Rules do **not** control stock (that is `market-stock`/rarity, untouched).

## Context (verified)

- `PartInstance.connectors` (a concrete `ConnectorLayout`) is rolled at all 5 creation
  points (`market.service.ts:288`, `inventory.service.ts:76`, `onboarding.service.ts:122`,
  `resolve.service.ts:201`, restart kit via onboarding) via `rollConnectors` /
  `rollConnectorsForPartType` — today they pick from `PartCatalog.connectorLayouts`
  (candidate list; **0/81 authored** → `null` → universal fallback).
- **Gap:** the market rolls with a fresh random UUID **at buy time**, so the board cannot
  show what the buyer will get. Shelf contents are already deterministic (`stableUnit`,
  `used-offers.ts`; `buy()` re-derives them); the layout must follow the same pattern.
- Client already receives instance ports: `/v1/inventory` → `InventoryItem.connectors`
  (`packages/contract/src/index.ts:146`), incl. INSTALLED → hangar yard needs no API
  change (wiring only). `MarketListingSchema` (contract `:583`) has no layout yet.
- Kinds & rules (`apps/api/src/parts/connectors.ts`): `none | central | split |
  universal`; central↔central/universal, split↔split/universal, universal↔any-but-none,
  **central↔split never**; unlisted cell/side = `none`. Intra-part cell edges are always
  connected (`geometry.ts:~205`) so interior sides never need a connector. Rotation is
  `0|90`; world→authored uses a CCW table (`geometry.ts:164-181`).
- Admin: `ConnectorLayoutEditor.tsx` + `entity-schemas.ts:351` (`connectorLayouts`) and
  footprint validation in `entity-tuning.service.ts:367-397`.
- Seed: `prisma/seed-data/parts.ts` (`PARTS`; `seedParts` :1612 create-if-missing only).
- Yard render: `ship-yard.tsx` `layout.map` (~:414); hover-drag live-replaces
  (`hangar.page.tsx:341`) → dragging block doubles as preview.
- `apps/web/src/api/generated.ts` re-exports `@rustandspark/contract` zod schemas.

## Rules model (new)

New nullable JSON column `PartCatalog.connectorRules`:

```
{
  "sides": {                       // authored (unrotated) sides, applied to every
    "N": [{ "kind": "central", "weight": 70 }, { "kind": "split", "weight": 30 }],
    "E": [...], "S": [...], "W": [{ "kind": "none", "weight": 100 }]
  },
  "maxConnected": 3,               // optional: max sides whose kind != none
  "maxSplit": 1,                   // optional: max sides with kind == split
  "forbidden": [                   // optional blacklist of partial combinations
    { "N": "split", "S": "split" } // a roll matching ALL listed sides is rejected
  ]
}
```

- Kinds allowed in rules: `none | central | split | universal` (the existing set; new
  kinds like "type-a/b" are out of scope — central/split are the two incompatible families).
- **One kind is rolled per side for the whole part** (not per cell). A rolled side is
  written onto every **perimeter** cell edge on that side of the footprint (interior
  edges are omitted — they are always connected anyway). `none` writes nothing.
- **Generator = exact weighted pick:** enumerate the ≤4⁴=256 side combinations, drop
  those with zero weight / violating `maxConnected`/`maxSplit`/`forbidden`, weighted-pick
  by product of side weights using a seeded rng. No reject-and-retry loops.
- `null` rules (type never configured) → `null` layout → universal fallback (as today).
- Admin validation: each listed side has ≥1 positive weight; at least **one valid
  combination** must remain after limits + blacklist (checked by the same enumeration).

## Decisions (locked)

1. **Default seed rules** (factory defaults, fill-if-null): every side `central` 100;
   **ENGINE/WEAPON: `W` = `none` 100**. In v1 `W` is the fixed class-constant facing side
   for ENGINE/WEAPON (shared with phase E); admin validation rejects a non-`none` `W` for
   those classes. A per-type `facingSide` is a later enhancement.
   `split` not in default rules.
2. **Palette:** green = connected, red = incorrect, blue = available. Shapes: dot =
   central, bar = split, ring = universal, nothing = none.
3. Marks **always on** (yard blocks + dragging block + tray + cards).
4. Before-buy view on **all three**: card face mini-strip + hover popup + (i) detail
   popup — showing the **listing's own generated layout**.
5. **No backfill** — only newly generated parts get real ports. Old instances keep
   `connectors: []`/`null` (functionally universal; no marks — expected).
6. **Seed honours the tuning policy** (DB wins): fills `connectorRules` **only where
   NULL**, never overwrites admin edits; plain `pnpm db:seed` fills an existing dev DB.
7. **Deterministic generation per listing:** seed the pick with
   - used listing: `conn:<locationId>:<day>:<index>`
   - catalog (new) listing: `conn:<locationId>:<day>:<partType>` (same per day)
   `market()` and `buy()` call one pure generator; `buy()` stores exactly that layout.
   Other creation points (kits, scavenge) generate with a fresh random seed.
8. **Connector rules (`compatible`, `rotateSide`, world↔authored mapping) shared** in
   `packages/contract`; API and web import them. **Written 4-way from day one**
   (`rot` ∈ 0|90|180|270 as quarter-turns, tested at all 4 angles × 4 sides) even though
   `PlacementSchema.rot` stays `0|90` until phase E — avoids rewriting the helpers.
9. **Existing `connectorLayouts` candidates column/editor retired from admin** (column
   left in DB for now, unused; instances keep storing concrete layouts). No ship-reset
   script.

## Tasks

### A. Data, generator & server (first)

- **A0** Spike — **result: NOT possible.** `@rustandspark/contract` ships raw `.ts`
  (`main: ./src/index.ts`) and the API image/tsc build never bundles it (the API only touches it
  from tests), so the API cannot import runtime code from it. Decision 8 therefore became:
  **mirrored implementations pinned by shared vectors** in
  `packages/contract/fixtures/connector-vectors.json`, asserted by both
  `apps/api/test/unit/parts/connectors.spec.ts` and
  `apps/web/src/features/hangar/connectors.spec.ts`.
- **A1** Prisma: add `PartCatalog.connectorRules Json?` + migration. Contract/zod schema
  `ConnectorRulesSchema` (shared). Types in `apps/api/src/parts/part.types.ts`.
- **A2** Pure generator `generateConnectors(rules, w, h, seed) → ConnectorLayout | null`
  in `apps/api/src/parts/connectors.ts` (enumeration, limits, blacklist, perimeter
  expansion, weighted pick) + unit tests: determinism, weights roughly honoured over many
  seeds, `maxConnected`/`maxSplit`/`forbidden` never violated, perimeter-only for 2×2,
  `W:none` engine never has `W` cells, null rules → null, zero valid combos → error from
  validator.
- **A3** Replace `rollConnectors*` internals to use `connectorRules` +
  `generateConnectors` (kits/scavenge: random seed). Update existing market/unit tests.
- **A4** Seed: `SeedPart.connectorRules` default generator (decision 1); `seedParts`
  creates if missing and fills `connectorRules` only when null. Test
  `seed-connectors.spec.ts`: every `PARTS` entry gets valid rules; ENGINE/WEAPON `W` =
  none; others all-central. Done when after `pnpm db:seed` zero NULL `connectorRules`,
  row count = `PARTS.length`, second run changes nothing, edited row untouched.
- **A5** Admin: `entity-schemas.ts` + `entity-tuning.service.ts` — expose
  `connectorRules` (replacing `connectorLayouts`) with validation above; remove old
  footprint-cell validation. New admin editor `ConnectorRulesEditor.tsx` (4 sides ×
  kinds+weights, limits, blacklist rows) replacing `ConnectorLayoutEditor`; en + pt-BR.
  Validator also rejects non-`none` `W` for ENGINE/WEAPON (decision 1).
- **A6** `market()` attaches `connectors: ConnectorLayout | null` per listing (A2 with
  decision-7 seed); `buy()` re-derives the same value and persists it. Integration test:
  listed layout == bought instance layout (catalog + used); differs across days/slots.
- **A7** Contract: `ConnectorLayoutSchema`; `MarketListingSchema` += `connectors`
  (nullable). API contract test green.

- **A8 (found during implementation)** `autoLayout` is now connector-aware: parts carrying
  stored connectors are only placed where they connect back to the bridge. Without it,
  onboarding/kit/arrange failed (`SHIP_NOT_VIABLE`) whenever an engine's `none` side faced its
  only neighbour (10/24 market int tests failed pre-fix). Unit test varies placement order.
- **A9 (found during implementation)** `connectedPartIds` indexed a part's authored layout with
  the *rotated* footprint offsets — wrong for any non-square part at rot 90 (perimeter layouts of
  2x1/2x2 parts exposed it). Fixed with `worldToAuthoredCell` + 4-way `rotateSide`/
  `authoredSideAt` (vector-tested; regression test in `geometry.spec.ts`).

### B. Before buy (Port/Market)

- **B1** Shared read-only `apps/web/src/features/parts/connector-grid.tsx`: footprint
  grid + per-side marks (state=available); null/empty → nothing.
- **B2a** card-face mini strip (`part-card.tsx`) · **B2b** hover popup · **B2c** (i)
  detail (`part-detail.tsx` PartStatsCard). Data: `listing.connectors`.
- **B3** MSW market listing helper += default layout (`test/msw/handlers.ts`).

### C. Hangar visibility

- **C1** `hangar/connectors.ts`: uses shared contract helpers; `sideState(own,
  neighbor|null) → 'connected'|'incorrect'|'available'` (same-part neighbour n/a; own
  `none` = no mark). Table-driven tests incl. rot 0/90, engine facing (`W`→`N`), parity
  fixtures vs API geometry for the same placement.
- **C2** `ship-yard.tsx`: memo world-cell→part map; marks per cell side — class
  `conn-connected|conn-incorrect|conn-available`, shape by kind; dragging block too.
  **Legacy instances (`[]`/null) render no marks** (spec asserts; verify real API
  serialization of legacy rows first).
- **C3** `hangar.page.tsx`: `connectorsById` from inventory → yard.
- **C4** Tray port strip (`hangar/tray-part-row.tsx`).
- **C5** i18n keys en + pt-BR (legend/tooltips).
- **C6** CSS marks (`styles/index.css`), reuse tokens; check noise on 2×2.

### D. Verify & ship

- **D1** Gates: lint, typecheck (api+web+contract), web jest, API jest (unit +
  `entity-tuning`/ships/market int subsets).
- **D2** `docker compose --profile dev up -d --wait --build`; verify via
  `curl http://localhost:8080/` asset hashes.
- **D3** Manual: admin edits a type's rules → newly forged parts follow them; port card
  shows exact layout → buy → same layout in tray → place → green/blue; red only when
  none/split side faces a neighbour (rare with all-central default). Mixed hangar with
  old unmarked parts shows one-sided marks until DB reset — expected.

## Repo gotchas

- pnpm swallows jest output → from `apps/api`:
  `node --disable-warning=ExperimentalWarning --experimental-vm-modules ./node_modules/jest/bin/jest.js --selectProjects <p> --runInBand <pattern>`
- `react/jsx-no-literal`: no bare JSX strings (use `t()`)
- `keys.spec` + `i18n.spec`: every new literal key in both locales
- `noUncheckedIndexedAccess` in tsconfig
- Existing deferred failures: `throttle-store.int-spec.ts` (Redis), `production-mode.spec.ts`
- Admin edits to rules affect only parts generated afterwards; a listing re-derived after
  an edit may show a different layout than before the edit — accepted (owner decision).

## Phase E — Part direction rules (HELD: separate branch, starts only after A–D merged)

Source: owner brief "Part direction rules (engines exhaust / weapons facing)". Ports land
first so direction rules are visible while testing.

Locked: (1) **half-plane, literal** — ENGINE: no other part's cell beyond its rear edge
along facing F, across the whole ship depth; WEAPON: same in firing direction (project
occupied cells onto F; fail if another part's projection > this footprint's max
projection). (2) **`rot` becomes 0|90|180|270**; facing = rotate(default, rot); ENGINE and
WEAPON default facing `W` at rot 0 (class constant). (3) **Connector rule:** facing-side
footprint cells carry only `none` — satisfied by construction by the phase A defaults.
(4) no migration; (5) existing starter layouts may become invalid (owner resets DB).

- **E1** API `validateLayout` (`ships/geometry.ts`): new `LayoutErrorCode`s
  `EXHAUST_BLOCKED`, `FACING_BLOCKED` (`part.types.ts:47`) + facing-side connector check
  (use the already-present `_connectorsByInstance` param). Auto-layout and save/preview
  (`assertLayoutValid`) inherit it; blocked engines/weapons land in the existing omitted
  list.
- **E2** 4-way `rot` ripple: contract `PlacementSchema` (`index.ts:~155`), DTO
  `@IsIn([0,90,180,270])`, footprint dims `rot % 180 !== 0` (`geometry.ts:63-64`, client
  `hangar.geometry.ts`), auto-layout rotations `[0,90,180,270]`, rotate handler cycles 4
  (`hangar.page.tsx ~:345`), and `canPlace` mirror. Connector side rotation already 4-way
  from phase A (decision 8) — only wiring + `geometry.ts:164-181` switching from the
  `rot===0` ternary to quarter-turns.
- **E3** Client `canPlace` returns a reason (bounds/overlap/exhaust/facing) feeding the
  rotate-hint status line; optional facing arrow on engine/weapon blocks.
- **E4** Tests: geometry.spec (half-plane both classes × 4 rots; facing-side connector;
  4-angle connector rotation), auto-layout.spec, DTO/contract; web `hangar.geometry.spec`,
  `hangar.spec` (4-step rotate, blocked drop, problems panel), `ship-yard.spec` (update
  2-step rotate assumptions). **Shared test vectors** between API and web placement rules
  to prevent divergence.
- **E5** i18n en + pt-BR: `hangar.problems.EXHAUST_BLOCKED`, `FACING_BLOCKED` (+ FIX_CLASS
  map entries, `hangar.page.tsx:39`).
- **E6** Fixtures: MSW starter layout + onboarding starter ship comply with the new rules
  (or tests updated). Ops note (no code): owner resets DB/ship.
- **E7** Gates as D1–D2. Risks: connector 4-way math (mitigated by early helpers + tests),
  client/server divergence, auto-layout omitting engines often (surfaced already).

Resolved (owner): (a) the DB is being reset, so legacy instances are moot; default stays
**skip the facing-side connector check when an instance's connectors are null/empty**
(harmless, avoids bricking anything that survives). (b) **Weapons may point in any
direction** (down, up, back, forward) — covered by the 4-way `rot` (facing = rotate(`W`,
rot)); the half-plane applies only on the chosen firing side, so a weapon can sit on any
border but never in the middle of the ship. No per-type `facingSide` needed for this.

## Phase F — Tuning snapshot & restore (before the DB reset; independent of A–E)

Why: the owner has tuned values in Admin that must survive the reset. Existing tooling
covers only GameConfig (`GET/POST /v1/admin/config/bundle`, `bundle.service.ts`); the
**entity tables** (`entity-schemas.ts:758-770`: parts, materials, factions, locations,
routes, environments, mission-templates, drop-tables, ship-formats) have no export.
Chosen approach: **save then re-apply after reset** (owner OK'd). Promoting values into
code defaults is deferred (large diff, loses audit trail, conflicts with "DB wins").

- **F1** `tuning-snapshot` CLI (`src/admin/cli/`, like `reset-player.cli.ts`):
  `--export <file>` writes one JSON: GameConfig bundle + every entity table row (all
  admin-editable fields, keyed by natural key such as `partType`/`id`), with version +
  timestamp. Read-only; safe to run **now**, before any schema work.
- **F2** `--import <file>` (`--dry-run` default, `--apply` to write): upserts by natural
  key through the existing entity-tuning/bundle validators (so schema rules, audit and
  revisions apply); unknown/removed fields (e.g. old `connectorLayouts`) are reported and
  skipped, never fatal. GameConfig goes through `BundleService.import`.
- **F3** Reset runbook (docs): `export` → drop/recreate DB → `db:migrate` → `db:seed`
  (defaults fill) → `import --apply` (owner values win over seed defaults, matching the
  tuning policy) → verify counts per table. Tests: round-trip int-spec (export →
  wipe → seed → import → equal), dry-run writes nothing.
- **F4** Interaction with phase A: `connectorRules` seed defaults fill NULLs, and an
  imported snapshot taken **before** A has no `connectorRules`, so those stay at the
  seed defaults — intended. Take the snapshot first anyway (it is the only copy of the
  tuned values).

Recommendation: do **F1 first, immediately** (cheap, protects the tuned data), the rest of
F alongside or just before the reset.

**Estimate:** A–D 3–4 days; phase E +2–3 days; phase F ~1 day (admin rules editor added). **Order:** A0→A1→A2→A3→A4, A6→A7, A5,
C1, then B1–B3 / C2–C6, then D.
