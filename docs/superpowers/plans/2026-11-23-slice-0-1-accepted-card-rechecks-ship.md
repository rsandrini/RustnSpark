# Slice 0.1: an accepted mission re-checks the ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after a mission is accepted, every change to the ship refreshes the card's requirements and eligibility, and Dispatch is refused (server AND button) with the reason when the ship no longer qualifies.

**Architecture:** the server is the authority. Dispatch re-runs `checkMissionRequirements` (today only accept does); `GET /v1/missions/active` returns an `eligibility` for the player's own accepted mission; the web reads it, refetches `['active']` whenever the ship changes, and disables Dispatch with the reasons. The prologue sandbox gets the same dispatch rule.

**Tech Stack:** NestJS + Prisma (api), `@rustandspark/contract` (zod), React + TanStack Query (web), Jest int-specs (api), Vitest (web).

**Spec:** `docs/TODO_v0.1.5.md` item 2 (owner report 2026-11-10: accepted a RACE, then fitted a new engine and tank; mobility fell below the race minimum but the card kept saying the pilot qualified). Roadmap: `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md`, slice 0.1.

## What the code does today (root causes, read on 2026-11-23)

1. `DispatchService` (`apps/api/src/missions/dispatch.service.ts`) never calls `checkMissionRequirements`: it checks only viability, hold, fuel and the deadline. A ship that fails the mission's requirements (race speed, cargo type, life support, weapons, miner...) can still be dispatched. Only `MissionsService.accept` checks them.
2. `MissionsService.getActive` builds `withEligibility(...)` and then throws the verdict away (`infoById` keeps only `info`). `info.requirements` (the checklist with `met` flags) is recomputed per request from the current ship, but there is no `eligibility`.
3. The web turns an active mission into an offer with `eligibility: { eligible: true, reasons: [] }` (`apps/web/src/features/board/active-offer.ts`), so the card cannot say "not eligible".
4. The ship-changing mutations invalidate `['ships']` and `['inventory']` but not `['active']` (23 sites; `engine-tuning.tsx` is the only one that also invalidates `['active']`), so the accepted card stays stale until a refresh.
5. The Dispatch button (`transit.page.tsx`, `acceptedActions`) is disabled only for pending, no ship, deadline passed, a running job.
6. The prologue sandbox's dispatch route (`sandbox-api.ts` `POST /v1/ships/:id/dispatch`) checks viability and fuel but not eligibility (its accept route does). `restoreSandbox` accepts the final job directly (the cause of the 2026-11-23 "wrong ship flies" report).

## Global Constraints

- Commit on a branch from `develop`, never on `release/*`; `git branch --show-current` before each commit.
- `apps/api/src` must not import `@rustandspark/contract`; the contract package is edited in `packages/contract/src/index.ts` and the API parses nothing from it.
- Every new player-facing string in en AND pt-BR (`apps/web/src/i18n/en.json`, `pt-BR.json`); the error code `MISSION_REQUIREMENTS_NOT_MET` already exists in both.
- Run only the specs of touched files (api int needs the test stack: `docker compose --profile test up -d postgres-test redis-test`, `DATABASE_URL=postgresql://rustandspark:rustandspark@127.0.0.1:5433/rustandspark_test npx prisma migrate deploy` once, then `pnpm test:int -- <spec> -t "<name>"`). Before the push: grep old literals and run `test:e2e`.
- Missions resolve in the `worker`: rebuild api and worker images for the local stack after the API change.

## Review Focus

- A mission that needs no requirements (the test pad, a starter mission, a SCAVENGE job) must still dispatch: no false "not eligible".
- A mining JOB started at a port (JOB_TEMPLATE_IDS, `legs0Ticks`) goes through `dispatch.service` too: it must keep working with the new check.
- Tuning an engine level changes the speed: the requirement uses the same sheet the accept used (see Task 1), so accept and dispatch never disagree.
- The ship is fixed again (a part put back): the card must flip back to eligible and Dispatch must re-enable without a reload.
- A HELD (not yet accepted) mission never shows the new notice; only ACCEPTED does.

---

### Task 1: Dispatch refuses a ship that no longer meets the requirements

**Files:**
- Modify: `apps/api/src/missions/dispatch.service.ts` (after `viability` is computed, before `flightShip`, around the `if (!viability.viable ...)` block)
- Test: `apps/api/test/integration/dispatch.int-spec.ts`

**Interfaces:**
- Consumes: `checkMissionRequirements(input: MissionRequirementInput, rules: GameRules): { eligible; reasons; checklist }` from `./requirements.checker.js`; the `template.requirements` already read in the same transaction.
- Produces: HTTP 400 `{ error: 'MISSION_REQUIREMENTS_NOT_MET', reasons: RequirementReason[] }` on dispatch (the exact body accept already uses).

- [ ] **Step 1: Write the failing tests** (in `dispatch.int-spec.ts`, a new `describe('dispatch re-checks the mission requirements (slice 0.1)')`), each: seed a player with the starter kit, accept a mission, change the ship, then `POST /v1/ships/:id/dispatch`:
  - `refuses a RACE once the ship is below the race speed`: accept a RACE, remove/replace the engine so `sheet.mob < race minMobility`; expect `400`, `body.error === 'MISSION_REQUIREMENTS_NOT_MET'`, `body.reasons.map(r => r.code)` contains `'RACE_SPEED'` or `'SPEED'` (use whichever `checkMissionRequirements` returns for that template; assert against the accept path's own reasons for the same ship so the two cannot differ).
  - `refuses a DELIVERY once the cargo space is gone` (`CARGO_TYPE` / hold), `a TRANSPORT once the life support is removed` (`PRESSURIZED_LIFE_SUPPORT`), `a MINING mission once the drill is removed` (`MINER`).
  - `still dispatches a mission with no requirements` (the first-flight test pad) and `still dispatches a SCAVENGE job`.
  - `accept and dispatch agree`: for the same ship and mission, `accept` rejects with the same `reasons` that dispatch returns (compare the two bodies).
- [ ] **Step 2: Run them to verify they fail** (`pnpm test:int -- dispatch.int-spec.ts -t "re-checks the mission requirements"`). Expected: the first four FAIL (dispatch returns 200 or another error), the last two PASS.
- [ ] **Step 3: Implement** in `dispatch.service.ts`: for every mission type except `SCAVENGE`, call `checkMissionRequirements({ missionType: mission.type, requirements: template?.requirements, sheet, parts: installedConnected }, rules)` using the same untuned `sheet` the accept check uses (not `flight.sheet`), and throw `BadRequestException({ error: 'MISSION_REQUIREMENTS_NOT_MET', reasons })` when not eligible. Place it before the viability throw so the clearer reason wins. Reuse the `template` already loaded for `cargoTermsOf`.
- [ ] **Step 4: Run the new tests and the whole `dispatch.int-spec.ts`** (it is the file that owns this code). Expected: all PASS. If a mining-job or first-flight test fails, the check is too broad: narrow it, do not delete the test.
- [ ] **Step 5: Commit** `fix(missions): dispatch re-checks the mission's requirements against the ship as it is now`.

### Task 2: `GET /v1/missions/active` carries the eligibility of the accepted mission

**Files:**
- Modify: `apps/api/src/missions/missions.service.ts` (`getActive` ~351-405 and `withEligibility` ~757-885)
- Modify: `packages/contract/src/index.ts` (`ActiveMissionSchema`, ~967)
- Test: `apps/api/test/integration/dispatch.int-spec.ts` (next to the existing `an accepted mission keeps the board card details on GET /v1/missions/active`, ~442)

**Interfaces:**
- Consumes: `BoardEligibilitySchema` (already in the contract, ~946).
- Produces: `ActiveMission.eligibility?: { eligible: boolean; reasons: { code: string; message: string }[] }`, present for `ACCEPTED` and `HELD`, absent for `IN_TRANSIT` and later. For the player's OWN mission the reasons exclude `ACTIVE_MISSION_EXISTS` and `SHIP_NOT_AT_ORIGIN` (they describe taking a second mission, not this one); they include viability problems and requirement reasons.

- [ ] **Step 1: Write the failing tests**: `active returns eligible: true for an accepted mission the ship qualifies for`; `after a part change that breaks the requirement, the next GET /v1/missions/active returns eligible: false with the requirement's code, and info.requirements marks it met: false`; `after the part is put back it returns eligible: true again`; `an IN_TRANSIT mission has no eligibility`.
- [ ] **Step 2: Run to verify they fail** (`eligibility` is undefined).
- [ ] **Step 3: Implement** `withEligibility(rows, viewer, playerId, locationId, options?: { own?: boolean })`; with `own: true` skip the two second-mission reasons. `getActive` passes `own: true` and returns `eligibility` for ACCEPTED/HELD rows. Add `eligibility: BoardEligibilitySchema.optional()` to `ActiveMissionSchema`; regenerate the web's generated types the way the repo does (`pnpm` script that builds the contract; check `apps/web/src/api/generated`).
- [ ] **Step 4: Run** the new tests plus `missions.int-spec.ts` (board eligibility must be unchanged). Expected: PASS.
- [ ] **Step 5: Commit** `feat(missions): the active mission reports whether the ship still qualifies`.

### Task 3: The web refreshes the accepted card whenever the ship changes

**Files:**
- Create: `apps/web/src/features/ship/invalidate-ship.ts` exporting `invalidateShip(queryClient: QueryClient): void` (invalidates `['ships']`, `['inventory']` and `['active']`)
- Modify: the 23 sites that invalidate `['ships']` (find with `grep -rn "invalidateQueries({ queryKey: \['ships'\] })" apps/web/src`), mainly `features/hangar/hangar.page.tsx` (lines ~366, 388, 430, 488), `features/port/port.page.tsx`, `features/hangar/engine-tuning.tsx`; replace each by `invalidateShip(queryClient)` when the change touches parts, layout, fuel or engine levels (a pure rename or a read need not).
- Test: `apps/web/src/features/ship/invalidate-ship.spec.ts` and the transit spec below.

**Interfaces:** Produces `invalidateShip(queryClient)`; Task 4 relies on `['active']` being refetched after any ship change.

- [ ] **Step 1: Write the failing test** `invalidate-ship.spec.ts`: calling `invalidateShip(client)` invalidates all three keys (spy on `client.invalidateQueries`, assert it was called with each `queryKey`).
- [ ] **Step 2: Run** (`npx vitest run src/features/ship/invalidate-ship.spec.ts`). Expected: FAIL, module missing.
- [ ] **Step 3: Implement** the helper and swap the call sites. Do not change what a site does beyond adding `['active']`.
- [ ] **Step 4: Run** the specs of the touched files (`hangar.page`, `port.page`, `engine-tuning` specs) and `npx tsc --noEmit -p apps/web`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(web): a ship change refreshes the accepted mission card`.

### Task 4: The card says "not eligible" and Dispatch is blocked with the reason

**Files:**
- Modify: `apps/web/src/features/board/active-offer.ts` (`activeAsOffer`: `eligibility: mission.eligibility ?? { eligible: true, reasons: [] }`)
- Modify: `apps/web/src/features/transit/transit.page.tsx` (`acceptedActions`, ~301): disable Dispatch when `mission.eligibility?.eligible === false` and render `<p className="notice" role="alert" data-testid="transit-not-eligible">` with `t('transit.notEligible')` followed by each reason (`t('board.requirements.' + code, { defaultValue: message })`)
- Modify: `apps/web/src/i18n/en.json` and `pt-BR.json`: add `transit.notEligible` ("Your ship no longer meets this mission's needs. Fix the ship, or abandon the mission." / "Sua nave não atende mais os requisitos desta missão. Arrume a nave ou abandone a missão.")
- Test: `apps/web/src/features/transit/transit.spec.tsx`

**Interfaces:** Consumes `ActiveMission.eligibility` (Task 2) and the refetch (Task 3).

- [ ] **Step 1: Write the failing tests** (MSW, as the file does): `shows the not-eligible notice and disables Dispatch when the active mission says eligible: false` (assert the notice text with the reason, `getByRole('button', { name: /dispatch/i })` is disabled); `enables Dispatch when eligible: true`; `after the ship changes the card refetches and the notice goes away` (first response `eligible: false`, then `true`; trigger `invalidateShip`; assert the notice disappears and the button enables); `no notice for a mission without eligibility (older server)`.
- [ ] **Step 2: Run** (`npx vitest run src/features/transit/transit.spec.tsx -t "not-eligible"`). Expected: FAIL.
- [ ] **Step 3: Implement** the three edits above. Check `keys.spec.ts` (the i18n key parity spec) passes.
- [ ] **Step 4: Run** `transit.spec.tsx`, `board.spec.tsx`, `mission-card.phone.spec.tsx`, `i18n/keys.spec.ts`, `tsc`, `eslint` on the touched files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): an accepted mission that the ship no longer fits says why and blocks Dispatch`.

### Task 5: The prologue sandbox dispatches by the same rule

**Files:**
- Modify: `apps/web/src/features/prologue/sandbox/sandbox-api.ts` (`POST /v1/ships/:id/dispatch`, ~255): after the viability check, if `offerOf(sandbox, mission.job).eligibility.eligible` is false throw `ApiError(CONFLICT, 'not eligible', 'NOT_ELIGIBLE', { statusCode: CONFLICT, message: { error: 'NOT_ELIGIBLE', reasons } })`, exactly as accept does (~233)
- Modify: `apps/web/src/features/prologue/director/restore.ts` (`final-run` step): accept the job only when its offer is eligible (otherwise leave it on the board)
- Test: `apps/web/src/features/prologue/sandbox/sandbox-flights.spec.ts`, `apps/web/src/features/prologue/director/restore.spec.ts`

- [ ] **Step 1: Write the failing tests**: `dispatch of an accepted job is refused with NOT_ELIGIBLE after the module is removed from the ship`; `restore at final-run with a ship that cannot do the job leaves the job on the board, not accepted`; `restore with the matching module still accepts it`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** both edits.
- [ ] **Step 4: Run** the three prologue spec files that own this code (`sandbox-flights`, `restore`, `director` specs). Expected: PASS.
- [ ] **Step 5: Commit** `fix(prologue): the sandbox dispatches only a job the ship can do`.

### Task 6: Verify end to end and write down the result

- [ ] **Step 1:** rebuild api and worker for the local stack; walk the owner's exact case in the browser: accept a RACE, fit a heavier engine and tank, watch the card flip to "not eligible" with the reason and Dispatch disabled; remove the extra parts, watch it flip back; dispatch.
- [ ] **Step 2:** add one browser-smoke / e2e case for it in `apps/web/e2e` (accept, change the ship, assert the notice and the disabled button), then run `test:e2e` for the missions and prologue specs; grep the old literals first.
- [ ] **Step 3:** update `docs/TODO_v0.1.5.md`: delete item 2 (it ships); add the line to the v0.1.5 notes. Commit `docs: v0.1.5 item 2 done`.

## Self-review

- Spec coverage: card refresh (Tasks 2, 3, 4), requirements/eligibility/time/fuel refresh (time and fuel were already recomputed per read; the gap was the refetch, Task 3), Dispatch blocked with the reason (Tasks 1, 4), the other types (cargo, life support, mining: Task 1 tests), the sandbox (Task 5).
- Names used across tasks: `invalidateShip`, `ActiveMission.eligibility`, `MISSION_REQUIREMENTS_NOT_MET`, `transit.notEligible`, `data-testid="transit-not-eligible"`: all defined where first produced.
- Open point for the implementer to confirm in Task 1: whether MINING jobs (port jobs) and TRAVEL/RESCUE go through the check; the Review Focus lists the expectation (jobs and requirement-free missions unaffected).
