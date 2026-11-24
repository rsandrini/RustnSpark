# Slice 1.2: ports first-class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wherever a part is shown to buy or place, its connection ports are the biggest thing on the card, one line says whether it can join THIS ship, and the placement ghost shows every edge green or red before the drop.

**Architecture:** one pure web module answers "which of this part's ports match a free port of my ship" (kind-level, no server call; the server stays the authority on the real placement). The store card (`PartCard`) and the tray row render that verdict; the market gets a "Fits my free ports" filter and icon type tabs; a ports legend explains the dots; the yard draws per-edge colours for a part pulled from the tray, as it already does for a part dragged on the ship.

**Tech Stack:** React + Vite, react-i18next, Vitest + Testing Library, Playwright e2e. Kit from slice 1.1 (`apps/web/src/ui/kit/`: `IconTabs`, `SlotFrame`, `StatPip`, `BlockerChip`, `Tooltip`).

**Spec:** `docs/design/game-ui-v0.2-plan.md` sections 2 to 5 (phase 2), mockup `docs/design/game-ui-v0.2/mockups/2-port-and-parts.png`, master plan `2026-11-23-v0.1.5-roadmap.md` (slice 1.2).

## Global Constraints

- Work on `develop` (the owner allowed it), one commit per task. Run `git branch --show-current` before every commit; NEVER commit on `release/*`, `main`, `master`.
- Code in English; every player-facing string in en AND pt-BR in `apps/web/src/i18n/{en,pt-BR}.json`, no hard-coded text; removed copy removed from both files.
- The connection ports are shown everywhere a part appears, never abstracted: **kind = number of dots (1 central, 2 split, 3 universal), state = colour (green connected, blue free, red incompatible)**. Reuse `PortGlyph` / `ConnectorGrid` / `KindIcon` (`features/parts/connector-grid.tsx`). Join rules are `kindCompatible` in `features/hangar/connectors.ts` (the client mirror of the API rules; do not re-implement them).
- The installed parts on the ship grid stay as they are (this slice does not touch `part-block-art.tsx`).
- `apps/web` must not import API code. No server change in this slice.
- One short line per panel: descriptions move to the tooltip/info popup, not new paragraphs.
- 390px phone width on every changed screen (cards are not mocked up for phone: one column, port diagram on top).
- During work run only the specs of touched files; before the last task run the web suite once and the touched e2e specs. e2e literals that depend on changed copy must be grepped (`apps/web/e2e`).
- Prologue: the opening buys one module for one job (`usePrologueMode().active`); new verdict, filter and legend must not appear there or break its e2e (`apps/web/e2e/prologue.spec.ts`).

## Review Focus

- A listing with no stored connectors (legacy/universal fallback): no verdict, no empty box, no crash.
- A ship with no free port at all (everything connected) and an empty ship: the verdict says so (bad / neutral), never "0 of 0".
- A part whose ports are all `none` (a structure with no ports): no verdict claim of joining.
- "Fits my free ports" with the verdict unknown (ship not loaded yet, or the market opened from the Port while the ship is flying): the toggle is hidden, the list is NOT emptied.
- pt-BR label overflow on the verdict line and the legend at 390px.
- Rotation: the verdict is kind-level and rotation-independent; the card must say "can join" and never promise a placement.

## File Structure

- Create `apps/web/src/features/parts/port-fit.ts` (+ `.spec.ts`): pure verdict logic.
- Create `apps/web/src/features/parts/ports-legend.tsx` (+ spec): the dots legend and the "what joins what" table.
- Modify `apps/web/src/features/parts/part-card.tsx`, `features/market/market-panel.tsx`, `features/hangar/tray-part-row.tsx`, `features/hangar/connectors.ts` (a pure preview helper), `features/hangar/ship-yard.tsx` (drop preview marks), callers in `features/hangar/hangar.page.tsx` and `features/port/port.page.tsx`.
- Styles: `apps/web/src/styles/kit.css` (shared pieces) and the existing part-card/market CSS where `.pcard` lives (find it with grep).

---

### Task 1: the fit verdict (pure)

**Files:**
- Create: `apps/web/src/features/parts/port-fit.ts`
- Test: `apps/web/src/features/parts/port-fit.spec.ts`

**Interfaces:**
- Consumes: `Kind`, `kindCompatible`, `computePortMarks`, `PortMark` from `../hangar/connectors`; `ConnectorCell`, `PartCatalogStats`, `Placement` from `../../api/generated`.
- Produces:
  - `freeShipPorts(layout: readonly Placement[], catalogById: ReadonlyMap<string, PartCatalogStats>, connectorsById: ReadonlyMap<string, readonly ConnectorCell[]>): Kind[]`: the kind of every `available` mark of the installed layout.
  - `type PortFit = { level: 'unknown' } | { level: 'none-free' } | { level: 'no-ports' } | { level: 'full' | 'partial' | 'none'; matching: number; total: number }`
  - `portFit(candidate: readonly ConnectorCell[] | undefined, freePorts: readonly Kind[] | undefined): PortFit`.

Rules for `portFit` (decided here, the plan's contract):
- `candidate` or `freePorts` undefined, or `candidate` empty (no stored layout): `unknown`.
- candidate has no non-`none` cell: `no-ports`.
- `freePorts` empty: `none-free`.
- else `total` = candidate cells with kind not `none`; `matching` = how many of them are `kindCompatible` with at least one free ship port; `full` if matching === total, `none` if 0, else `partial`.

- [ ] **Step 1: Write the failing tests** in `port-fit.spec.ts`:
  - `portFit(undefined, ['central'])` and `portFit([], ['central'])` and `portFit([cell('central')], undefined)` are `unknown`.
  - a candidate of only `none` cells is `no-ports`.
  - `portFit([cell('central')], [])` is `none-free`.
  - candidate `[central, split]` vs free `['central']` is `{level:'partial', matching:1, total:2}`.
  - candidate `[split]` vs free `['central']` is `{level:'none', matching:0, total:1}`.
  - candidate `[universal]` vs free `['split']` is `full` (universal joins anything but none).
  - candidate `[central, central, central]` vs free `['central']` is `{level:'full', matching:3, total:3}` (kind-level: the number of free ports does not cap the count).
  - `freeShipPorts` on a two-part layout built from the vectors used in `features/hangar/connectors.spec.ts` returns only the kinds of the `available` marks (a connected pair contributes none).
- [ ] **Step 2: Run** `pnpm --filter @rustandspark/web exec vitest run src/features/parts/port-fit.spec.ts` (check the package name in `apps/web/package.json`): FAIL, module missing.
- [ ] **Step 3: Implement** both functions as specified above; `freeShipPorts` is `computePortMarks(...).filter(m => m.state === 'available').map(m => m.kind)`.
- [ ] **Step 4: Run** the spec: PASS.
- [ ] **Step 5: Commit** `feat(ui): port fit verdict (which of a part's ports match free ports of the ship)`.

---

### Task 2: the store card leads with its ports and says whether it fits

**Files:**
- Modify: `apps/web/src/features/parts/part-card.tsx`, `apps/web/src/features/market/market-panel.tsx`, `apps/web/src/features/hangar/hangar.page.tsx` (2 call sites near lines 963 and 1296), `apps/web/src/features/port/port.page.tsx` (near line 795), the CSS file holding `.pcard`, `en.json`, `pt-BR.json`.
- Test: `apps/web/src/features/market/market-panel.spec.tsx`, `apps/web/src/features/parts/part-card.spec.tsx` (create if absent).

**Interfaces:**
- Consumes: `portFit`, `freeShipPorts`, `PortFit` (Task 1); `ConnectorGrid` (`size="large"` exists in its type; add the CSS if missing); `BlockerChip`/kit chips from slice 1.1 for the verdict line.
- Produces: `PartCardProps.fit?: PortFit` (card renders nothing extra when absent or `unknown`); `MarketPanelProps.freePorts?: readonly Kind[]` (callers compute it with `freeShipPorts` from the ship layout, its installed inventory items' connectors and catalog).

- [ ] **Step 1: Failing tests.**
  - `part-card.spec.tsx`: with `fit = {level:'partial', matching:2, total:3}` the card shows `data-testid="part-fit"` with the "2 of 3 ports match free ports on your ship" text (en) and a `ok`-tone class; `full` shows the all-match text with `ok`; `none` shows `bad` and names the reason ("no free port of your ship joins these ports"); `none-free` shows "your ship has no free port"; `no-ports` shows nothing about joining; `unknown`/absent shows nothing. The large port diagram (`data-testid="connector-grid"`) renders for a part with connectors and not for one without.
  - the card lists the ports in words under the diagram: one entry per distinct (side, kind) as `N · 1 central` using `KindIcon` plus `t('connectors.kinds.*')` (reuse existing keys; add only what is missing, en AND pt-BR).
  - `market-panel.spec.tsx`: a listing renders its verdict when `freePorts` is passed; none when not passed.
- [ ] **Step 2: Run** the two specs: FAIL.
- [ ] **Step 3: Implement.** In `PartCard` move the (currently `mini`) `ConnectorGrid` out of `.pcard-meta` into a centred `large` diagram under the header; add the port-word line and the verdict line (the `.pcard-fit` strip, green or red tint per mockup `2-port-and-parts.png`, `ok` and `bad` as classes plus an icon, never colour alone). Keep the (i) button, price, condition gauge, summary and actions as they are; the summary sentence stays (stat pips are a later task, Task 5). `MarketPanel` computes `fit` per listing from `portFit(listing.connectors, freePorts)` and passes it down. Both Hangar call sites and the Port call site pass `freePorts` from `freeShipPorts(ship.layout, catalogById, connectorsById)` built from the installed inventory (build the two maps with the same code the yard already uses for `portMarks`; if that code is a local closure, extract it to a small exported helper in `features/hangar/` rather than duplicating it). The opening (`opening === true`) shows no verdict.
- [ ] **Step 4: Run** the two specs plus `hangar.spec.tsx` and `port.spec.tsx`: PASS.
- [ ] **Step 5: Commit** `feat(ui): store cards lead with their ports and say whether the part joins the ship`.

---

### Task 3: "Fits my free ports" filter and icon type tabs

**Files:**
- Modify: `apps/web/src/features/market/market-panel.tsx`, CSS, i18n (both files).
- Test: `apps/web/src/features/market/market-panel.spec.tsx`.

**Interfaces:**
- Consumes: `IconTabs` (`ui/kit/IconTabs.tsx`, read its props first), `portFit` (Task 1), `MarketPanelProps.freePorts` (Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Failing tests.**
  - With `freePorts` given, a toggle `Fits my free ports` (`aria-pressed`) appears; turning it on hides listings whose fit level is `none` or `none-free`, keeps `full`, `partial`, `unknown` and `no-ports` (a part we cannot judge is never hidden).
  - Without `freePorts` (or an empty ship layout, level unknown for all) the toggle is absent and the list is unchanged.
  - The class filter is the kit `IconTabs`: one tab per part class with an accessible name (`hangar.partGroups.*` / `partClasses.*`), "All" first, `aria-pressed`/selected state, same filtering as the old chips. The "Your ship needs" `onShow` still selects a class.
- [ ] **Step 2: Run** the spec: FAIL.
- [ ] **Step 3: Implement.** Replace the grey class chips row with `IconTabs` (icons per class: pick from the icon set the kit already uses; one glyph per class in a small map `PART_CLASS_ICON` next to the market code, with a text fallback). Search stays. Sort dropdown and "More filters" stay (their redesign is not in this slice). Add the toggle beside "Affordable". Hide the toggle while in the opening.
- [ ] **Step 4: Run** the spec plus the market and Port specs: PASS. Grep `apps/web/e2e` for the old chip labels/roles you changed and update the e2e literals.
- [ ] **Step 5: Commit** `feat(ui): icon type tabs and a Fits my free ports filter in the store`.

---

### Task 4: the ports legend and the join table

**Files:**
- Create: `apps/web/src/features/parts/ports-legend.tsx`, `ports-legend.spec.tsx`
- Modify: `market-panel.tsx` (mount it), CSS, i18n (both files).

**Interfaces:**
- Consumes: `KindIcon`, `kindCompatible`, `Tooltip`/`details` from the kit.
- Produces: `PortsLegend()`: a component with the three kinds (dots + name + count), the three state colours (connected, free, incompatible), and a "what joins what" table generated FROM `kindCompatible` (so it cannot drift): central joins central, split joins split, universal joins any, central does not join split.

- [ ] **Step 1: Failing tests.** It renders the three kinds with their dot icons; the join table has a row per pair derived from `kindCompatible` (assert the pairs `central+central`, `split+split`, `universal+central`, `universal+split` as joins and `central+split` as not); en and pt-BR labels exist (run the app's i18n key-parity check if present: `pnpm --filter @rustandspark/web test -- i18n`).
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement** as a collapsed `<details>` or a kit Tooltip opened from a "Ports?" button next to the filters (collapsed by default so the shelf stays one short line; open by default is NOT wanted). Colour states are also named in text.
- [ ] **Step 4: Run** the spec and the market spec: PASS.
- [ ] **Step 5: Commit** `feat(ui): ports legend and the what-joins-what table`.

---

### Task 5: tray rows show the part's ports and its fit

**Files:**
- Modify: `apps/web/src/features/hangar/tray-part-row.tsx`, `hangar.page.tsx` (pass `fit`), CSS, i18n.
- Test: `apps/web/src/features/hangar/hangar.spec.tsx` (or a new `tray-part-row.spec.tsx`).

**Interfaces:**
- Consumes: `PortFit` (Task 1); `SlotFrame`/`StatPip` from the kit (read their props).
- Produces: `TrayPartRowProps.fit?: PortFit`.

- [ ] **Step 1: Failing tests.** A tray row for a part with connectors keeps its mini port square; with `fit` `full`/`partial` shows a compact chip "joins N" with the `ok` tone, with `none` a `bad` chip, with `unknown`/absent nothing. The row still selects, drags and opens the (i) popup as before (existing tests stay green).
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement.** Add the compact fit chip to the row (icon + number, tooltip with the sentence). The rarity stays the frame colour (it already is a class). Do not change the drag behaviour.
- [ ] **Step 4: Run** the hangar specs touched: PASS.
- [ ] **Step 5: Commit** `feat(ui): tray rows show whether the part joins the ship`.

---

### Task 6: the placement ghost shows each edge before the drop

**Files:**
- Modify: `apps/web/src/features/hangar/connectors.ts`, `ship-yard.tsx` (the `dropPreview` block near line 957), CSS.
- Test: `apps/web/src/features/hangar/connectors.spec.ts`, `ship-yard.spec.tsx`.

**Interfaces:**
- Consumes: `computePortMarks`, `PortGlyph`; the `DropPreview` interface (`partInstanceId, gx, gy, width, height, valid`) and the connectors of the dragged part (the yard receives `connectorsById`; check whether it contains the tray part, and if not, pass it in the same prop).
- Produces: `previewPortMarks(layout, candidate: Placement, catalogById, connectorsById): PortMark[]` in `connectors.ts`: the marks of `candidate`'s own part when it is placed on top of `layout` (the candidate is added to the layout copy; marks of other parts are not returned).

- [ ] **Step 1: Failing tests.**
  - `connectors.spec.ts`: a 1×1 central-east part placed left of a part with a central-west port: its east mark is `connected`; placed beside a split port: `incorrect`; placed with nothing adjacent: `available`; the result contains only the candidate's marks.
  - `ship-yard.spec.tsx`: while a `dropPreview` is shown (existing test setup), the preview draws `port-mark` glyphs with `conn-connected` and `conn-incorrect` classes for the edges that touch neighbours.
- [ ] **Step 2: Run:** FAIL.
- [ ] **Step 3: Implement** `previewPortMarks` (reuse `computePortMarks` on `[...layout, candidate]`, filter by id) and draw its glyphs inside the `yard-ghost` group of the drop preview, in the same way the dragged ghost already does. Give the ghost's edge marks a larger/outlined style (`.yard-ghost .conn-mark`) so green/red reads over the dashed cell; no colour-only meaning: the existing `<title>` text on the glyph stays. The cell-fit `ok`/`bad` outline is unchanged.
- [ ] **Step 4: Run** both specs plus `hangar.geometry.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat(ui): the placement ghost shows each edge connecting or not before the drop`.

---

### Task 7: browser check, e2e, screenshots, status

**Files:**
- Modify: e2e literals that changed (`apps/web/e2e/*.spec.ts`), `docs/TODO_v0.1.5.md` (status line), the plan's status.
- Create: screenshots `docs/design/game-ui-v0.2/after/1-2-*.png`.

- [ ] **Step 1:** Run the web unit suite once (`pnpm --filter @rustandspark/web test`), lint and prettier on the touched files, `pnpm --filter @rustandspark/web build`.
- [ ] **Step 2:** On the isolated verification stack (recipe in memory `reference_browser_smoke_local.md`: compose project `rs_verify`, ports 3901/8901, never the owner's stack) open a port with the Store tab at 1280px and at 390px: card diagram size, verdict line, toggle, tabs, legend, the ghost while dragging from the tray. Check there is no horizontal scroll at 390px and no layout jump when the market loads. Take screenshots `1-2-store-desktop.png`, `1-2-store-phone.png`, `1-2-ghost-desktop.png`.
- [ ] **Step 3:** Run the e2e specs for the touched flows (`apps/web/e2e`: market/ship/prologue-related; the prologue e2e must still pass because the opening shows none of the new UI). Stale failures that already fail on `develop` (a11y popup, smoke, pt-BR widths) are reported, not fixed here.
- [ ] **Step 4:** Update the slice 1.2 status line in `docs/TODO_v0.1.5.md`.
- [ ] **Step 5: Commit** `docs: slice 1.2 verified (screenshots and status)`.

---

## Self-review

- Spec coverage (phase 2 of the UI plan): store cards with port diagram and verdict (Task 2), "Fits my free ports" and icon type tabs (Task 3), legend and join table (Task 4), tray rows with the mini square (Task 5, the square exists; the new part is the fit chip), ghost edges green/red (Task 6). The "does it need the server" open question is closed: web-only, kind-level.
- Type consistency: `PortFit`, `freeShipPorts`, `portFit` (Task 1) are the only names the later tasks use; `MarketPanelProps.freePorts` (Task 2) feeds Task 3.
- Not in this slice: stat pips with compare arrows on the card (the sentence summary stays; revisit with 1.3's card variants), the description-to-tooltip move, the Port-as-a-place scene (1.8).
