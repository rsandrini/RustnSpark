# Slice 1.3: contract cards, blocker chips that jump to the fix, icon filters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Commit on `develop`, one commit per task.

**Goal:** the mission board reads as a stack of contracts: who sent it, where it goes, how risky, how long, what it pays, and, when the ship cannot take it, red chips naming the exact missing thing, each one a link to the fix. The type filter becomes icon tabs. The structure is built so a NEW mission kind (slice 2.3: fuel transport, explore, repair, fight) is one more entry in a registry, not a new layout.

**Architecture:** the board keeps its data flow (`BoardPage` -> `MissionRow` -> `MissionCard`). The row's FACE is redone as the contract card (portrait with faction ring, route with arrow, risk pips, time, big reward, one action). The details fold (full `MissionCard`, route map, requirements checklist, race field, mining panel) stays as it is, below the face. A small pure module maps every requirement/reason code to a "fix target" and to a link; a registry maps every mission type to its icon and label.

**Tech Stack:** React + Vite, react-i18next, Vitest + Testing Library, Playwright e2e. Kit from slice 1.1 (`apps/web/src/ui/kit/`: `BlockerChip`, `IconTabs`, `RiskPips`, `StatPip`, `Tooltip`) and slice 1.2 (`PortsLegend`, `part-class-icon.tsx` for icon style).

**Spec:** `docs/design/game-ui-v0.2-plan.md` section 4 (Missions row) and phase 3; mockup `docs/design/game-ui-v0.2/mockups/3-contracts.png`; roadmap `2026-11-23-v0.1.5-roadmap.md` slice 1.3.

## Global Constraints

- Work on `develop`, one commit per task. `git branch --show-current` before every commit; never `release/*`, `main`, `master`.
- Code in English; every player-facing string in en AND pt-BR, no hard-coded text; copy removed from the UI is removed from both locale files unless another screen still uses it (grep first).
- One short line per panel; the same problem is told ONCE (the mockup's complaint: banner + bullet list + empty state).
- Symbols never carry meaning alone: risk pips have a text label, blocker chips have text, tone has an icon.
- 390px phone width: the card is one column, the action stays reachable without horizontal scroll (the phone card keeps `foldDetails` behaviour: details behind "Details").
- The prologue opening (`usePrologueMode().active`, sandbox offers) shows every job, even blocked ones, and its e2e (`apps/web/e2e/prologue.spec.ts`) selects on current labels/test ids: keep `data-testid`s (`board-active-mission`, `starter-badge`, `fuel-chip`, `req-*`, `mcard-*`) and grep the e2e for any literal you change.
- No server change (offers already carry `info.requirements`, `eligibility.reasons`, `info.giver`, `info.estimate`, destination risk band).
- `apps/web` must not import API code.
- Tests: run only the specs of touched files; before the last task run the web suite once and the touched e2e specs.

## Review Focus

- A ship that can take NO offer (no bridge/engine/hold): the board shows the ONE chips line of ship faults once, and every card shows its own chips; the list is not empty; at least the starter job is takeable (`starter-badge`).
- A requirement code with no mapped fix (unknown/new code): the chip still renders as plain text (no link), never a crash and never a dead button.
- Offers of every type (DELIVERY, TRANSPORT, ESCORT, MINING, RESCUE, RACE, and TRAVEL/SCAVENGE if they appear): icon, label, face render; an unknown type falls back to a generic icon and the raw type text.
- A giver with no portrait / `info.giver == null` (offers from before givers): the face shows the faction badge instead; no broken image.
- A pinned/taken mission (`tag`, `taken`) keeps its status badges, countdown and actions.
- pt-BR chip labels longer than en: wrap to two lines inside the card at 390px, never overflow.
- Reward of 7 digits, title of 60 characters: truncate/wrap cleanly.

## File Structure

- Create `apps/web/src/features/board/requirement-fix.ts` (+ spec): code -> fix target.
- Create `apps/web/src/features/board/mission-kinds.tsx` (+ spec): registry type -> icon, label key.
- Create `apps/web/src/features/board/contract-face.tsx` (+ spec): the card face used by `MissionRow`.
- Create `apps/web/src/features/board/board-filters.tsx` (+ spec): icon tabs + toggle + sort.
- Modify `mission-row.tsx`, `board.page.tsx`, `features/hangar/hangar.page.tsx` (deep link), `features/port/port.page.tsx` (already has `?tab=`), `styles/missions.css` and `styles/kit.css`, both i18n files.

---

### Task 1: where each blocker leads (pure) and the deep link

**Files:** create `requirement-fix.ts`, `requirement-fix.spec.ts`; modify `features/hangar/hangar.page.tsx` (read `?store=<PARTCLASS>` once: open the Store side tab with that class preset), its spec.

**Interfaces:**
- Produces: `type FixTarget = { kind: 'store'; partClass: string } | { kind: 'refuel' } | { kind: 'ship' } | { kind: 'none' }` and `fixOf(code: string): FixTarget`, `fixHref(target: FixTarget): string | undefined` (`/ship?store=CARGO`, `/port?tab=refuel`, `/ship`, undefined for none).
- Mapping (the contract of this task): `CARGO_TYPE` -> store CARGO; `PRESSURIZED_LIFE_SUPPORT` -> store `LIFE_SUPPORT` (check the real part class names in `apps/web/src/i18n/en.json` `hangar.partClasses` and in `ship-needs.tsx`; the cabin and the life-support module may be two classes: the chip names the missing one when `req.message` says so, otherwise targets the cabin class); `WEAPONS` -> store WEAPON; `MIN_MOBILITY`, `SPEED`, `RACE_SPEED` -> store ENGINE; `MINER` -> store MINING class (check the real class); `FUEL_CAPACITY` -> store TANK class (check); `NO_BRIDGE`, `NO_ENGINE`, other hangar problem codes (`hangar.problems.*`) -> ship; fuel short (`fuel-chip` states) -> refuel; unknown -> none.
- Consumes: the part-class names used by `MarketPanel` (`listing.catalog.partClass`).

- [ ] **Step 1: Failing tests.** `requirement-fix.spec.ts`: each code above maps as listed (assert partClass strings against the real ones you looked up); an unknown code is `{kind:'none'}` and `fixHref` undefined. `hangar.spec.tsx`: opening `/ship?store=CARGO` selects the Store side tab with the CARGO tab selected; no param keeps today's behaviour; an invalid class value is ignored.
- [ ] **Step 2: Run** the two specs: FAIL.
- [ ] **Step 3: Implement.** Read the param with `useSearchParams` once on mount (do not fight the existing state: `setSideTab('store')` + `setStoreClass(value)`), then drop the param so a later tab change is not undone.
- [ ] **Step 4: Run** specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): where each mission blocker leads, and a deep link into the ship store`.

---

### Task 2: the mission kind registry

**Files:** create `mission-kinds.tsx`, `mission-kinds.spec.tsx`; i18n (only for a generic fallback label).

**Interfaces:**
- Produces: `missionKind(type: string): { icon: ReactNode; labelKey: string }` and `MISSION_KIND_ORDER: readonly MissionType[]` (the filter order: DELIVERY, TRANSPORT, ESCORT, MINING, RESCUE, RACE). One inline-SVG icon per kind in the style of `features/market/part-class-icon.tsx`; `aria-hidden`; label key is the existing `board.type.<TYPE>`. Unknown type -> generic flag icon and `labelKey: 'board.type.unknown'` (add to both locales).

- [ ] **Step 1: Failing tests:** every `MissionType` of `api/generated` has an entry (iterate the type's literals via a typed array in the spec so a new generated type fails the test); unknown type returns the fallback; labels exist in both locale files (use the existing i18n parity spec or `keys.spec.ts` pattern).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(ui): one registry for the mission kinds (icon and label), so a new kind is one entry`.

---

### Task 3: the contract face

**Files:** create `contract-face.tsx`, `contract-face.spec.tsx`; modify `mission-row.tsx` (replace the head/key/why block by `<ContractFace .../>`; keep `mrow-main` grid, the map column, the details fold, the pinned tag, status badges, expiry countdown, `fuel-chip`, the actions slot and all `data-testid`s), `styles/missions.css` (+ kit.css for shared bits), both locales.

**Interfaces:**
- Consumes: `missionKind` (Task 2), `RiskPips` (map the destination risk band `lo|md|hi` to level 1|2|3, the label from the existing `RiskBadge` strings), `GiverBadge`/`giverBadgeOf` (portrait), `FactionBadge`, `formatDuration`, `fixOf`/`fixHref` (Task 1), `BlockerChip`.
- Produces: `ContractFace` props `{ offer, origin, destination, taken, fuel, burnsFuel, expired, tag?, actions }` (reuse the row's already computed values; do not recompute in the face what the row computed).

Face content, top to bottom, as the mockup: a portrait with a faction-coloured ring (fallback: faction badge) at the left; title; `Origin -> Destination` with a dashed arrow; below it RiskPips (with text label for assistive tech), the duration, the mission type (icon + label); at the right the reward large and the single action (Accept, or a disabled "Locked" when not eligible; taken missions keep their current actions). Fuel: the existing `fuel-chip` stays. Blockers: ONE row of chips under the route = the unmet requirements (`info.requirements` where `!met`, with the actual/needed numbers in the chip label when present, as the row shows today) plus the reasons the checklist does not already name (`eligibility.reasons` minus requirement codes, the same dedupe `MissionCard` does). Each chip: `BlockerChip` with `href`/`onFix` from `fixHref`; a `none` target renders a plain chip. Remove the old `mrow-why` list. Phone: reward and action move under the title; chips wrap.

- [ ] **Step 1: Failing tests** (`contract-face.spec.tsx`, plus the existing row/board specs updated): an eligible offer shows the reward, the Accept action and no chips; a blocked offer shows one chip per unmet requirement with the number text, the Locked state, and each chip is a link with the right href (store CARGO, etc.); an unknown code renders a non-link chip; risk pips carry the band's word as the accessible name; a `giver == null` offer renders the faction badge, no broken image; a pinned/taken offer keeps its tag, status badge and countdown; an expired offer shows the expired label and no active Accept; the fuel chip still shows when fuel is short.
- [ ] **Step 2: Run** `board.spec.tsx`, `mission-card.phone.spec.tsx`, `givers.spec.tsx`, the new spec: FAIL where new.
- [ ] **Step 3: Implement.** Keep `MissionCard` (the details) untouched except for what Task 3 forces. Grep `apps/web/e2e` for every literal and role the old face used (`mrow-why`, the Accept button names) and update the e2e in this task.
- [ ] **Step 4: Run** the specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): contract cards (portrait, route, risk pips, reward) with blocker chips that lead to the fix`.

---

### Task 4: one place for the ship-wide problem, icon filters

**Files:** create `board-filters.tsx`, `board-filters.spec.tsx`; modify `board.page.tsx` (use it; the ship-fault chips group already exists: make its chips use `fixHref` so they lead to the real fix, not always `/ship`; keep `EmptyShipNotice`/`EscortNotice` only if they say something the chips do not, otherwise remove them and their locale keys), `styles/missions.css`, locales.

**Interfaces:**
- Consumes: `IconTabs` (read its props), `MISSION_KIND_ORDER`/`missionKind` (Task 2).
- Produces: `BoardFilters` props `{ type: MissionType | 'all'; onType; counts: Partial<Record<MissionType, number>>; onlyEligible: boolean; onOnlyEligible; sort: SortKey; onSort; showEligibleToggle: boolean }` (export `SortKey` from here or keep it in `board.page.tsx` and import the type).

Behaviour: icon tabs (All + one per kind present on the shelf, never a tab for a kind with 0 offers except the selected one), each with an accessible name and a small count; the "only what I can take" toggle (hidden in the opening, as today); the sort dropdown stays (its redesign is not in this slice). The old chips row is removed. The "Your ship cannot take missions right now. Fix this first" paragraph is not duplicated: the ship-fault chips line is the one place.

- [ ] **Step 1: Failing tests:** tabs render per kind with counts; selecting filters the list; the toggle hides blocked offers and is absent in the opening; the sort still orders; ship-fault chips link to their fix (no bridge -> `/ship`, short on fuel -> refuel); the empty-ship notice text no longer appears twice (assert the sentence once).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `board.spec.tsx` + the new spec + prologue screens spec: PASS. Update e2e literals (old chip roles/labels).
- [ ] **Step 5: Commit** `feat(ui): icon type tabs on the board, and the ship's problems told once`.

---

### Task 5: browser check, e2e, screenshots, status

- [ ] **Step 1:** web unit suite once, lint + prettier on touched files, `pnpm --filter` web build.
- [ ] **Step 2:** isolated stack (`rs_verify`, ports 3901/8901; recipe in memory `reference_browser_smoke_local.md`; never the owner's stack; bring it down after) at 1280px and 390px: a pilot with a takeable board; a pilot whose ship cannot take jobs (empty/no engine): chips line, locked cards, each chip's link lands on the right store tab with the class preselected; a race, a mining and a transport offer; the details fold; pinned/taken mission; a long pt-BR title; no horizontal scroll at 390px; no layout jump on load. Screenshots `docs/design/game-ui-v0.2/after/1-3-board-desktop.png`, `1-3-board-phone.png`, `1-3-board-blocked.png`.
- [ ] **Step 3:** e2e specs of the touched flows (missions/board/a-race/prologue). Known stale failures on `develop` (a11y popup, smoke, prologue-race phone, widths pt-BR 25px) are reported, not fixed.
- [ ] **Step 4:** status line for slice 1.3 in `docs/TODO_v0.1.5.md` (item 4), like the slice 1.1/1.2 lines.
- [ ] **Step 5: Commit** `docs: slice 1.3 verified (screenshots and status)`.

---

## Self-review

- Spec coverage (phase 3): contract cards (Task 3), blocker chips with jump-to-fix (Tasks 1, 3, 4), icon filters (Task 4), built for new kinds (Task 2 registry). The star: the same problem is told once (Task 4).
- Names used across tasks: `fixOf`/`fixHref`/`FixTarget` (T1) are consumed in T3 and T4; `missionKind`/`MISSION_KIND_ORDER` (T2) in T3 and T4; `BoardFilters` is local to T4.
- Not in this slice: stat pips with compare arrows, the mission-kind-specific extra panels (explore/repair/fight come with slice 2.3 as new registry entries plus their own detail panel), sort redesign, the Port-as-a-place scene.
- Open for the owner (defaults chosen, change by saying so): the faction-ring portrait uses the existing giver portraits; the sort dropdown stays; the details fold keeps the route map.
