# Sentry Findings and Owner Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and fix the four Sentry findings from `rustnspark-react` and the four owner-reported bugs in `docs/TODO.md`, in the order of player impact.

**Architecture:** Each item starts with a verification step that proves the cause (Sentry events, code reading, a failing test or a measurement), then a minimal fix pinned by a test. Fixes stay on `develop`; nothing touches `release/v0.1` until the owner asks.

**Tech Stack:** NestJS, Prisma, BullMQ, Postgres, Redis, React, Vitest/Jest, Playwright, Sentry MCP (org `gato-ajato-corp`, region `https://us.sentry.io`).

**Spec:** `docs/TODO.md` section "Bugs to investigate (owner reports, 2026-11-05)", plus Sentry issues REACT-1 to REACT-4.

## Global Constraints

- Code in English; player-facing text bilingual (en + pt-BR), no hard-coded strings; new error codes need en + pt-BR.
- `apps/api/src` must not import the contract package (the Docker api build has none); use local types.
- Work on `develop`, leave `release/v0.1` alone.
- Run `pnpm test:e2e` before pushing, and grep old literals when defaults change.
- Rebuild the `worker` container too: missions resolve there.
- Admin owns tunable data (DB wins over TS defaults); any new tunable goes through admin config.
- Sims need Node 22.

## Review Focus

- Two workers resolve the same mission at once: exactly one `MissionLog` row, no 500 and no double payout.
- `/v1/locations` while the DB is slow or the advisory lock is held: the read answers from existing boards instead of failing.
- Player edits a layout, a mission ends, then the player returns: the edits are still there, or the player is asked first.
- Ship sheet after swap/remove followed by save: mobility on the sheet matches the layout that was saved.
- Health endpoint failing: the log says which dependency failed.

---

## Order of work

1. Task 1 (DSN swap, owner action) unblocks seeing the API errors at all.
2. Task 2 (REACT-3/4, `/v1/locations` timeouts): most frequent, hits every page load.
3. Task 3 (REACT-2, duplicate resolve): data-integrity risk.
4. Task 4 (mission-end redirect loses layout): data loss for the player.
5. Task 5 (mobility sheet stale).
6. Task 6 (part popup over assembly).
7. Task 7 (REACT-1 health 503).
8. Task 8 (phone overheating): measure first, fix what the measurement shows.

### Task 1: Point Sentry DSNs at the right projects (owner action, no code)

**Files:**
- Modify (owner's server, not in git): `.env.prod`

- [ ] **Step 1: Owner sets `SENTRY_DSN` to the `rustnspark-node` DSN and `SENTRY_WEB_DSN` to the `rustnspark-react` DSN.** Fetch both with `mcp__sentry__find_dsns` if needed.
- [ ] **Step 2: Rebuild and restart** `web-prod`, `api-prod`, `worker-prod` (the web DSN is baked at build time).
- [ ] **Step 3: Verify.** Trigger a harmless 5xx or failed job and confirm `search_issues` on `rustnspark-node` shows it. Expected: at least one issue appears in the node project.

### Task 2: `/v1/locations` must not time out (REACT-3, REACT-4)

**Files:**
- Modify: `apps/api/src/missions/board.service.ts` (`countOffers`), `apps/api/src/world/world.service.ts` (`getWorld`)
- Test: `apps/api/test/integration/board.int-spec.ts` (create if absent, otherwise extend the existing board spec)

**Interfaces:**
- Consumes: `BoardService.countOffers`, the advisory `lock(tx, locationId)` helper.
- Produces: `countOffers` that never writes on the read path when the lock is busy; same return shape as today.

- [ ] **Step 1: Verify the cause.** `mcp__sentry__get_issue_details` + `get_event_stacktrace` for REACT-3/4. Confirm the error is Prisma "Transaction already closed / timeout" from the top-up `$transaction` in `countOffers`. Check the server's Postgres latency (`select 1` timing from the api container). Record findings in the commit message.
- [ ] **Step 2: Write the failing test** `countOffers answers from existing boards when the top-up lock is held`: hold the advisory lock for a location in one connection, call `countOffers` for that location, assert it resolves within 1 s with the existing offer count and does not throw.
- [ ] **Step 3: Run it.** Expected: FAIL (blocks or throws).
- [ ] **Step 4: Implement.** Take the lock with `pg_try_advisory_xact_lock` in the top-up path: if it is busy, skip the top-up and return the groupBy counts. Pass an explicit `{ maxWait, timeout }` to that `$transaction`. Leave the top-up itself unchanged.
- [ ] **Step 5: Run the board int-specs and `world` specs.** Expected: PASS.
- [ ] **Step 6: Commit** `fix(board): reading the locations never waits on the top-up lock`.

### Task 3: A mission resolved twice must not error (REACT-2)

**Files:**
- Modify: `apps/api/src/missions/resolve.service.ts`
- Test: `apps/api/test/integration/resolve.int-spec.ts` (extend)

**Interfaces:**
- Consumes: the `$transaction` that creates `missionLog` (unique `missionId`).
- Produces: a resolve that treats Prisma `P2002` on `missionLog.missionId` as "already resolved" and returns the existing result without paying twice.

- [ ] **Step 1: Verify.** Read the REACT-2 event: job id, timestamps, and whether two jobs ran for the same mission (BullMQ retry after a stalled job is the likely cause, consistent with a slow DB). Confirm how the mission is claimed before resolving.
- [ ] **Step 2: Write the failing test** `resolving the same mission twice in parallel yields one MissionLog and one payout`: call resolve twice with `Promise.all`; assert one `missionLog`, the wallet changed once, neither call throws.
- [ ] **Step 3: Run it.** Expected: FAIL (second call throws P2002 or pays twice).
- [ ] **Step 4: Implement.** Claim the mission with a conditional status update at the start of the transaction (only one caller proceeds), and catch `P2002` on `missionId` as a no-op. Keep Sentry capture for any other error.
- [ ] **Step 5: Run resolve int-specs.** Expected: PASS.
- [ ] **Step 6: Commit** `fix(resolve): a mission resolved twice is resolved once`.

### Task 4: A mission ending while assembling must not lose the layout

**Files:**
- Modify: `apps/web/src/features/transit/flight-watcher.tsx`, `apps/web/src/features/hangar/hangar.page.tsx`
- Test: `apps/web/src/features/transit/flight-watcher.test.tsx` (extend or create), plus one Playwright smoke in the existing hangar smoke spec

**Interfaces:**
- Consumes: the hangar draft layout state; the `FeedbackProvider` `notify`.
- Produces: a way for the hangar to declare "unsaved changes" (a small `useUnsavedLayout` flag or context) that `FlightWatcher` reads.

- [ ] **Step 1: Write the failing test** `FlightWatcher does not navigate away while the hangar has unsaved layout changes`; it must show a notice with a link to the report instead (en + pt-BR key).
- [ ] **Step 2: Run it.** Expected: FAIL (it navigates).
- [ ] **Step 3: Implement** the unsaved flag set by the hangar when the draft differs from the saved layout and cleared on save or discard. `FlightWatcher` skips the redirect when set and calls `notify` with the report link instead.
- [ ] **Step 4: Run web unit tests and the hangar smoke.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(hangar): a mission ending no longer throws away unsaved layout changes`.

### Task 5: Mobility on the ship sheet must follow the saved layout

**Files:**
- Investigate first: `apps/api/src/ships/` (sheet computation), `apps/web/src/features/hangar/hangar.page.tsx` (query invalidation after save)
- Test: `apps/api/test/integration/ships.int-spec.ts` (extend) and a web test for invalidation

- [ ] **Step 1: Reproduce.** In a scratch stack (`rs_verify`), swap one part and remove another, save, then compare the sheet from the API with the sheet in the UI. Decide which side is stale: server-computed sheet, or cached query on the web.
- [ ] **Step 2: Write the failing test at that layer** `sheet mobility after save equals mobility of the saved layout` (API int-spec if the server is wrong, otherwise a web test asserting the sheet query is invalidated after save).
- [ ] **Step 3: Run it.** Expected: FAIL.
- [ ] **Step 4: Implement the minimal fix** (recompute the sheet on persist, or invalidate the ship/sheet query key on save success).
- [ ] **Step 5: Run the suites for the touched package.** Expected: PASS.
- [ ] **Step 6: Commit** `fix(hangar): the ship sheet follows the saved layout`.

### Task 6: Part popup stuck in front of the assembly

**Files:**
- Investigate: `apps/web/src/ui/Popup.tsx`, `apps/web/src/features/hangar/hangar.page.tsx`, `apps/web/src/styles/mobile.css`

- [ ] **Step 1: Verify** after a hard reload (cache cleared) on a phone viewport in Playwright (390x844): open a part popup in the hangar, scroll and tap another part. If it does not reproduce, close the item as a stale cache and note it in `docs/TODO.md`.
- [ ] **Step 2: If it reproduces, write the failing smoke** `part popup closes when the assembly is touched` and fix the dismiss/z-index behavior in `Popup.tsx`.
- [ ] **Step 3: Run web tests and the smoke.** Expected: PASS.
- [ ] **Step 4: Commit** (only if a fix was needed) `fix(ui): part popup no longer stays over the assembly`.

### Task 7: Health 503 names the failing dependency (REACT-1)

**Files:**
- Modify: the Terminus health controller under `apps/api/src/health/`
- Test: `apps/api/test/unit/health.spec.ts` (extend or create)

- [ ] **Step 1: Verify.** Read the REACT-1 events for time clustering against Task 2/3 events (slow DB) and check `docker logs` of `api-prod` at those times.
- [ ] **Step 2: Write the failing test** `a failing indicator is logged with its name and error` using a stubbed indicator that rejects.
- [ ] **Step 3: Run it.** Expected: FAIL.
- [ ] **Step 4: Implement** a log line of the failed indicator names and messages when the check result is not `ok`; give the DB/Redis pings a short timeout so a slow dependency fails fast and legibly.
- [ ] **Step 5: Run the test.** Expected: PASS.
- [ ] **Step 6: Commit** `fix(health): a failing check says which dependency failed`.

### Task 8: Phone overheating (measure, then fix)

**Files:**
- Investigate: `apps/web/src/features/hangar/` (SVG yard), `apps/web/src/features/transit/`, polling hooks (`refetchInterval` users), CSS animations in `apps/web/src/styles/`
- Create: `docs/design/mobile-performance.md` (measurements and decisions)

- [ ] **Step 1: Inventory** every `refetchInterval`, `setInterval`, `requestAnimationFrame` and CSS `animation` on the phone layout; list interval and cost.
- [ ] **Step 2: Measure** with Playwright + Chrome tracing on a 4x CPU-throttled 390x844 viewport for 60 s on Board, Hangar and Transit; record CPU time and requests per minute in the doc. Ask the owner for an on-device reading (Safari/Chrome remote inspector) if the numbers look fine.
- [ ] **Step 3: Fix the top offenders** (pause polling when `document.hidden`, slow polls on phone, stop animations off-screen, replace per-tick re-renders). One commit per offender with its before/after numbers.
- [ ] **Step 4: Re-measure and record.** Expected: a clear drop on the worst screen.

### Task 9: Close out

- [ ] **Step 1:** Update `docs/TODO.md`: move fixed bugs out, add any leftovers, add the Sentry findings as resolved or tracked.
- [ ] **Step 2:** Run the full suite and `pnpm test:e2e`; rebuild `api`, `worker`, `web`; push `develop` and watch CI.
- [ ] **Step 3:** Mark the Sentry issues resolved via `mcp__sentry__update_issue` only after the owner confirms the fixes on their server.
