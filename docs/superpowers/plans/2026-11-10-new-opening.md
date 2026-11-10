# New Opening ("the wreck and the rival") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scripted, story-led opening for new accounts (gift engine, short race, choice of offers, a fatal final run, a rescue, then the faction choice), skippable behind a big warning, that ends in the existing onboarding with the same starting credits whether played or skipped.

**Architecture (my call, the spec leaves it to the builder):** The opening is a **client-side scripted flow** in the web app, built from the game's own prop-driven components (`ShipYard`, `MissionCard`, `RouteMap`, `ShipStage`, `DialogueBox`, `Popup`) fed by static fixtures. The server is only asked for three things: the money numbers, recording how the opening ended, and the existing onboarding. There are no new tables, no resolver changes and no fake missions in the database, so a scripted outcome (the friend wins, the friend dies) cannot vary and a player cannot change it. The fitting steps run the **real client geometry and connector rules** (`hangar.geometry`, `connectors`), so they are the real rules without a ship being stored.

**Tech Stack:** NestJS + Prisma (API), React + vitest + MSW + i18n en/pt-BR (web), the existing `GameConfig` registry.

**Spec:** `docs/superpowers/specs/2026-11-10-new-opening-design.md`

## Global Constraints

- Work only on `develop`; run `git branch --show-current` before every commit (see `CLAUDE.md`). Nothing is pushed.
- Bilingual: every player-facing string exists in `apps/web/src/i18n/en.json` and `pt-BR.json` (`keys.spec.ts` enforces it); no hard-coded strings.
- Code, comments and docs in English.
- The API source must not import `packages/contract` (the Docker api build has no contract package); use local types.
- Run only the tests for the files you touch (not the whole suite). API int tests need `NODE_OPTIONS=--max-old-space-size=8192` and their own test DB if another agent is running (`TEST_DATABASE_URL`, `TEST_REDIS_URL`).
- New `GameConfig` keys go through the registry, defaults, zod schema and types, and the seed int-spec's config count moves by one per key.
- Version bump is NOT part of this plan (the owner bumps last).
- Skipping the opening must show a **big, unmissable warning** (owner decision). The friend never appears again after the death. Normal-game start credits equal what the opening ends with.

## Review Focus

1. **Closing the tab mid-opening.** The player returns to the step they were on (state kept per account in the browser), never a broken half-state; if the browser storage is blocked, the opening restarts from the top.
2. **Skip versus played give the same money.** A player who skips and one who plays both end with exactly `economy.start_credits` after onboarding.
3. **Phone width.** Fitting the engine by touch must work (the yard has a parts sheet on phones); the dialogue box is a bottom sheet and never covers the one thing to press.
4. **Switching language mid-opening** (en to pt-BR) changes every line, including the scripted report, with no raw keys on screen.
5. **A player who already has a faction** (all existing accounts) never sees the opening, and a player mid-opening cannot reach game routes by URL (the existing faction guard sends them back).

---

## File Structure

API (small):
- `apps/api/src/players/prologue.ts` (new): pure `prologuePayouts`.
- `apps/api/src/players/players.controller.ts`, `dto/onboarding.dto.ts`, `onboarding.service.ts`: the prologue endpoint and the recorded outcome.
- `apps/api/src/config/{game-config.types.ts, game-rules.schema.ts, game-config.defaults.ts, config-registry.ts}`: key `onboarding.prologue_payout_shares`.

Web (`apps/web/src/features/prologue/`, all new):
- `prologue-state.ts`: step list and the per-account store (resume, skipped, finished).
- `prologue-fixtures.ts`: the ship, parts, places, offers and race data the scenes show.
- `prologue-script.ts`: for each step, its scene, its guide and its dialogue keys.
- `prologue.page.tsx`: the runner that shows one scene at a time.
- `scenes/`: `fit-scene.tsx`, `board-scene.tsx`, `race-scene.tsx`, `fight-scene.tsx`, `loss-popup.tsx`, `port-scene.tsx`.
- `skip-warning.tsx`: the big warning.
- `prologue.css`, plus i18n keys under `prologue.*`.
- Edited: `features/onboarding/onboarding.page.tsx` (the picker after the story, with the guides' faces), `app/router.tsx` only if a route is needed.

## Split between two agents

- **Agent A:** Task 1 (API) and Task 10 (docs and the owner's playtest checklist). Independent of the rest.
- **Agent B:** Tasks 2 to 9 in order. After Tasks 2 and 3, Tasks 4, 5, 6 and 7 touch separate scene files and can be shared.

---

### Task 1: Money numbers, the prologue endpoint and the recorded outcome (API)

**Files:**
- Create: `apps/api/src/players/prologue.ts`, `apps/api/test/unit/players/prologue.spec.ts`
- Modify: `apps/api/src/players/players.controller.ts`, `dto/onboarding.dto.ts`, `onboarding.service.ts`, the four config files listed above, `apps/web/src/api/generated` (follow the repo's way of keeping it current), the seed int-spec config count.
- Test: `prologue.spec.ts` (unit), the existing onboarding int-spec.

**Interfaces:**
- Produces: `prologuePayouts(startCredits: number, shares: readonly number[]): number[]` (each `floor(start * share / 100)`, the last takes the remainder so the sum is exactly `startCredits`). `GET /v1/players/me/prologue` returns `{ startCredits: number; payouts: number[] }`. `OnboardingDto` gains optional `prologue: 'played' | 'skipped'`. Config key `onboarding.prologue_payout_shares` default `[20, 30, 50]` (race, first offer, second offer), validated as three non-negative ints summing to 100.

- [ ] **Step 1: Write the failing unit tests** in `prologue.spec.ts`: `sums to startCredits for 3000, 3001 and 1`, `splits 3000 as [600, 900, 1500] with shares [20,30,50]`, `rejects shares that do not sum to 100` (the zod schema).
- [ ] **Step 2: Run it and see it fail.** `pnpm --filter api exec jest ... --testPathPatterns prologue.spec`
- [ ] **Step 3: Implement** `prologue.ts`, the config key (registry, default, zod with `.default()` so old stored rule sets still replay, type) and the controller route (auth required, no faction required).
- [ ] **Step 4: Record the outcome.** In `OnboardingService.onboard`, when `dto.prologue` is present, record player event `onboarding.prologue` with payload `{ outcome }` (use `PlayerEventService.record`). The existing int-spec gets two cases: `records the outcome when given` and `still onboards without it` (old clients).
- [ ] **Step 5: Update the web generated types** and the seed int-spec config count; run the touched specs; commit `feat(onboarding): prologue payouts and recorded outcome`.

---

### Task 2: State, gating and the skip warning (web)

**Files:**
- Create: `prologue-state.ts`, `prologue.page.tsx`, `skip-warning.tsx`, `prologue.css`, specs next to each.
- Modify: `features/onboarding/onboarding.page.tsx` (`OnboardingRoute` decides prologue or picker).

**Interfaces:**
- Produces: `PROLOGUE_STEPS: readonly StepId[]` in the order `gift, fit-engine, race, race-result, stop-one, pick-offer, offer-run, stop-two, final-board, final-run, loss, rescue, port`; `usePrologue(playerId)` returning `{ step, advance(), skip(), outcome }` where `outcome` is `null | 'played' | 'skipped'`, kept in `localStorage` per account (wrapped in try/catch, like `tutorial-store`).
- Consumes: `useAuth()` (`user.factionId`).

- [ ] **Step 1: Failing tests.** `resumes at the saved step`, `restarts from the top when storage is blocked`, `skip shows the warning and only a second confirm sets outcome skipped`, `OnboardingRoute shows the prologue for a pilot with no faction and no outcome, the picker once outcome is set, and redirects a pilot with a faction to /ship`.
- [ ] **Step 2: Implement** the store, the runner (one scene at a time from the script) and `SkipWarning` (a modal using `Popup`, large title, two lines of text, "Skip anyway" and "Play the opening", the warning wording in both languages).
- [ ] **Step 3: Verify** with `pnpm --filter web exec vitest run features/prologue features/onboarding`; commit.

---

### Task 3: Fixtures for the world, ship, parts and offers (web)

**Files:** `prologue-fixtures.ts`, `prologue-fixtures.spec.ts`.

**Interfaces:**
- Produces typed fixtures using the generated types: the prologue ship (`cells`, bridge, tank, cargo placeholder, no engine) with a `catalogById` and `connectorsById` copied from real seed values (read the seed data for the engine, tank, bridge and cargo module), a three-place world (`WorldResponse`: the home station, one near port, one far dangerous place), and `MissionOffer` objects for: the race, two offers at the first stop (passenger run, cargo run), and the final run. Rewards come from the server's `payouts` (Task 1), not from constants.
- [ ] **Step 1: Failing test** that every fixture satisfies the generated types (compile-checked) and that the fixed ship has no engine until the gift part is placed.
- [ ] **Step 2: Implement; commit.**

---

### Task 4: Fitting scenes (the gift engine and the stop-two part)

**Files:** `scenes/fit-scene.tsx`, `fit-scene.spec.tsx`.

**Interfaces:**
- Consumes: `ShipYard` props, `placementIssue`/`footprint` from `hangar.geometry`, `computePortMarks` from `connectors`.
- Produces: `FitScene({ ship, part, onFitted })`: the player drags the part (use the existing `use-tray-drag` / `use-carried-pointer`) and `onFitted` fires **only** when the real placement and connector rules accept it. No Save button (autosave: fitting is the commit). Everything else on the hangar page is absent.

- [ ] **Step 1: Failing tests:** `an engine dropped where its ports do not connect is rejected with the real problem text`, `a valid drop calls onFitted once`, `the part tray shows only the one part`, `works at phone width (the parts sheet opens and a tap-to-place path exists)`.
- [ ] **Step 2: Implement; commit.**

---

### Task 5: The board scenes and the choice of offers

**Files:** `scenes/board-scene.tsx`, spec.

**Interfaces:** `BoardScene({ offers, onDispatch })` renders the real `MissionCard` with `RouteMap`, one card or two or three for the choice step, only Dispatch enabled. At the first stop a **Refuel** button (a scripted refuel of a fixed small cost taken from the payouts, so the total stays aligned) is shown before the board.

- [ ] **Step 1: Failing tests:** `one card, one enabled button`, `choosing between two offers calls onDispatch with the chosen id`, `both offers pay the same for the same slot` (so the choice never changes the total).
- [ ] **Step 2: Implement; commit.**

---

### Task 6: The race and its scripted result

**Files:** `scenes/race-scene.tsx`, spec.

**Interfaces:** `RaceScene({ onDone })` shows a 3-leg course with the real race table (use the offer's `info.race`), the transit scene (`ShipStage`) for a short, fixed time (config-free constant, 20 to 30 seconds, skippable by a tap), then the result: the friend first, the player second. The result is a constant of the script and does not read any random source.

- [ ] **Step 1: Failing tests:** `always ends with the friend first and the player second` (run it many times with a stubbed Math.random), `the player's prize equals the first payout`.
- [ ] **Step 2: Implement; commit.**

---

### Task 7: The final run, the death and the rescue

**Files:** `scenes/fight-scene.tsx`, `scenes/loss-popup.tsx`, specs.

**Interfaces:** `FightScene({ onDone })` plays a fixed, short log (the real report styles): pirates attack, the friend is destroyed, the player's ship is wrecked. `LossPopup({ onContinue })` is the full-screen popup with the large title, a short description of the rescue, what was lost (the ship and its parts) and what was saved (the player and the credits). Nothing here is random, and the friend's death has no follow-up (nothing stores or references the friend afterward).

- [ ] **Step 1: Failing tests:** `the fight log is the same every time`, `the popup lists lost and saved items and its only button continues`, `pt-BR renders every line`.
- [ ] **Step 2: Implement; commit.**

---

### Task 8: The voices (dialogue and texts, en + pt-BR)

**Files:** `prologue-script.ts`, i18n keys `prologue.*` in both languages, `prologue-script.spec.ts`.

**Interfaces:** The friend is the guide for the opening; a different voice (the rescuer) speaks after the loss; the three faction people appear only in the port scene. Lines are built into `DialogueNode` objects (`{ id, text: {en, 'pt-BR'}, position, anchor: null, blocking, next: null, choices: [] }`) and shown with the existing `DialogueBox`. The friend's `GiverRef` has no faction (a free pilot). The "why you fly" line (earn, grow, fight pirates) is said once, early. The wording is a draft for the owner to rewrite; keep every line short.

- [ ] **Step 1: Failing tests:** `every step in PROLOGUE_STEPS has a guide and at least one line in both languages`, `no key is missing in either language`.
- [ ] **Step 2: Implement** with the draft lines from the brainstorm session; commit.

---

### Task 9: The port after, and the handoff to onboarding

**Files:** `scenes/port-scene.tsx`, `features/onboarding/onboarding.page.tsx`, specs.

**Interfaces:** After the rescue, a new character introduces the opportunity and the three flags are shown through three people (reuse the mentor `GiverBadge` data the picker already loads). The pick calls the existing onboarding mutation with `{ faction, prologue }` where `prologue` is `'played'` or `'skipped'` (Task 1). The skip path goes straight to the same picker with `'skipped'`. On success the player lands on `/ship` and the existing tutorial runs as before (`tutorialDone` untouched).

- [ ] **Step 1: Failing tests:** `picking a faction sends the faction and prologue played`, `the skip path sends skipped`, `after onboarding the pilot has the faction's starter kit and economy.start_credits` (assert through the API mock and the existing int-spec for the server side).
- [ ] **Step 2: Implement; commit.**

---

### Task 10: End-to-end check and notes for the owner

**Files:** `apps/web/e2e/prologue.spec.ts` (Playwright), `docs/TODO_v0.1.4.md` or a new `docs/` note.

- [ ] **Step 1:** Write the browser smoke: a new account plays the whole opening to the picker and lands on `/ship` with `start_credits`; a second account skips and ends with the same credits; a third account, mid-opening, reloads and resumes. Use the local recipe in the project's memory (`reference_browser_smoke_local`).
- [ ] **Step 2:** Run it on desktop and at phone width and fix what breaks.
- [ ] **Step 3:** Write a short owner checklist (what to read aloud, portrait art wanted for the friend, the rescuer and the three faction people, the text to review) and commit on `develop`.

---

## Self-review

- **Spec coverage:** gift engine (T4), race with scripted result (T6), first stop with refuel, one more part and a choice of offers (T4, T5), fatal final run and the death (T7), rescue popup (T7), the port and the faction choice by people (T9), the existing onboarding and tutorial after (T9), skip with a big warning (T2), credits aligned (T1, T9), the friend as a free pilot and gone (T8, T7), bilingual (T8), existing accounts unaffected (T2).
- **Placeholders:** the lines, names and the portraits are drafts or art still to come, and are called out in T8 and T10. The race length (20 to 30 seconds) is the builder's to tune.
- **Open choices I made, for the owner to check:** the opening lives in the browser, not the database; progress is stored per account in the browser only; payouts are `[20, 30, 50]` percent of `start_credits`; both offers at a slot pay the same, so the choice never changes the money.
