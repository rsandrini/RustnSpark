# Owner review fixes: ship sheet, store cards, repair, refuel, upgrade (2026-11-25)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Commit on `develop`, one commit per task.

**Goal:** fix what the owner found reviewing slices 1.1 to 1.5 and the ship identity block in the dev instance. The owner's words (numbering as sent; there was no item 7):

1. The part icons (the type row inside the ship-grid cell) must be centred, not left-aligned.
2. The 7-axis chart on the ship sheet is a bad layout: it takes most of the space and the info at its side cannot be read. Alternate between the two views.
3. A ship typed "Guerra - armado" (Warship, armed) has its smallest point on Defense. The owner needs to understand the numbers behind the chart; it is hard to see (even for the poor initial ship).
4. No need to describe the connections in the store/parts card. The cards are too big: add a switch between the big card view (current) and a small list view. Also put the part's icon INSIDE the part drawing.
5. A placeholder for the part's icon (art) in the store.
6. Repair tab: ONE bar to drag, not "current" plus a second bar beside it.
8. Same for refuel. Also a small chart of the tanks with the fuel in each, instead of a plain bar.
9. Everywhere parts are listed we list the part's details: remove them from the component. And a better way to show what an upgrade changes: a small drawing of the ship with the upgraded part highlighted.

**Owner scope note:** no browser/e2e/screenshot task; the owner reviews visually later. Unit specs and the final whole-block review still run. No retro-compat for old missions (not relevant here).

**Architecture:** presentational web changes, plus ONE small server addition (task 2): the profile response also carries each axis' raw value and its reference, so the sheet can say "Defense 6%: 4.2 of 70". Everything else is web only.

**Tech Stack:** React + Vite, SVG, react-i18next, Vitest + Testing Library; NestJS only for task 2 (api unit specs; no docker).

## Global Constraints

- Work on `develop`, one commit per task. `git branch --show-current` before every commit; never `release/*`, `main`, `master`. Pushing `develop` is allowed.
- Code in English; every player-facing string in en AND pt-BR, no hard-coded text; copy removed from the UI is removed from both locale files unless another screen still uses it (grep first, including `apps/web/e2e`).
- Colour never alone; icons aria-hidden with text/tooltip names; 390px phone: no horizontal overflow, controls reachable.
- The connection DOTS stay everywhere they are today (the owner only asked to drop the DESCRIPTION of the connections in the store/parts card: the "N · 1 central" words line); the "can join" verdict line stays.
- `apps/api/src` must not import the contract package (task 2); admin owns tunables (task 2 adds no knob).
- The prologue opening (`usePrologueMode().active`) has its own locks and reduced sheet: new toggles/lists must not break its specs; the profile view/toggle is not shown in the opening.
- Tests: run only the specs of touched files; no browser; grep `apps/web/e2e` for changed literals/selectors (the repair/refuel e2e use `data-testid`s `repair`, `repair-summary`, `refuel-panel`, `refuel-summary`, `refuel-cost`, `repair-busy`, the sliders by `aria-label`): keep them.

## Review Focus

- Sliders: the single bar must still let the pilot see the CURRENT value AND the chosen target, must work with keyboard (arrow keys, Home/End) and touch, expose the same `aria-label`s/values the specs and e2e use, and never allow a target below the current condition (repair) or above the tank space (refuel).
- A ship with no tanks (pure ion: nothing to refuel), one tank, several tanks of different sizes: the tank chart scales by capacity and says what it shows (the ship's fuel is ONE shared pool: do NOT invent a per-tank amount the server does not have; if per-tank fuel is not available, every tank shows the same fill fraction and the caption says "fuel is shared").
- The ship mini drawing in the Upgrade tab: a layout with 1 part, with parts outside the hull, with rotated parts; the highlighted part is found by instance id; no crash when a part has no placement (loose part).
- Store list view: a listing with no connectors, a used listing, a broken one; the view choice is remembered (localStorage in try/catch) and defaults to the current big cards; the opening shows the big view only.
- The type icon centring for 1x1, 1x2, 2x1, 2x2, rotated parts, and its overlap rules with the name lines and the dots (the geometry rules from slice 1.5 stay).
- The profile/stats toggle on the sheet: the radar view must show readable numbers (no tiny labels), and the stats view must be the default (it is what pilots read every day).

## File Structure

- Server (task 2): `apps/api/src/ships/ship-profile.ts`, `ships.service.ts` (`shipIdentityOf`), `stats/profile.*` if needed, `packages/contract/src/index.ts`, specs.
- Web: `features/hangar/part-block-art.tsx`, `ship-sheet-panel.tsx`, new `features/hangar/profile-breakdown.tsx`, `features/parts/part-card.tsx`, new `features/parts/part-row.tsx` and `store-view-toggle.tsx`, `connector-grid.tsx`, `features/market/market-panel.tsx`, `features/hangar/tray-part-row.tsx`, `features/port/port.page.tsx` (repair, refuel, upgrade tabs), new `ui/kit/ConditionSlider.tsx`, `ui/kit/TankChart.tsx`, `ui/kit/ShipMiniMap.tsx`, styles (`kit.css`, `ship.css`, `port.css`, `parts.css`), both locale files.

---

### Task 1: the type icon is centred in its cell (item 1)

**Files:** modify `features/hangar/part-block-art.tsx` (+ `part-block-art.spec.tsx`), `styles/ship.css` if needed.

Today the type row sits at `x = gx + 0.16` (left-aligned). Centre it horizontally: the icon alone is centred in the footprint; icon + label is centred AS A GROUP (compute the group's width from the icon size and the fitted label width, then start at `gx + (width - groupWidth) / 2`); keep every vertical rule and the overlap rules (never over the dots, the facing arrow, the condition bar). The existing `blockTextLayout` returns the row geometry: extend it with the row's x and width and pin them in the table spec.

- [ ] **Step 1: Failing tests:** for 1x1 (icon only), 1x2, 2x1, 2x2, 3x1 and a rot-90 1x2 the row's centre x equals the footprint's centre x within a small tolerance (icon only: icon centre; icon + label: group centre); the render-level assertion (the svg icon's x + half its width = block centre x) for 2x1 and 2x2; the vertical rules from slice 1.5 still hold (the existing table).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `part-block-art.spec`, `ship-yard.spec`, `hangar.spec`: PASS.
- [ ] **Step 5: Commit** `fix(ui): the part type icon is centred in its cell`.

---

### Task 2: the profile response carries each axis' value and reference (items 2, 3: data)

**Files:** `apps/api/src/ships/ship-profile.ts` (+ spec), `ships.service.ts` (`shipIdentityOf`), `apps/api/src/stats/profile.service.ts` and `profile.types.ts` if the public card should carry it (it need not: the sheet is the consumer; keep the public profile as is), `packages/contract/src/index.ts` (`ShipProfileDetailSchema`), contract/web fixtures (`profile-fixtures.ts`, sandbox ship, msw handlers).

**Interfaces:** `deriveShipProfileDetail(sheet, rules): Record<ProfileAxis, { value: number; ref: number }>` next to `deriveShipProfile` (same inputs: `value` = the raw number each axis is computed from: cargo `sheet.crg`; passengers `min(pax, lifeCap)`; firepower `sheet.pdf`; defense `sheet.esc + sheet.bli * armor_pool_factor`; mobility the raw mobility; range `sheet.autonomy` (0 for no engine; the ion special-case keeps value 0 but ref stays); mining `sheet.min`; `ref` = the config reference). `shipIdentityOf` returns `profileDetail` next to `profile`/`profileModifier` on the ship, preview and profile-of-me responses (NOT required on the public card). Contract: `profileDetail: z.record(ProfileAxisSchema, z.object({ value: z.number(), ref: z.number() }))` optional on the ship/preview responses so older fixtures parse (new payloads always carry it).

- [ ] **Step 1: Failing tests:** `deriveShipProfileDetail` returns, per axis, the raw value and the ref the profile used: `profile[axis] === min(1, value/ref)` for every axis for a fixed sheet and rules (property test over 3 sheets); an ion ship (no fuel use, has an engine) keeps `range` profile 1 while the detail value is 0? (decide: value = autonomy as the sheet says (0) and add `unlimited: true`? KEEP IT SIMPLE: for an ion ship report `value: ref` so value/ref = 1 and the UI shows "unlimited" through the existing sheet text: pin this in the spec); `shipIdentityOf` carries `profileDetail`; the contract parses a ship response with and without it.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** the api specs of ships/profile and the contract test file that runs without docker; add `profileDetail` to the web fixtures where TypeScript requires it.
- [ ] **Step 5: Commit** `feat: the ship profile also returns each axis' value and reference`.

---

### Task 3: the sheet alternates between Stats and Profile; the Profile explains its numbers (items 2, 3)

**Files:** modify `features/hangar/ship-sheet-panel.tsx` (+ spec), `features/hangar/hangar.page.tsx` (pass `profileDetail`), create `features/hangar/profile-breakdown.tsx` (+ spec), `styles/ship.css`, locales.

**Behaviour:** the sheet gets a two-button segmented control "Stats | Profile" (kit style, `aria-pressed`, remembered per browser in localStorage with try/catch, default Stats, hidden in the opening and in `compact`). Stats view = the headline tiles/full stats exactly as before WITHOUT the radar. Profile view = the radar at a readable size (about 220px, with labels) plus `ProfileBreakdown`: one row per axis (icon, name, a bar of its percent of the reference, the raw value over the reference "4.2 / 70", the percent), the axis that NAMES the type marked ("main") and the modifier axis marked ("second"), and one line under the title: why the ship has this type ("Warship: firepower and defense lead the profile (52% of its shape)": use the share the type rule uses: compute shares in the web from the profile with the same rule as the server: or better have the server send `profileShares`? NOT in this task: show only the main/second marks and the percents). A short help line: "Each bar is the ship's stat over a reference value; the type is the axis that leads." The ghost (preview) is shown on the radar only, and the breakdown rows show a small "+/-" delta versus the saved ship when a preview exists.

- [ ] **Step 1: Failing tests:** the toggle switches views and is remembered; Stats view has no radar, Profile view has the radar and the breakdown; each axis row shows name, value/ref and percent (use `profileDetail`) and the main/second marks follow `shipClass`/`profileModifier`; with a preview, the rows show the delta versus the saved profile; no toggle in the opening/compact; missing `profileDetail` -> rows show only the percent (no crash); pt-BR labels exist.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** The radar keeps its props; only the panel layout changes (`.sheet-top` loses its radar column). **Step 4: Run** `ship-sheet-panel.spec`, `hangar.spec`, prologue specs, i18n specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): the ship sheet alternates between its stats and its profile, and the profile explains its numbers`.

---

### Task 4: store cards without the connection words; a small list view; the part icon in the drawing; an art placeholder (items 4, 5)

**Files:** modify `features/parts/part-card.tsx` (+ spec), `features/parts/connector-grid.tsx` (+ spec), `features/market/market-panel.tsx` (+ spec), create `features/parts/part-row.tsx` (+ spec), `features/parts/store-view-toggle.tsx` (+ spec), `ui/PartThumb.tsx` or a new `features/parts/part-art-placeholder.tsx`, styles, locales.

**Behaviour:**
- Remove the port-words line ("North · 2 × Central connector") from `PartCard`; keep the connector DIAGRAM and the "can join" verdict line.
- `ConnectorGrid` (large size) draws the part's kind icon (`PartKindIcon`, `partKindOf`) centred INSIDE the footprint (low-contrast, behind the dots); `mini` size unchanged.
- A placeholder for the art: the card's art slot (the `PartThumb` area) becomes a framed tile with the kind icon on a rarity-tinted background and a subtle "art coming" look (no text); one shared component `PartArt` used by the card and the row, so slice 1.9's real art replaces one place.
- A view switch in the store: "Cards | List" (kit segmented, remembered in localStorage with try/catch, default Cards, hidden in the opening): the List view renders `PartRow`: one compact row per listing (art tile 40px, name, kind + size, a fit chip, price, condition if used, the Buy button and the (i) info button); no summary sentence; the hover compare card still works.

- [ ] **Step 1: Failing tests:** the card shows no port-words line and still shows the diagram and the verdict; the large diagram contains the kind icon, the mini one does not; the placeholder tile renders the kind icon with the rarity class; the toggle switches between `pcard` articles and `part-row` rows, is remembered and absent in the opening; a row shows name, kind, price, buy button, fit chip, no summary text; used/broken listings keep their tags; en/pt-BR keys for the toggle labels.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** Remove `connectors.portLine` and related keys only after grepping (src and e2e). **Step 4: Run** `part-card.spec`, `connector-grid.spec`, `market-panel.spec`, new specs, `port.spec`, `hangar.spec`, prologue screens spec, i18n specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): store cards without the connection words, a compact list view, the part icon in the drawing and an art placeholder`.

---

### Task 5: no stat sentences in the part lists, and the Upgrade tab shows the ship with the part highlighted (item 9)

**Files:** modify `features/parts/part-card.tsx`, `features/hangar/tray-part-row.tsx`, `features/parts/part-row.tsx`, `features/port/port.page.tsx` (Upgrade tab and any other list rendering `partSummary`), specs, create `ui/kit/ShipMiniMap.tsx` (+ spec), styles, locales.

**Behaviour:**
- Remove the `partSummary` stat sentence (`pcard-summary`, the tray row's second meta line, the repair/upgrade rows) from every LIST component; the details stay in the (i) popup and the hover compare card (unchanged). Keep one short line only where it is the decision itself (price, condition).
- `ShipMiniMap({ layout, catalogById/footprints, highlightId, size })`: a small SVG of the ship (every placed part as a small rounded rect in its footprint, neutral fill, the ship's bounds fitted into the viewBox), the part with `highlightId` drawn in the brass accent with a pulsing outline (respecting `prefers-reduced-motion`), parts outside the hull faded; `aria-label` "Part to upgrade: <name>". Used in each Upgrade candidate card: left the mini map highlighting where the part sits, right the current -> upgraded comparison as today (the existing `PartDetail versus` hover/popup content stays).

- [ ] **Step 1: Failing tests:** the store card, tray row, part row and port rows render no summary sentence (assert the `partSummary` text is absent) but the (i) button and hover card still show it; `ShipMiniMap` draws one rect per placed part and highlights the one with the given id, none when the id is unknown, ignores parts without a placement, fits rotated footprints (use the footprint helper from `hangar.geometry`); an Upgrade card renders the mini map with the highlight for its part; reduced motion drops the animation class.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** Grep every `partSummary` use; remove the unused export only if nothing else imports it. **Step 4: Run** the touched specs + `port.spec`, `hangar.spec`, `market-panel.spec`, i18n: PASS.
- [ ] **Step 5: Commit** `feat(ui): part lists without stat sentences, and the upgrade tab shows the ship with the part highlighted`.

---

### Task 6: one bar to drag in the Repair tab (item 6)

**Files:** create `ui/kit/ConditionSlider.tsx` (+ spec), modify `features/port/port.page.tsx` (the repair rows), `styles/kit.css` and `port.css`, locales if needed.

**Behaviour:** a single control per part: a track showing the part's CURRENT condition as the filled part (tone by condition) with a tick, and the draggable thumb for the TARGET; the filled/hatched segment between current and target shows what will be repaired and its cost label ("62% -> 90%") sits beside it; the thumb cannot go below the current value; implemented as a real `<input type="range">` (min = current, max = 100, step as today) layered over the visual track so keyboard/touch/accessibility come free; the old separate `Gauge` for the part is removed. Keep the existing `aria-label`s (`port.repairSlider`) and the row's cost/over-budget styling and `data-testid`s.

- [ ] **Step 1: Failing tests:** the component renders one range input whose min is the current value and max 100, the thumb value is the target, the visual shows the current fill and the repair segment (width proportional), keyboard arrows change the target within [current, 100], a destroyed part (condition 0) works, the target cannot go below the current; the repair rows render exactly ONE slider and no separate gauge per part (assert the old gauge's aria-label is gone) with the same `aria-label` for the slider; existing repair specs/e2e selectors keep working (update literals only if the markup forces it).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `port.spec` (repair cases), the new spec, i18n: PASS.
- [ ] **Step 5: Commit** `feat(ui): one bar to drag in the repair tab (current condition and target in the same control)`.

---

### Task 7: one bar in the Refuel tab and a chart of the tanks (item 8)

**Files:** create `ui/kit/TankChart.tsx` (+ spec); modify `features/port/port.page.tsx` (refuel tab; reuse `ConditionSlider` generalized or a sibling `AmountSlider` in the kit), `styles/kit.css`, locales.

**Behaviour:** the refuel tab shows ONE slider (current fuel as the filled part, the target as the thumb, max = tank space; same rule as repair: cannot go below the current) instead of the `Gauge` plus the separate range input; and a `TankChart` above it: one vertical tank glyph per installed tank part (height proportional to its `fuelCap`, a fill at the ship's fuel fraction, the target shown as a lighter fill / dashed level line, a short label with each tank's capacity), a caption "fuel is shared by all tanks" (the server keeps one pool: do NOT invent per-tank amounts), total "fuel / capacity" under it. With no tank data (unlikely) the chart is hidden. Keep the summary (now/add/after), the price row, `data-testid="refuel-panel"`, `refuel-summary`, `refuel-cost`, the Fill/Half buttons and the slider's `id`/label (`refuel-amount`).

- [ ] **Step 1: Failing tests:** `TankChart` draws one glyph per tank with heights proportional to capacity, the fill fraction equals fuel/cap for every tank, the target level line appears when a target above the current is given, one tank / three tanks / no tanks; the refuel tab renders ONE slider and no separate gauge, the slider cannot go below the current fuel, the summary and cost testids still render, Fill sets the target to the tank space; en/pt-BR captions exist.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `port.spec` (refuel cases), new specs, i18n: PASS.
- [ ] **Step 5: Commit** `feat(ui): one bar in the refuel tab and a chart of the tanks`.

---

### Task 8: status

- [ ] **Step 1:** api unit specs of touched modules (`pnpm test:unit` in `apps/api`, the known `test/unit/sim/store.spec.ts` better-sqlite3 failure aside) and the whole web suite once, `tsc --noEmit` for api, web and contract, eslint + prettier on files changed since the plan commit, the web build.
- [ ] **Step 2:** grep `apps/web/e2e` for literals/selectors these tasks changed (repair/refuel sliders, store list, port words, sheet radar) and update clear literal changes; list the e2e specs that depend on them.
- [ ] **Step 3:** note in `docs/TODO_v0.1.5.md` (item 4 and 6 lines): owner review round 1 done (the nine points), NOT browser-checked.
- [ ] **Step 4: Commit** `docs: owner review round 1 built (status)`.

---

## Self-review

- Coverage: 1 (T1), 2 and 3 (T2 + T3), 4 and 5 (T4), 9 (T5), 6 (T6), 8 (T7); the owner's item 7 does not exist (skipped in the message).
- Names across tasks: `profileDetail` (T2) feeds T3; `PartArt`/`PartRow` (T4) are reused by T5; `ConditionSlider` (T6) is generalised for T7.
- Interpretations to confirm with the owner (defaults chosen): "icons in the parts ... centralised" = the TYPE icon in the ship-grid cell; "the icon of the part INSIDE the part draw" = the kind icon inside the large connector diagram on the store card; "placeholder in the parts icons in the buy" = a framed art tile with the kind icon; "remove the details in the component" = remove the stat sentence from lists (details stay in the (i) popup and hover card); the tank chart shows the SHARED pool (the server has no per-tank amounts).
- Not in this plan: real part art (slice 1.9), per-tank fuel from the server.
