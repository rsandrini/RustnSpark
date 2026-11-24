# Slice 1.1: component kit and HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the first UI slice: a small set of custom components (the kit) and a HUD in the top bar that shows the ship's state (fuel, hull, cargo) on every screen, next to the wallet that already lives in the account menu, replacing the ship-state warning banners.

**Architecture:** presentational kit components in `apps/web/src/ui/kit/` (one file each, props in, no data fetching), styled by one new `styles/kit.css` on the existing tokens (`styles/tokens.css`). The HUD (`ui/hud/Hud.tsx`) is the only data-aware piece: it reads the ship and the accepted mission from the queries the app already runs. Later UI slices (contracts, map, ship, pilot card) consume the kit; this slice changes no gameplay and no server code.

**Tech Stack:** React 18 + Vite, TanStack Query, react-i18next (en + pt-BR), Vitest + Testing Library, Playwright (a11y and widths specs).

**Spec:** `docs/design/game-ui-v0.2-plan.md` sections 3 (principles), 4 (per screen) and 5 (phase 1); mockups `docs/design/game-ui-v0.2/mockups/6-component-kit.html` and `1-ship-screen.html`. Roadmap: `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md`, slice 1.1.

## What exists today (read 2026-11-23)

- `ui/Gauge.tsx`: a horizontal bar with `value`, `max`, `planned`, `remainingAfter`, `label`, `ariaLabel`, `tone: 'ok'|'warn'|'bad'|'fuel'`; used on the part card, tray row, map and port. Keep its props; extend, do not break.
- `ui/TopBar.tsx`: wordmark, `GameNav`, `AccountMenu` (the wallet chip `wallet-chip`, `data-testid="topbar-wallet"`, pulses on change via `use-wallet-answer.ts`), then `StatusStrip` (`ui/ShipIdentity.tsx`: faction badge, ship name, "docked at X", a countdown, `LastMissionLink`); on a phone `GameNav bar` is a bottom tab bar.
- `ui/feedback.tsx`: `FeedbackProvider`, `useFeedback().notify(...)`: the toast / answer system (`FEEDBACK_MS` 3200).
- No `ui/kit/` folder, no Tooltip, no ResourceChip, no risk pips, slot frame, stat pip or blocker chip yet; `ui/RiskBadge.tsx` is the old text badge.
- Ship-state warnings today live in page bodies: `features/board/board.page.tsx:214` (`notice warn`, `data-testid="ship-faults"`), `features/port/port.page.tsx` (`scavenge-no-fuel`, `scavenge-handicap`, ...), `features/rescue/rescue-banner.tsx`. The ship response (`GET /v1/ships`) carries fuel, structure/condition and the sheet (cargo space).

## Global Constraints

- Branch from `develop`; never commit on `release/*`. Before every commit run `git branch --show-current`.
- Every player-facing label in en AND pt-BR (`apps/web/src/i18n/en.json`, `pt-BR.json`); a removed string is removed from both; `i18n/keys.spec.ts` must pass.
- No sound in this version. Haptics only if trivial; not in this slice.
- The connection ports are never abstracted and the installed parts on the ship screen stay as they are (this slice does not touch the ship yard).
- Phone width (390 px) must work for the HUD and every kit piece, with a 16 px side gutter (the phone layout is NOT mocked up: see Decisions).
- Run only the specs of touched files while working; before the push grep the old literals (`ship-faults`, the banner texts) in `apps/web/e2e` and run `test:e2e` for the specs that name them, plus `a11y.spec.ts` and `widths.spec.ts`.
- Reuse tokens and the existing `Gauge`; do not add a second gauge.

## Review Focus

- A ship with no data yet (loading) or a pilot with no ship (adrift, new): the HUD must render nothing broken (no NaN, no "0/0" bar) and never block navigation.
- A pure-ion ship burns no fuel: the fuel gauge is not shown (the app already hides fuel when `fuelUse` is 0; mission cards use `burnsFuel`).
- A very large wallet or cargo number (millions) on a phone: no overflow, `tabular-nums`, no layout jump when the number changes.
- Colour is never the only signal (a bad gauge also has a label/icon, contrast in light and dark per tokens); `prefers-reduced-motion` turns off the count-up and the flash.
- The prologue (opening) runs the same shell over a sandbox ship: the HUD must work there (ship from the sandbox API) and respect the opening's locks.

## Decisions (owner, 2026-11-23: "can we continue" = go with the proposals; provisional, easy to rework)

1. **Phone HUD:** one compact row under the top bar: three icon + number mini gauges (fuel, hull, cargo); tap a gauge for its tooltip card (`Tooltip` with `align="end"` where needed). The wallet stays where it is (the account menu's `wallet-chip`, `data-testid="topbar-wallet"`), unchanged.
2. **Banners:** the HUD replaces only ship-state banners that repeat HUD data (fuel low/empty, hull low). The board's `ship-faults` paragraph becomes blocker chips (Task 5). Contextual notices (a deadline passed, scavenge handicap, rescue) stay until their own screen's slice.
3. **Reserve tick:** marks the fuel the accepted mission needs (`info.estimate.fuelNeeded`), shown only while a mission is accepted and only when it is above 0; reuses `Gauge.reserve`.
4. **Wallet feedback (found in the kit review):** ONE system. The existing wallet chip with its pulse (`use-wallet-answer.ts`) stays; the HUD does NOT render a second wallet and does NOT use `ResourceChip` for money. `ResourceChip` is kept in the kit for later slices (resource counts such as scrap).

---

### Task 1: Kit foundation: tokens, `kit.css`, Tooltip, ResourceChip

**Files:**
- Create: `apps/web/src/styles/kit.css` (imported from `styles/index.css`), `apps/web/src/ui/kit/Tooltip.tsx`, `apps/web/src/ui/kit/ResourceChip.tsx`
- Modify: `apps/web/src/styles/tokens.css` (only new tokens the kit needs: a reserve/amber tone, a frame-notch size; no change to existing values), `apps/web/src/ui/use-wallet-answer.ts` only if the count-up can share it
- Test: `apps/web/src/ui/kit/Tooltip.spec.tsx`, `apps/web/src/ui/kit/ResourceChip.spec.tsx`

**Interfaces:**
- Produces: `Tooltip({ content: ReactNode; children: ReactElement }): JSX.Element` (opens on hover, focus and tap; closes on Escape and outside tap; content has `role="tooltip"` and is linked by `aria-describedby`); `ResourceChip({ icon?: ReactNode; label: string; value: number; unit?: string; testId?: string }): JSX.Element` (formats with `Intl.NumberFormat(i18n.language)`, counts up/down to a new value over about 600 ms, flashes green on a rise and red on a fall; with reduced motion it just shows the value).

- [ ] **Step 1: Write the failing tests:** Tooltip: `opens its content on focus and on click, is described by aria-describedby, closes on Escape`; ResourceChip: `shows the formatted value with the unit`, `counts to the new value when it changes (fake timers) and ends exactly on it`, `adds the rise class on an increase and the fall class on a decrease`, `shows the value at once when prefers-reduced-motion is set`.
- [ ] **Step 2: Run them to verify they fail** (`cd apps/web && npx vitest run src/ui/kit/Tooltip.spec.tsx src/ui/kit/ResourceChip.spec.tsx`): FAIL, modules missing.
- [ ] **Step 3: Implement** the two components and `kit.css` with the signatures above. One responsibility per file; no data fetching.
- [ ] **Step 4: Run the specs, `npx tsc --noEmit -p apps/web`, eslint and prettier** on the new files: PASS.
- [ ] **Step 5: Commit** `feat(ui): kit foundation (tokens, Tooltip, ResourceChip)`.

### Task 2: Gauge for the HUD

**Files:**
- Modify: `apps/web/src/ui/Gauge.tsx`, `apps/web/src/styles/components.css` (where `.gauge` lives; confirm with grep)
- Test: `apps/web/src/ui/ui.spec.tsx` (the gauge cases already there)

**Interfaces:**
- Produces: `GaugeProps` gains `icon?: ReactNode` and `reserve?: number` (draws an amber tick at `reserve / max`; ignored when `max <= 0` or `reserve > max`). Existing props and rendering are unchanged when the new ones are absent.

- [ ] **Step 1: Failing tests:** `draws a reserve tick at the right percentage`, `no tick when reserve is absent, above max or max is 0`, `shows the icon before the label`, `existing gauge snapshot/role/aria values are unchanged`.
- [ ] **Step 2: Run** `npx vitest run src/ui/ui.spec.tsx`: the new cases FAIL.
- [ ] **Step 3: Implement** the two props; keep `role="progressbar"` and the `aria-value*` attributes.
- [ ] **Step 4: Run** that spec plus the specs of the callers (`part-card`, `tray-part-row`, `map`, `port` specs that render a gauge), tsc, eslint: PASS.
- [ ] **Step 5: Commit** `feat(ui): the gauge takes an icon and a reserve tick`.

### Task 3: The HUD in the top bar

**Files:**
- Create: `apps/web/src/ui/hud/Hud.tsx`, `apps/web/src/ui/hud/hud-model.ts`
- Modify: `apps/web/src/ui/TopBar.tsx` (mount the HUD between the status strip and the page, and on a phone as the compact row from decision 1), `apps/web/src/styles/shell.css` and `mobile.css`, i18n keys `hud.fuel`, `hud.hull`, `hud.cargo`, `hud.tip.*` in both locales
- Test: `apps/web/src/ui/hud/hud-model.spec.ts`, `apps/web/src/ui/hud/Hud.spec.tsx`, update `apps/web/src/ui/TopBar.spec.tsx`

**Interfaces:**
- Consumes: `Gauge` (Task 2) and `Tooltip` (Task 1; `align`, `describe`, tap-toggle); queries `['ships']` (`GET /v1/ships`) and `['active']` (`GET /v1/missions/active`, for the accepted mission's `info.estimate.fuelNeeded`).
- Produces: `hudModel(ship: ShipResponse | undefined, accepted: ActiveMission | undefined): { fuel: { value; max; reserve?: number; tone } | null; hull: { value; max; tone } | null; cargo: { used; max } | null }` (pure: `fuel` is null when the ship burns no fuel or there is no ship; tones: `bad` at or below the reserve or empty, `warn` under a quarter, else `ok`); `Hud(): JSX.Element | null` (null while the pilot has no faction or no ship). It renders NO wallet.

- [ ] **Step 1: Failing tests:** `hudModel`: `fuel is null for a ship whose engines burn no fuel`; `reserve equals the accepted mission's fuelNeeded and is absent without one`; `tone bad when empty or at the reserve`; `no NaN or division by zero when max is 0`; `cargo and hull null without a ship`. `Hud`: `renders three gauges for a normal ship and no wallet`, `renders nothing while there is no ship`, `the fuel gauge is missing for an ion-only ship`, `each gauge has an accessible name and its tooltip text`, `phone layout renders the compact row` (mock `useIsPhone`).
- [ ] **Step 2: Run** (`npx vitest run src/ui/hud`): FAIL.
- [ ] **Step 3: Implement** `hudModel` (pure) and `Hud`; mount in `TopBar`; leave the wallet chip in `AccountMenu` untouched (its `data-testid="topbar-wallet"` is read by e2e).
- [ ] **Step 4: Run** the HUD specs, `TopBar.spec.tsx`, `AccountMenu` specs, i18n `keys.spec.ts`, tsc, eslint: PASS.
- [ ] **Step 5: Commit** `feat(ui): a HUD in the top bar with fuel, hull, cargo and the wallet`.

### Task 4: The other kit pieces (presentational)

**Files:**
- Create in `apps/web/src/ui/kit/`: `RiskPips.tsx`, `StatPip.tsx`, `SlotFrame.tsx`, `BlockerChip.tsx`, `IconTabs.tsx`; extend `kit.css`
- Test: one spec per component beside it

**Interfaces (Produces):**
- `RiskPips({ level: 0|1|2|3; label: string })` (3 pips, `role="img"`, `aria-label` = label)
- `StatPip({ icon: ReactNode; value: number | string; compare?: number; label: string })` (compare arrow up/down with the difference; `aria-label` reads value and change)
- `SlotFrame({ rarity?: 'common'|'rare'|'epic'|'legendary'; empty?: boolean; children?: ReactNode })` (frame colour by rarity, dashed when empty)
- `BlockerChip({ label: string; onFix?: () => void; href?: string })` (a button or link; the whole chip is the target; keyboard operable)
- `IconTabs({ tabs: { id: string; icon: ReactNode; label: string }[]; value: string; onChange: (id: string) => void })` (role `tablist`/`tab`, arrow-key navigation, label as tooltip and `aria-label`)

- [ ] **Step 1: Failing tests** per component: roles and accessible names; `RiskPips` level 0..3 fills 0..3 pips and clamps out-of-range; `StatPip` shows ▲/▼ with the difference and nothing when `compare` is absent; `SlotFrame` applies the rarity class and the empty style; `BlockerChip` calls `onFix` on click and on Enter/Space; `IconTabs` moves selection with the arrow keys and calls `onChange`.
- [ ] **Step 2: Run** (`npx vitest run src/ui/kit`): FAIL.
- [ ] **Step 3: Implement** the five components; reuse `ui/tablist.ts` for the tab keyboard logic.
- [ ] **Step 4: Run** the kit specs, tsc, eslint, prettier: PASS.
- [ ] **Step 5: Commit** `feat(ui): kit pieces (risk pips, stat pip, slot frame, blocker chip, icon tabs)`.

### Task 5: Replace the ship-state banners

**Files:**
- Modify: `apps/web/src/features/board/board.page.tsx` (~214: the `ship-faults` paragraph becomes `BlockerChip`s that jump to the fix: the hangar tab for a part problem), any banner whose text only repeats HUD data (fuel low), their css and i18n keys in both locales (remove the dead keys from both)
- Test: `apps/web/src/features/board/board.spec.tsx`, plus the specs of every other touched screen; `apps/web/e2e/*` literals

- [ ] **Step 1: Failing tests:** `the board shows a blocker chip per ship fault instead of the paragraph`, `a chip jumps to the screen that fixes it`, `no fault, no chips`. List first (grep) every e2e and unit literal that names a banner you remove, and update them in this step.
- [ ] **Step 2: Run** `npx vitest run src/features/board/board.spec.tsx`: FAIL.
- [ ] **Step 3: Implement**; contextual notices that the owner decision keeps stay untouched.
- [ ] **Step 4: Run** the touched specs, tsc, eslint, `keys.spec.ts`: PASS.
- [ ] **Step 5: Commit** `feat(ui): ship faults are blocker chips; the HUD replaces the fuel and hull banners`.

### Task 6: Reward toast skin

**Files:**
- Modify: `apps/web/src/ui/feedback.tsx` and `apps/web/src/styles/feedback.css` (a toast with the amount big and one short line, sliding in and fading; no page change; no sound)
- Test: `apps/web/src/ui/feedback.spec.tsx`

- [ ] **Step 1: Failing tests:** `notify with an amount shows it large with its sign and the one-line text`, `the toast leaves after FEEDBACK_MS`, `reduced motion: no slide`, `existing notify behaviour (text only, takeoff) unchanged`.
- [ ] **Step 2: Run** `npx vitest run src/ui/feedback.spec.tsx`: the new cases FAIL.
- [ ] **Step 3: Implement** by extending `FeedbackOptions` (an optional `amount`), not by replacing the API.
- [ ] **Step 4: Run** that spec and the specs of callers that assert on toast text: PASS.
- [ ] **Step 5: Commit** `feat(ui): reward toast with the amount`.

### Task 7: Verify the slice

- [ ] **Step 1:** web unit suite (`npx vitest run` in `apps/web`), tsc, eslint, prettier: all green.
- [ ] **Step 2:** rebuild web on an ISOLATED compose project (recipe in the owner's notes: `rs_verify`, alt ports; never the owner's running stack) and run `a11y.spec.ts`, `widths.spec.ts`, `smoke.spec.ts`, `prologue.spec.ts` (the HUD must work in the opening) and the specs that named a removed banner; report real results.
- [ ] **Step 3:** screenshots at 1240 px and 390 px (desktop and phone, light and dark) saved under `docs/design/game-ui-v0.2/after/1-1-hud-*.png` for the owner to approve.
- [ ] **Step 4:** delete nothing from the TODO yet (the UI item ships when all 8 slices are done); add a one-line status under item 4 of `docs/TODO_v0.1.5.md`: "slice 1.1 done".
- [ ] **Step 5: Commit** `docs: slice 1.1 verified`.

## Self-review

- Spec coverage: gauge (T2), HUD with fuel/hull/cargo/wallet (T3), resource chip (T1), tooltip (T1), risk pips, stat pip, slot frame, blocker chips, icon tabs (T4), reward toast (T6), banners replaced (T5), phone (T3 + T7), art for parts excluded by decision (last task of the version), no sound.
- Names used across tasks: `Gauge.icon`/`reserve`, `hudModel`, `Hud`, `ResourceChip`, `Tooltip`, `BlockerChip`: each defined where first produced.
- Decisions 1-4 above are provisional rulings; nothing blocks execution.
