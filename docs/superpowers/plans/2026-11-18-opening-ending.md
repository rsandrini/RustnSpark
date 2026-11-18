# Opening Ending (black screens, time skip, faction hand-over) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the last minutes of the tutorial: no "mission failed" screen, a black screen for Bob's last two lines and for Dara's arrival, then "Some months later", then the Marshal's message, then a smooth fade into the faction selection.

**Architecture:** The ending becomes data-driven, like the rest of the opening. A new last step `later` joins `OPENING_STEPS` (so it gets `prologue_later_enter/_done` triggers for free), the `loss` step gets a `dark` moment (a black layer that stays up through the rescue), and Bob's last two lines move to their own scene hung on `prologue_loss_enter`. The Marshal's scene moves from `prologue_rescue_done` to `prologue_later_enter`. The hand-over to the faction page is a black curtain that fades out on the onboarding page.

**Tech Stack:** React 19 + Vitest + Playwright (apps/web), NestJS scenes validator (apps/api), seed data TS.

**Spec:** the owner's message of 2026-11-18 (three points, quoted in "Requirements" below).

## Requirements (owner, verbatim intent)

1. Remove the "mission failed" screen, keep a black screen there. Tutorial only.
2. A black screen before the last two phrases of Bob. Smooth transition. No click to continue. After some seconds in the black screen, show the first Dara Voss popup.
3. After the last Dara popup: black screen again, the "Some months later" text, THEN the Marshal's message about choosing a faction, THEN a smooth move to the faction selection screen.

## Global Constraints

- Work on `develop` only; run `git branch --show-current` before every commit. No push, no promote.
- Player-facing text only in i18n en + pt-BR (`react/jsx-no-literals`, `keys.spec.ts`). No new visible text is needed here ("Some months later…" already exists as `prologue.moment.later`).
- API `src` must not import the contract package (use local types).
- Only run the specs for files you touch until the last task.
- Respect `prefers-reduced-motion` (moments.css already shortens animations).

## Review Focus

- A pilot who reloads on `loss`, `rescue` or `later` (step saved in localStorage) must still get the right layers and no report page.
- The black layer must never leave a gap (a flash of the game screen) between `loss` -> `rescue` -> `later`.
- Existing/prod rows still have the Marshal on `prologue_rescue_done` and Bob's four lines in one scene: nothing may crash; it just plays the old way until the scenes are imported.
- Skip ("skip tutorial") during any of the black layers still works and ends cleanly.
- Reduced motion: the layers still appear and the story still advances.

## Current behaviour (what exists today)

- `final-run` strike: Bob's scene `loss` (4 nodes) on trigger `prologue_final-run_leg_2` is read on the game screen, then `sandbox.settle(true)` ends the flight.
- Step `loss` has `path: null`, so the step-start effect in `director.tsx` navigates to `/report/<last>` with `fresh: true` (that is the "mission failed" card + report). `loss_enter` ("Guys, there's a survivor here!") and `loss_done` ("Hey kid, can you breathe?") are spoken over it.
- Step `rescue`: `RescueMoment` picture, then Dara (`rescue_enter`, `rescue_done`) AND the Marshal's `choose_faction` (also on `rescue_done`, so he speaks before the "Some months later" card). Then `advance()` shows `LaterMoment`, which ends with `finish('played')` and a hard cut to the faction page.

## File Structure

- `apps/web/src/features/prologue/director/steps.ts`: add step `later`; `StepDef.moment` becomes `'dark' | 'rescue' | 'later'`; `loss` gets `moment: 'dark'`, `rescue` loses `confirm`.
- `apps/web/src/features/prologue/director/moments.tsx` + `moments.css`: new `DarkMoment`; `LaterMoment` signals `onReady` instead of ending the story.
- `apps/web/src/features/prologue/director/director.tsx`: no report navigation for moment steps, render layers per step, remove the `later` state, finish after the `later` step.
- `apps/web/src/features/prologue/curtain.ts` (new) + `apps/web/src/features/onboarding/onboarding.page.tsx` + its CSS: the fade from black into the faction page.
- `apps/api/src/dialogue/scenes.ts`: `PROLOGUE_STEP_IDS` gets `'later'` (triggers are generated from it).
- `apps/web/src/admin/tuning/SceneEditor.tsx` (~lines 90-103): the trigger list per step includes the new step.
- `apps/api/prisma/seed-data/prologue-scenes.data.ts`: split Bob's scene, delay Dara's first popup, move the Marshal's trigger.
- Tests: `director.spec.tsx`, `e2e/prologue.spec.ts`, `prologue-guides.spec.ts`, `SceneEditor.spec.tsx`/`opening-script.spec.tsx` if they list triggers.

---

### Task 1: The `later` step and the `dark` moment in the step table

**Files:**
- Modify: `apps/web/src/features/prologue/director/steps.ts`, `apps/api/src/dialogue/scenes.ts`, `apps/web/src/admin/tuning/SceneEditor.tsx`
- Test: `apps/web/src/features/prologue/director/restore.spec.ts`, `apps/api/test/unit/players/prologue-guides.spec.ts`, admin specs that count triggers

**Interfaces:**
- Produces: `StepId` includes `'later'` (last); `StepDef.moment?: 'dark' | 'rescue' | 'later'`; `nextStep('rescue') === 'later'`, `nextStep('later') === null`; triggers `prologue_later_enter` and `prologue_later_done` exist in the API validator and the Admin's trigger picker.

- [ ] **Step 1: Failing tests.** In `restore.spec.ts` (or a small `steps.spec.ts`): `nextStep('rescue')` is `'later'`, `nextStep('later')` is `null`, `stepDef('loss').moment` is `'dark'`, `stepDef('rescue').confirm` is `false`. In the API test: `PROLOGUE_TRIGGERS` contains `prologue_later_enter`.
- [ ] **Step 2: Run to confirm they fail** (`npx vitest run <spec>` in apps/web; `npm run test:unit` in apps/api).
- [ ] **Step 3: Implement.** Append `'later'` to `OPENING_STEPS` and to `PROLOGUE_STEP_IDS`; add `{ id: 'later', path: null, nav: [], allow: NONE, until: null, confirm: false, moment: 'later' }`; set `loss` to `moment: 'dark'`; set `rescue` to `confirm: false`. Make the Admin trigger list in `SceneEditor.tsx` include `later` (it already maps steps to `_enter/_done`; check how it filters `loss`/`rescue`).
- [ ] **Step 4: Run the tests** (the same commands) and `npx tsc --noEmit` in apps/web. Expected: PASS.
- [ ] **Step 5: Commit** `feat(opening): a later step and a dark moment in the step table`.

### Task 2: No report on the ending steps, black layer from `loss` to `later`

**Files:**
- Modify: `director/director.tsx`, `director/moments.tsx`, `director/moments.css`
- Test: `director/director.spec.tsx`

**Interfaces:**
- Consumes: Task 1's `moment` values.
- Produces: `DarkMoment({ onReady })` (testid `dark-moment`, `data-opening-free`), `LaterMoment({ onReady })` (testid `later-moment`, unchanged text).

- [ ] **Step 1: Failing tests** in `director.spec.tsx`:
  - on step `loss` the route does NOT become `/report/...` and `dark-moment` is visible; no `mission-result` card;
  - Bob's dark scene (a scene on `prologue_loss_enter`) is not spoken before the dark layer's fade is done (`momentReady`), and needs no extra click to start;
  - on step `rescue` BOTH `dark-moment` and `rescue-moment` are in the document (no gap);
  - on step `later`: `later-moment` shows "Some months later", then the scenes on `prologue_later_enter` are spoken, and only after the last one is read does `POST /v1/players/me/prologue` with `played` happen;
  - the old test "plays the whole story down to the rescue and saves played" is updated to this sequence (Dara's last popup -> later card -> Marshal -> played).
- [ ] **Step 2: Run to see them fail** (`npx vitest run src/features/prologue/director/director.spec.tsx`).
- [ ] **Step 3: Implement in `director.tsx`.**
  - Step-start effect: navigate to the report only when `def.path === null && def.moment === undefined` (job-report and race-report keep working; `loss`, `rescue`, `later` stay on whatever screen is under the black).
  - Remove the `later` state, `setLater`, `playedOut`, the `{later && ...}` line. `advance()` now just does `if (next === null) finish.mutate('played'); else writeStep(...)`.
  - Layers: `(def.id === 'loss' || def.id === 'rescue' || def.id === 'later') && <DarkMoment onReady={def.id === 'loss' ? readyMoment : noop} />` so the black stays under the rescue picture and under the later card (DOM order: dark first, then rescue/later, so they paint above it). `RescueMoment`/`LaterMoment` get `onReady={readyMoment}`.
  - The "pilot did the thing" effect: replace the `def.moment === undefined` condition with `momentReady` (a moment step moves on once its picture has played and the queue is empty).
  - Do not call `holdForResultCard` for steps with a moment.
- [ ] **Step 4: Implement `moments.tsx` / `moments.css`.** `DarkMoment`: `background: #000`, fade in over ~1.6s (`animation: moment-fade-in 1.6s ease-in-out both`), `onReady` after the fade (`DARK_BEAT_MS = 1800`). `LaterMoment`: show the text, `onReady` after `LATER_BEAT_MS` (3600, so the text has been read before the Marshal speaks). Delete the unused `.moment-loss`/`.moment-flash`/`.moment-ship`/`.moment-alert`/`.moment-continue` CSS only if nothing else uses them (grep first; leave them if unsure).
- [ ] **Step 5: Run** the director spec, `npx tsc --noEmit`, `npx eslint src/features/prologue` (the pre-existing `[temp] restart final run` lint error stays untouched). Expected: PASS apart from that error.
- [ ] **Step 6: Commit** `feat(opening): black screen instead of the failed report, later as its own step`.

### Task 3: Smooth hand-over to the faction selection

**Files:**
- Create: `apps/web/src/features/prologue/curtain.ts`
- Modify: `director/director.tsx` (raise the curtain before `finish`), `apps/web/src/features/onboarding/onboarding.page.tsx` + its stylesheet
- Test: `onboarding` spec (find it with `ls apps/web/src/features/onboarding`), `director.spec.tsx`

**Interfaces:**
- Produces: `raiseCurtain(): void` and `takeCurtain(): boolean` (module flag, read once). `OnboardingPage` renders `<div className="faction-curtain" aria-hidden="true" data-testid="faction-curtain" />` when `takeCurtain()` was true at mount: fixed, full-screen black, `pointer-events: none`, fades to `opacity: 0` over ~1.6s then is removed (`onAnimationEnd`). Reduced motion: no curtain.

- [ ] **Step 1: Failing tests:** `takeCurtain()` is false by default, true once after `raiseCurtain()`, then false again; the onboarding page shows the curtain only after `raiseCurtain()`; the director calls `raiseCurtain()` when it finishes with `played` (NOT with `skipped`).
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** the module, the director call (in `advance()` right before `finish.mutate('played')`), the page overlay and CSS.
- [ ] **Step 4: Run the specs, `tsc`, eslint** for the touched files.
- [ ] **Step 5: Commit** `feat(opening): the faction page fades in from black`.

### Task 4: The scenes (seed data)

**Files:**
- Modify: `apps/api/prisma/seed-data/prologue-scenes.data.ts`
- Test: `apps/api/test/unit/players/prologue-guides.spec.ts`

Changes (no code beyond the data):
- Kite (Bob), scene `loss`: keep nodes `k_loss_1`, `k_loss_2` ("Pirates!...", "...they hit me...") and set `k_loss_2.next` to `null`. New scene `loss_dark` (Kite) with nodes `n3` ("Missiles no, n....     [connection lost]") and `n4` ("... [conn lost]"), `trigger: 'prologue_loss_enter'`, `order: 30`, `title` en "Gone dark" / pt-BR "Sinal perdido". Keep the existing pt-BR texts of those nodes.
- Dara, scene `final_run_done` (trigger `prologue_loss_enter`, order 31): set `openDelay: 4` on its first node `o_final_done` (the "some seconds in the black screen"; the owner may tune it in the Admin, valid range 0-30).
- Oren, scene `choose_faction`: `trigger: 'prologue_later_enter'`.

- [ ] **Step 1: Failing test** in `prologue-guides.spec.ts`: every step incl. `later` has coverage as the file already checks; `choose_faction` is on `prologue_later_enter`; `loss_dark` is on `prologue_loss_enter` with order lower than `final_run_done`; no scene is left on `prologue_rescue_done` except Dara's `rescue_done`.
- [ ] **Step 2: Run** `npm run test:unit` (apps/api) to see it fail. **Step 3:** edit the data. **Step 4:** run again, PASS.
- [ ] **Step 5: Commit** `feat(opening): the ending scenes follow the new black-screen sequence`.

### Task 5: Dev DB, seed drift, e2e, manual check

**Files:**
- Modify: `apps/web/e2e/prologue.spec.ts` (loss: no report, `dark-moment` visible, Bob's dark lines, Dara after a delay; rescue; later card, then the Marshal, then `faction-curtain`/faction picker)

- [ ] **Step 1: Update the dev DB's live scenes** the same way as Task 4 (Admin editor, or the tuning snapshot import). The dev DB scenes are the Admin's; the seed only fills empty ones, so without this step the dev game keeps the old sequence.
- [ ] **Step 2: Run `scripts/seed-drift.sh`**. Expected: "seed == dev".
- [ ] **Step 3: Update the e2e test** and run `npx playwright test e2e/prologue.spec.ts --reporter=list` (rebuild first: `docker compose --profile dev up -d --build web api worker`; hard refresh in the browser).
- [ ] **Step 4: Manual walk-through** with the debug button `[temp] restart final run`: strike, Bob's two lines on the game screen, fade to black, Bob's last two lines over black, a few seconds of black, Dara's first popup, her next lines, the rescue picture (no flash between layers), "Come aboard", black + "Some months later…", the Marshal, fade into the faction page. Repeat with reduced motion and once with "skip tutorial" during the black layers. Screenshot each stage.
- [ ] **Step 5: Run the unit suites of the touched packages** (web: `npx vitest run src/features/prologue src/features/onboarding src/admin/tuning`; api: `npm run test:unit`). **Step 6: Commit** `test(opening): e2e for the new ending`.

## Notes for the owner

- **Prod**: its mentors keep their old scenes (the seed fills only empty ones), so prod keeps the old order (Bob's four lines together, the Marshal right after Dara) until you import the new scenes (tuning snapshot) or edit them in the Admin. The code stays compatible with old scenes. The three scene edits are listed in Task 4.
- The tutorial skip-warning and the "[temp] restart final run" button are untouched.

## Questions to confirm (I assumed the answers in bold)

1. "Bob's last two phrases" = the two lines **"Missiles no, n...." and "... [conn lost]"**; his first two lines ("Pirates!...", "...they hit me...") stay on the game screen. Do you want all four over black instead? (Only the scene split in Task 4 changes.)
2. The black stays **under everything** from Bob's last lines until the faction page: Dara's popups, then the rescue picture fades in over it (the picture stays), then black + "Some months later". Say if the rescue picture should go.
3. Pause before Dara's first popup: **4 seconds** (editable in the Admin).
4. The "Some months later" card stays **about 3.6 s** before the Marshal appears.
