# Slice 1.5: the part type subtitle, needs chips and empty-slot hints

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Commit on `develop`, one commit per task.

**Goal:** every part shows WHAT it is at a glance (a type icon + label), the "Your ship needs" paragraph becomes short chips that lead to the part that fixes the need, and the ship grid shows dashed empty slots where a needed part could go.

**Owner scope note (2026-11-24):** no browser/e2e/screenshot task in this slice; the owner reviews visually later. Unit specs and the final whole-slice review still run. The ship identity work (spider chart, Racer/Balanced, `pax`) is its own plan, `2026-11-24-ship-identity-and-spider-chart.md`, scheduled right after this slice.

**Architecture:** one pure module decides a part's finer "kind" (`partKindOf`) from its catalog (class, family name, flags), with its icon and label. The ship-grid block (`PartBlockArt`), the tray row, the store card and the info popup all read it, so a part is named the same everywhere. Needs chips reuse `lackingParts` (already pure) and the kit chip. Empty-slot hints are a pure function over the layout and the free port marks.

**Tech Stack:** React + Vite, SVG (the yard is SVG in cell units), react-i18next, Vitest + Testing Library. Kit from slices 1.1 to 1.4.

**Spec:** `docs/design/game-ui-v0.2-plan.md` sections 2 and 4 (Ship (yard)), phase 5; decided 2026-11-23: subtitle **layout B** = an icon + label row INSIDE the cell, below the connector band and above the name (never over the connection dots); at 1×1 phone size (64px) the row shrinks to the icon only. Mockup `docs/design/game-ui-v0.2/mockups/1-ship-screen.png` and the layout-B artifact decision in the roadmap.

## Global Constraints

- Work on `develop`, one commit per task. `git branch --show-current` before every commit; never `release/*`, `main`, `master`.
- Code in English; every player-facing string in en AND pt-BR, no hard-coded text; removed copy removed from both locale files unless another screen uses it (grep first).
- The installed parts on the ship stay as they are today (name, ports, condition bar, exhaust/muzzle arrow); this slice ADDS the type row and the hints. The connection dots are never abstracted or covered.
- Colour never alone: the type has an icon AND a label (label dropped only at 1×1 phone size, where the accessible name still carries it via the block's `<title>`).
- One short line per panel: the needs paragraph becomes chips; descriptions are not added to cells.
- Rarity stays the frame colour; type is the subtitle.
- 390px phone: the yard cells are small; the type row must not overlap the name, the condition bar or the dots at any zoom the yard offers.
- The prologue opening (`usePrologueMode().active`) has its own locks and a fixed ship: the new rows/chips/hints must not break its specs; the needs note is hidden in the opening today, keep it that way.
- No server change. `apps/web` must not import API code.
- Tests: run only the specs of touched files; no browser, no e2e in this slice (a grep of `apps/web/e2e` for changed literals is still required).

## Review Focus

- A part whose family name is unknown to the kind map (a future part): falls back to its class label and a generic icon, never an empty row, never a crash.
- Shield vs armor (both class DEFENSE), cabin (class CARGO with `pressurized`), life support and mining rig (class UTILITY): each gets its own kind.
- A 1×1 part, a 1×2, a 2×2, a 3×1 and a rotated part: the type row sits in the right place for the rotated footprint and never over the facing arrow, the dots or the condition bar.
- A very long pt-BR kind label on a 2-wide cell: truncated, never overflowing the block.
- Several needs at once (weapon, defense, cargo, power): chips wrap, at most N hint slots drawn (no clutter); a need whose part class is not sold here still shows the chip.
- No free port, or no free cell next to a free port: no hint slot is drawn, the chip still shows.
- The needs chips dismissed earlier (`rs.dismissedShipNeeds` in localStorage) stay dismissed.
- The unsaved-layout editing flow and the drag ghost keep working (hints must not intercept pointer events).

## File Structure

- Create `apps/web/src/features/parts/part-kind.ts` (+ spec), `part-kind-icon.tsx` (+ spec).
- Create `apps/web/src/features/hangar/empty-slot-hints.ts` (+ spec), `empty-slots-layer.tsx`.
- Modify `features/hangar/part-block-art.tsx`, `ship-yard.tsx`, `tray-part-row.tsx`, `features/parts/part-card.tsx`, `features/parts/part-detail.tsx` (the meta line), `features/market/ship-needs.tsx`, `features/hangar/hangar.page.tsx`, `styles/*.css`, both locale files.

---

### Task 1: the part kind (pure) and its icon

**Files:** create `part-kind.ts`, `part-kind.spec.ts`, `part-kind-icon.tsx`, `part-kind-icon.spec.tsx`; both locale files.

**Interfaces:**
- Consumes: `PartCatalogStats` (`apps/web/src/api/generated`): `partClass`, `partType` (family code such as `shield_basic`, `engine_chem_small`, `passenger_cabin`, `life_support`, `mining_rig`, `sensor_radar`; the full seed list is in `apps/api/prisma/seed-data/parts.ts`), and the flags the web receives (check `PartCatalogStats` for `pressurized`, `lifeSupport`, `min`; read how the web already tells a shield: `isShield` in `features/market/ship-needs.tsx`).
- Produces: `type PartKind = 'bridge' | 'engine' | 'tank' | 'battery' | 'reactor' | 'weapon' | 'shield' | 'armor' | 'hull' | 'cargo' | 'cabin' | 'sensor' | 'life' | 'mining' | 'other'` and `partKindOf(catalog: Pick<PartCatalogStats, 'partClass' | 'partType'> & {pressurized?: boolean; lifeSupport?: boolean}): PartKind`; `PART_KIND_ORDER`; `kindLabelKey(kind): string` (`hangar.partKinds.<kind>`); `<PartKindIcon kind size? />` (inline SVG, `aria-hidden`, `currentColor`, style of `features/market/part-class-icon.tsx`; one glyph per kind, generic fallback for `other`).
- Rules: classify by `partType` prefix first (`engine_`, `tank_`, `battery_`, `reactor_`, `weapon_`, `shield_`, `armor_`, `hull`, `cargo`, `passenger_cabin`, `sensor_`, `life_support`, `mining_`, `bridge`), then by the flags (`pressurized` -> cabin, `lifeSupport` -> life), then by `partClass` (ENGINE, TANK, BATTERY, REACTOR, WEAPON, DEFENSE -> armor, CARGO -> cargo, SENSOR, BRIDGE, UTILITY -> other), else `other`.

- [ ] **Step 1: Failing tests.** `part-kind.spec.ts`: one assertion per family code of the seed list (shield_basic/medium/large -> shield, armor_plate* -> armor, cargo/cargo_bay/cargo_large -> cargo, passenger_cabin -> cabin, life_support -> life, mining_rig(_heavy) -> mining, sensor_radar(_large) -> sensor, engine_chem_*/engine_ion_* -> engine, tank_* -> tank, battery_* -> battery, reactor_* -> reactor, weapon_* -> weapon, hull(_large/_small) -> hull, bridge_2x2 -> bridge); a catalog with an unknown partType and class DEFENSE -> armor; unknown everything -> other; flags win over class (CARGO + pressurized -> cabin). `part-kind-icon.spec.tsx`: every kind renders an `aria-hidden` svg; `other` renders the fallback. A spec that every `PartKind` has `hangar.partKinds.<kind>` in BOTH locale files.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement** (labels en/pt-BR: Engine/Motor, Tank/Tanque, Battery/Bateria, Reactor/Reator, Weapon/Arma, Shield/Escudo, Armor/Blindagem, Hull/Casco, Cargo/Carga, Cabin/Cabine, Sensor/Sensor, Life support/Suporte de vida, Mining/Mineração, Bridge/Ponte, Part/Peça). **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(ui): one name and icon per kind of part (pure), for the type subtitle`.

---

### Task 2: the type row inside the ship-grid cell (layout B)

**Files:** modify `features/hangar/part-block-art.tsx` (+ its spec `part-block-art.spec.tsx`), `ship-yard.tsx` only if it must pass new props (the label font / zoom), `styles/ship.css`.

**Interfaces:** consumes `partKindOf`, `kindLabelKey`, `PartKindIcon` (Task 1). `PartBlockArt` gets no new required prop (it already has `catalog`, `labelFont`, `lines`, `portMarks`, `rot`).

Layout (inside the SVG, cell units, per `docs/design/game-ui-v0.2/mockups/1-ship-screen.png` and the layout-B decision): the type row is ONE line of small text with the icon at its left, placed below the connector band (the dots sit on the cell edges, inset 0.13) and above the name (the name block is centred, nudged up 0.1 above the condition bar). Compute the row's y from the top of the footprint: `gy + 0.3` (inside the dot band) and shift the name lines down if the footprint is 1 cell tall so they cannot collide (decide a rule and pin it in tests: for height 1 the name uses at most 1 line and the type row shows the icon only; for height >= 2 icon + label). On a 1×1 cell at phone size only the icon shows. The row must not render on the bridge (its name is the type) nor on a ghost. The block's `<title>` already names the part; append the kind label to the title so it is in text for assistive tech.

- [ ] **Step 1: Failing tests** (`part-block-art.spec.tsx`): a 2×1 engine shows `data-testid="block-kind"` with the Engine label and an icon; a 1×1 part shows the icon only (no label text node) and the `<title>` contains the kind label; a 2×2 part shows icon + label above the name; a rotated 1×2 part (rot 90) places the row from the rotated footprint (assert the y/x attributes against the footprint); the bridge shows no kind row; a long pt-BR label is clipped to the block width (assert a `clip-path`/`textLength` or the shortening rule you choose); the row never overlaps the name lines: assert `rowY + rowHeight <= firstNameY` for each footprint in a table (1×1, 1×2, 2×1, 2×2, 3×1).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** Keep the existing label layout untouched for any case the table does not move. **Step 4: Run** `part-block-art.spec`, `ship-yard.spec`, `hangar.spec`: PASS.
- [ ] **Step 5: Commit** `feat(ui): each part on the ship shows its type (icon and label) inside the cell, below the ports`.

---

### Task 3: the same type everywhere a part is listed

**Files:** modify `features/hangar/tray-part-row.tsx`, `features/parts/part-card.tsx`, `features/parts/part-detail.tsx` (where `hangar.partClasses.*` builds the meta line), their specs.

**Interfaces:** consumes Task 1. Replace the class word in the meta lines (`Engine · Rare · 1×1`) by the kind icon + kind label, keeping the rest of the line. Where only the class is available or a spec asserts the class label, keep the spec green by updating it to the kind label (the kind label for an engine/weapon/tank/battery/reactor/sensor equals the old class word in en; shield, armor, cabin, life support and mining are the new precision).

- [ ] **Step 1: Failing tests:** the store card, the tray row and the part popup for a shield show "Shield" (not "Defense"), for a cabin "Cabin" (not "Cargo"), for a mining rig "Mining" (not "Utility"); an unknown family falls back to its class label; the icon is `aria-hidden` and the label is text.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** Grep `apps/web/src` and `apps/web/e2e` for `partClasses.` and for the English class words these screens used, and update the specs and e2e literals that change. **Step 4: Run** the touched specs (part-card, tray-part-row, part-detail, hangar, market-panel, port): PASS.
- [ ] **Step 5: Commit** `feat(ui): the part's type (shield, cabin, mining...) in the tray, the store and the part popup`.

---

### Task 4: the needs paragraph becomes chips

**Files:** modify `features/market/ship-needs.tsx` (+ spec), `features/market/market-panel.tsx` (the `ShipNeedsList` use), `features/hangar/hangar.page.tsx` (`ShipNeedsNote` use), `styles/*.css`, locales.

**Interfaces:** consumes `lackingParts`, the kit `BlockerChip` (or a new kit `NeedChip` variant if the red "blocked" tone does not fit: a need is advice, not a block: use the amber/neutral tone and a plus icon, in the kit style; decide and pin in the spec), `partKindOf`/`PartKindIcon` for the chip icon. `ShipNeedsList`'s props stay (`needs`, `onShow`, `onDismiss`), its output changes: one short chip per need (icon of the missing kind + the short label `market.needs.<id>` shortened to "No weapon" / "No shield"... add `market.needChip.<id>` en+pt-BR), the whole chip is the button that calls `onShow(need)` (jump to the store with that class), a small dismiss mark on the chip keeps `onDismiss` and the `rs.dismissedShipNeeds` storage; the title word `market.needsTitle` stays as a tiny label or is dropped (decide: keep as the group's accessible name). At most 4 chips; extra needs collapse into a "+N" chip that opens the first hidden one.

- [ ] **Step 1: Failing tests:** each need renders one chip with its short label and the missing kind's icon; clicking a chip calls `onShow` with that need; the dismiss mark calls `onDismiss` and the chip disappears and stays dismissed after a remount (localStorage); no needs -> nothing rendered; 5 needs -> 4 chips + a "+1" chip; the group has an accessible name; `ShipNeedsNote` still hides when `canShop` is false and in the opening; en and pt-BR keys exist for every id `lackingParts` can emit (`weapon`, `defense`, `shield`, `battery`, `power`, `cargo`).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement**, remove the old `<ul>` markup and its unused CSS and locale keys (`market.needsShow` etc.) ONLY after grepping every use (src and e2e). **Step 4: Run** `ship-needs.spec`, `market-panel.spec`, `hangar.spec`, the prologue screens spec: PASS.
- [ ] **Step 5: Commit** `feat(ui): what the ship needs, as chips that lead to the part`.

---

### Task 5: dashed empty slots on the ship where a needed part could go

**Files:** create `features/hangar/empty-slot-hints.ts` (+ spec), `empty-slots-layer.tsx` (+ spec); modify `ship-yard.tsx` (mount the layer under the blocks, `pointer-events: none` except the slot's own click), `hangar.page.tsx` (pass the needs and the "open store with class" callback), `styles/ship.css`, locales.

**Interfaces:**
- Consumes: `PortMark[]` (`features/hangar/connectors.ts`, `state: 'available'` marks carry `x, y, side, kind`), the layout's occupied cells (`footprint` from `hangar.geometry.ts`), the grid bounds the yard already knows, `ShipNeed[]` (`{id, partClass}`), `PartKindIcon`, `partKindOf` for the icon of a need (map need id -> kind: weapon->weapon, defense->armor, shield->shield, battery->battery, power->reactor, cargo->cargo).
- Produces: `emptySlotHints(input: { marks: readonly PortMark[]; occupied: ReadonlySet<string>; inBounds: (x: number, y: number) => boolean; needs: readonly ShipNeed[]; max?: number }): { needId: string; x: number; y: number; side: Side }[]`: for each need in order, the FIRST free port mark whose neighbouring cell (mark + side offset) is unoccupied and in bounds and not already taken by an earlier hint; at most `max` (default 3) hints; none when no port or no cell; deterministic. `<EmptySlotsLayer hints onPick />`: for each hint a dashed 1×1 rounded rect in the neighbour cell with the need's icon centred, `role="button"`, an accessible name "Add <kind> here" (key `hangar.slotHint`, en+pt-BR), keyboard focusable, click/Enter calls `onPick(needId)` (opens the store with that part class, the same callback the chips use).

- [ ] **Step 1: Failing tests** (`empty-slot-hints.spec.ts`): one need + one free port next to an empty in-bounds cell -> one hint at that cell; the neighbour cell occupied -> that port is skipped, the next one is used; out of bounds -> skipped; two needs never get the same cell; `max` caps the count; no marks -> []; needs [] -> []. `empty-slots-layer.spec.tsx`: renders one dashed slot per hint with an accessible name; Enter and click call `onPick` with the need id; the layer root has `pointer-events: none` while each slot keeps its own pointer events (assert the style/class) so dragging a part across still works.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** The layer renders only when the ship is in port (same `canShop` condition as the needs note) and never in the opening or while a part is being dragged (hide during `ghost`). **Step 4: Run** `ship-yard.spec`, `hangar.spec`, the two new specs, the prologue screens spec: PASS.
- [ ] **Step 5: Commit** `feat(ui): dashed empty slots on the ship where a needed part could go`.

---

### Task 6: status and the leftover check (no browser)

- [ ] **Step 1:** web unit suite once, `pnpm --filter` the web package (check `package.json`), lint + prettier on touched files, the web build.
- [ ] **Step 2:** grep `apps/web/e2e` for every literal and selector this slice changed (class words in meta lines, the old needs list markup, `needs-row`, `market.needsShow`); update literals; list any e2e spec that depends on them.
- [ ] **Step 3:** update the slice 1.5 status line in `docs/TODO_v0.1.5.md` (item 4): built and unit-tested, NOT browser-checked (owner reviews later).
- [ ] **Step 4: Commit** `docs: slice 1.5 built (status; owner reviews in the browser later)`.

---

## Self-review

- Spec coverage (phase 5): type subtitle layout B (T1, T2, T3), needs chips (T4), empty-slot hints (T5). The ship sheet's own "class" row (Hauler, Multirole...) is NOT touched here: it belongs to the ship identity plan (the spider chart and the new types).
- Names across tasks: `partKindOf`/`PartKind`/`kindLabelKey`/`PartKindIcon` (T1) feed T2, T3, T4, T5; `emptySlotHints` and `EmptySlotsLayer` are local to T5.
- Not in this slice: art for the parts (1.9; the icons here are simple inline glyphs and will be replaced by the art pass), stat pips with compare arrows, the sheet's ship type and the spider chart (ship identity plan).
- Open for the owner (defaults chosen): the finer kinds list (shield vs armor, cabin, life, mining), at most 4 need chips and 3 hint slots, hints only while docked in port.
