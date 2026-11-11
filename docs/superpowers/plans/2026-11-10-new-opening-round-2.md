# New Opening, Round 2 Implementation Plan (the real screens over a sandbox)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the owner's 14 points (`docs/TODO_v0.1.3.md` item 9b) for a second round of testing: the opening runs on the game's REAL screens, its story is editable in the Admin, the race, the loss and the rescue are rebuilt, and every action gives the game's own feedback.

**Architecture:** A **sandbox**: while a pilot is in the opening (no faction yet, saved outcome null) the web app's API client is answered by a small in-browser fake server (`client` gets an interceptor) that holds a ship, parts, fuel, credits, missions and flights in memory. The REAL Ship, Port, Missions, Transit and Report screens render unchanged on top of it, so the yard, the drag, the port tab, the market, the mission card, the animations and the notifications are the game's own. A **director** layer watches what the pilot does in the sandbox, speaks the story in the game's dialogue box and locks every control except the one the step needs. The story (guides with name, title and picture, and their lines) lives in the database as dialogue scenes the Admin already knows how to edit. At the end the outcome is saved (existing endpoint) and the existing faction picker takes over. Nothing is written to the database until then.

**Tech Stack:** React + react-query + the typed contract (web), NestJS + Prisma (API: guides, scenes, config), the existing Admin scene editor, Playwright for the real-stack check.

**Spec:** `docs/superpowers/specs/2026-11-10-new-opening-design.md` (still the intent), plus the owner's list in `docs/TODO_v0.1.3.md` item 9b.

## Global Constraints

- Same as the first plan: commit only on `develop` (check `git branch --show-current`), no push, bilingual en + pt-BR for every player-facing string, code in English, the API source must not import the contract package, targeted tests only, no version bump.
- **Reuse, do not copy:** a real screen is used as it is. Where the opening must differ (hide "best of the day", "expires in", "your starter kit"), the real component reads a small `usePrologueMode()` flag; no forked copies of screens.
- The sandbox answers only with shapes the contract schemas accept (the fixtures are parsed by the contract zod schemas in tests), so it cannot drift from the real API.
- The story's numbers stay exact: the pilot ends the opening with exactly `economy.start_credits`, played or skipped (the owner's rule). New config keys: `onboarding.prologue_purse`, `onboarding.prologue_module_cost`; existing: `prologue_refuel_cost`, `prologue_payout_shares`.
- Spoken lines are centred on the screen by default; the position is a per-line field the Admin can change.

## Review Focus

1. **A pilot clicking anywhere not allowed in a step** (other tabs, sell, upgrade, a part from another family) does nothing and cannot break the sandbox.
2. **Closing the tab at every step** resumes at that step with the sandbox rebuilt to the right state (ship, parts, credits, fuel); no step can be reached with the wrong state.
3. **An Admin edit that removes or reorders lines** (even all of a step's lines) never leaves the pilot stuck: a step with no lines still advances when its action is done.
4. **The sandbox is gone at the end:** after the faction pick the real API answers every request (no interceptor left behind), and a skipped pilot never sees the sandbox at all.
5. **Money:** the wallet in the real top bar matches the director's script at every step, and the total at the end equals `economy.start_credits` for any admin values of the purse, the refuel and the module cost.

## Decisions taken in this plan (the owner can overturn any)

- Guides are `QuestGiver` rows (MENTOR role) of a new **non-playable faction `free`** ("Free pilots"), so they use the existing portrait upload, bilingual title and the existing scene editor. The playable list the picker shows is unchanged.
- The friend's name: **Kite** (draft). The rescuer: **Dara Voss**. The harbour office: **Marshal Oren**. All editable in the Admin.
- The pilot starts the opening with a **purse of 1,000** credits from the friend (config), pays 100 for the refuel and 800 for the module; the three payouts add up to `start_credits - purse + refuel + module`, so the end is exactly `start_credits`.
- Controls outside the step's one action are inert (`pointer-events: none`), not hidden, so the pilot sees the real screen as it will be.
- The real tutorial's information hiding (item 10) is NOT in this round.

---

## File Structure

API (small): `prisma` migration + seed for the faction `free`, the three guides and their default scenes; `players/prologue.ts` (payouts with purse and module cost); `dialogue/scenes.ts` + `triggers.ts` (the prologue triggers and anchors); `GET /v1/players/me/prologue` also returns the guides and scenes; the Admin's trigger and anchor lists.

Web, new (`apps/web/src/features/prologue/`):
- `sandbox/sandbox-state.ts`: the in-memory world (credits, fuel, parts, layout, missions, the flight, events), with `subscribe` for the director.
- `sandbox/sandbox-api.ts`: the interceptor and one handler per endpoint the real screens call.
- `sandbox/sandbox-fixtures.ts`: catalog, world, formats, market, offers, reports (typed by the contract).
- `director/director.tsx`, `director/steps.ts`, `director/locks.css`: the step machine, the speech and the locks.
- `prologue-mode.tsx`: `usePrologueMode()` and its provider.
- Edited: `api/client.ts` (interceptor), `app/router.tsx` + `protected-route.tsx` (the guard lets a pilot in the opening reach the game routes), `ui/GameNav.tsx` and a few real components (hide-in-opening flags), the admin scene editor lists.

Removed when replaced: the custom scenes (`gift`, `board`, `transit`, `rescue`, and the first-round `fit`, `race`, `fight`, `loss` scenes), kept only where a task says to rework them.

## Split between two agents

- **Agent A:** Tasks 1, 2, 3, 4 (the sandbox, the mounting, the flights and the director): the core. Tasks 1 to 3 are sequential.
- **Agent B (start now, independent):** Task 5 (the Admin story: API, seed, editor lists) and Task 8 (the friendly rewrite of all the lines), then Tasks 6 and 7 once Agent A has Task 3 done.
- Meeting points: the trigger names (Task 5 defines them, Task 4 consumes them), the `usePrologueMode()` hook (Task 2), the sandbox state events (Task 1).

---

### Task 1: The sandbox core (the in-browser fake server)

**Files:** `api/client.ts`, `sandbox/sandbox-state.ts`, `sandbox/sandbox-api.ts`, `sandbox/sandbox-fixtures.ts` and specs.

**Interfaces:**
- Produces: `setApiInterceptor(fn: ((method: string, path: string, body: unknown) => Promise<{ handled: true; value: unknown } | { handled: false }>) | null): void` in `api/client.ts` (asked before the network; `null` removes it). `createSandbox(config: { payouts: number[]; purse: number; refuelCost: number; moduleCost: number }): Sandbox` with `state` (readable), `subscribe(listener)`, `reset(stepState)` and a typed `events` stream (`part_fitted`, `refuelled`, `bought`, `accepted`, `dispatched`, `arrived`, `report_opened`, ...).
- Endpoints answered first (read-only and the ship): `/v1/players/me`, `/v1/ships`, `/v1/ships/:id`, `/v1/ship-formats`, `/v1/parts/catalog`, `/v1/inventory`, `/v1/ships/:id/assemble`, `/v1/ships/:id/auto-assemble`, `/v1/locations`, `/v1/display`, `/v1/factions`, `/v1/places/art`, `/v1/system/notices`, `/v1/materials`, `/v1/players/me/stats`, `/v1/players/me/tutorial-progress`, `/v1/players/me/dialogue` (empty), the `me` profile with `tutorialDone: true`.

- [ ] **Step 1: Failing tests.** `an interceptor that handles a request keeps it off the network`, `an unhandled one goes through`, `removing the interceptor restores the network`, and for each endpoint above `the sandbox answer parses with its contract schema`.
- [ ] **Step 2: Implement** the interceptor in `rawRequest` (before `fetch`), the sandbox state with the fixtures from the first round reworked to the contract's `ShipResponse`/`InventoryItem` shapes, and the read endpoints. Parts are real catalog values.
- [ ] **Step 3: Verify** `vitest run features/prologue/sandbox`, tsc, ESLint; commit.

---

### Task 2: Mount the real screens in the opening

**Files:** `prologue-mode.tsx`, `app/router.tsx`, `features/auth/protected-route.tsx`, `ui/GameNav.tsx`, `ui/TopBar.tsx`, a spec.

**Interfaces:** `PrologueModeProvider` (installs the interceptor and the sandbox while `user.factionId == null && user.prologueOutcome === null`, removes both otherwise) and `usePrologueMode(): { active: boolean; step: StepId; locks: Locks }`. `RequireFaction` also passes while `active`. `/onboarding` redirects an active pilot to `/ship`. The chrome (`TopBar`, nav, wallet) shows for an active pilot; the nav's links are disabled except the one the step allows.

- [ ] **Step 1: Failing tests.** `a pilot in the opening reaches /ship, /port, /missions with the sandbox answering`, `a pilot with a saved outcome gets the picker and the real API`, `the interceptor is removed at the end`, `a pilot with a faction never gets the sandbox`.
- [ ] **Step 2: Implement; commit.**

---

### Task 3: The flights, the port, the market and the reports in the sandbox

**Files:** `sandbox/sandbox-api.ts` (more handlers), `sandbox/sandbox-fixtures.ts` (offers, market, reports), specs.

**Interfaces:** the mission and travel endpoints (`/v1/locations/:id/missions`, `/v1/missions/:id/accept`, `/v1/ships/:id/dispatch`, `/v1/missions/active`, `/v1/reports`, `/v1/reports/:id`), the refuel and market endpoints (`/v1/locations/:id/market`, `/v1/market/buy`, the port refuel call the Port screen makes; read `port.page.tsx` for the exact ones), `/v1/ships/:id/engine-preview`, `/engine-levels`, `/energy-mode`. A flight lasts a scripted number of seconds, then `active` returns the arrival and the report exists. The race offer has ONE rival (the friend), three legs, `info.race.projection` after each leg, and no best-of-day in the data the card shows; the report carries the standings.

- [ ] **Step 1: Failing tests.** `accept then dispatch makes a flight that arrives on time and leaves a report`, `refuel costs refuelCost and fills the tank`, `buying the module costs moduleCost and puts it in the inventory`, `the race report ranks the friend first and the pilot second`, `every answer parses with its schema`.
- [ ] **Step 2: Implement; commit.**

---

### Task 4: The director (the story on the real screens)

**Files:** `director/director.tsx`, `director/steps.ts`, `director/locks.css`, specs.

**Interfaces:** the step list (the owner's order): `gift`, `fit-engine`, `race-board`, `race`, `race-report`, `stop-port` (refuel in the Port tab), `choose-job`, `buy-module` (the real market: passenger module for a passenger job, cargo area for a delivery), `fit-module`, `dispatch-job`, `job-report`, `stop-two` (a second job, a different destination), `final-board`, `final-run`, `loss`, `rescue`. Each step: where the pilot is (route), the one allowed anchor (`data-tour` values the real screens already expose, plus the few that are missing), the sandbox event that completes it, and the moments that can trigger lines (`enter`, `done`, `race_leg_1..3`, ...). The director fetches the guides and scenes, speaks the due scene in the dialogue box (centred), and a step with no scene still advances. Locks: the page root is `pointer-events: none` and only the allowed anchors are interactive.

- [ ] **Step 1: Failing tests.** `each step completes on its event and advances`, `a locked control does nothing`, `a step with no lines still advances`, `reload resumes at the saved step with the right sandbox state`, `skip works at every step`.
- [ ] **Step 2: Implement; commit.**

---

### Task 5: The story in the Admin (API, seed, editor)

**Files:** a Prisma migration and seed (`free` faction, non-playable, three guides, default scenes), `dialogue/scenes.ts` and `triggers.ts` (the prologue triggers and the anchors), `players/prologue.ts` + `onboarding.service.ts` (payouts with the purse and the module cost, the guides and scenes in `GET /v1/players/me/prologue`), the Admin lists, specs.

**Interfaces:** triggers `prologue_<step>_enter`, `prologue_<step>_done` for each step, and `prologue_race_leg_1..3`; `prologuePayouts(start, shares)` is called with `start - purse + refuel + module`; the response gains `purse`, `moduleCost` and `guides: [{ giver, scenes }]`. The pilot's `free` faction guides never appear on the board (they have no locations and `active` only for the opening).

- [ ] **Step 1: Failing tests.** `the payouts minus the refuel and the module plus the purse equal start_credits`, `the new keys validate and old rule sets replay`, `the endpoint returns the guides with their scenes`, `an admin can edit a guide's name, title, portrait and scenes (the existing entity routes)`, `the picker still lists only the playable factions`.
- [ ] **Step 2: Implement; commit.**

---

### Task 6: The race (friend only, three legs)

**Files:** sandbox fixtures (Task 3), director moments, the real race card flags, `race-finish` scene, specs.

**Behavior:** the race card shows the map bigger, no "best of the day", no "expires in", the friend's name, one rival. The ship starts with fuel for the race only. Both ships animate in the real transit scene with the standings after each leg; the friend's radio line plays at each leg moment (Admin lines, triggers `prologue_race_leg_1..3`). The finish is the real report plus a short spoken scene with both ships.

- [ ] **Step 1: Failing tests.** `the race has three legs and two racers`, `the card hides the best-of-day and the expiry in the opening only`, `the friend's name is the guide's name`, `the radio lines play at the leg moments`.
- [ ] **Step 2: Implement; commit.**

---

### Task 7: The loss and the rescue (dramatic)

**Files:** sandbox fixtures (the failed report with the real combat events), `loss` and `rescue` scenes reworked on the real report styles, animations, specs.

**Behavior:** the final run resolves as the real report of a lost ship (the real combat cascade), then a full-screen loss moment and a rescue scene in the game's look with animation (the wreck, the rescue crew arriving), then the rescuer's lines, then the harbour office and the picker.

- [ ] **Step 1: Failing tests.** `the report shows the ship lost and the friend's wreck`, `the rescue scene ends the opening and saves the outcome played`.
- [ ] **Step 2: Implement; commit.**

---

### Task 8: Friendlier words (the seed content)

**Files:** the default scenes in the seed (en + pt-BR) for every moment of every step.

A warm, cosy voice for Kite (and the rescuer and the harbour office), short lines, no jargon, the owner reviews and rewrites later in the Admin. A test checks that every step has an `enter` or `done` scene and that both languages are filled.

- [ ] **Step 1: Write the content and the coverage test; commit.**

---

### Task 9: Feedback on every action

**Files:** the director and the sandbox events; the real screens already use the game's answer and notification components.

Every action in the opening (fit, refuel, buy, accept, dispatch, arrive, report) shows the game's animation and notification, because it goes through the real screens. This task adds only what the real game does not already show in these cases (for example a "tank full" notice after the sandbox refuel) and checks each action has one.

- [ ] **Step 1: A test per action that its notification shows; fix the gaps; commit.**

---

### Task 10: Remove the first-round scenes and verify

**Files:** delete the replaced scenes and their specs, update `e2e/prologue.spec.ts` to the new flow, the TODO.

- [ ] **Step 1:** Remove what was replaced; keep the payout endpoint, the saved outcome, the skip warning and the resume.
- [ ] **Step 2:** The Playwright run on a fresh isolated stack (the same recipe as the first round), desktop and phone: skip, resume, a full played opening, played equals skipped credits, and the older suites (smoke, guest, tutorial).
- [ ] **Step 3:** Update `docs/TODO_v0.1.3.md` (item 9b done, item 10 still open), a checklist for the owner's second round, rebuild the local stack; commit.

---

## Self-review

- **Coverage of the 14 points:** 1 centred text (Task 4, constraint), 2 Admin story with guide name and picture and free steps (Task 5, 8), 3 to 5 the yard (Tasks 1 to 4: it is the real yard), 6 the race (Task 6), 7 the race over (Task 6), 8 refuel in the Port tab (Tasks 3, 4), 9 and 14 actions and feedback (Tasks 4, 9), 10 missions on the real screen without expiry and with different destinations (Tasks 3, 4), 11 conclusions (Task 3 reports, Task 4 steps `race-report`, `job-report`), 12 friendlier words (Task 8), 13 select and buy the module (Tasks 3, 4), 14 the rescue (Task 7).
- **Biggest risk:** Task 3 (the sandbox must be faithful enough for five big screens). The mitigation is that every answer is checked against the contract schemas and the first thing built is the read-only core (Task 1), so a screen that needs a missing answer fails loudly in a test, not silently in the browser.
- **Old work kept:** the payout endpoint and the saved outcome, the skip warning with its two steps, the step resume (now reconstructing sandbox state), the e2e skeleton.
