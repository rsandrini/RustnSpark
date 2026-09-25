# Rust and Spark v0.1 — Stabilization Plan (post Step 10)

> Written 2026-09-25 after a full investigation of CI on `develop`, the Docker stack, the web client and
> the API. **Goal:** make `develop` trustworthy (green CI, a stack that boots from nothing, a client
> verified against the real API) before Step 11 (Admin) and Step 12 (Hardening) start.
> Order: **Phase 0 CI → Phase 1 code and API → Phase 2 decisions and housekeeping.**
> Task format follows the main plan: `Depends on`, `Files`, `Acceptance`. Effort: S ≤ ½ day, M ≤ 1–2 days, L > 2 days.

## 0. What the investigation found (evidence)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **Unit job never finishes** (cancelled after 6 h; the Step 9 run was still stuck at 3 h) | CI log: `Test Suites: 73 passed`, then `Jest did not exit one second after the test run` and `Cannot log after tests are done … internalConnectMultiple`. Root cause: `src/app.module.spec.ts` ("compiles with a valid environment") compiles the **whole `AppModule`** against a hardcoded `redis://localhost:6379`; BullMQ `Queue`s connect eagerly (unlike `RedisClient`, which is `lazyConnect`) and the spec never closes the module. With no Redis in CI, ioredis retries forever. **Reproduced locally** with `unshare -rn` (network-less): 28× `ENETUNREACH 127.0.0.1:6379 … at Queue.emit` after the tests end. It passes on a dev machine only because Redis runs on 6379. | Blocker |
| F2 | **Unit coverage gate fails** whenever the job does finish | `pnpm test:unit --coverage` → exit 1: global statements 46.75 % vs threshold 95 %; `jobs/processors/*` 0 % vs 100 %; `scripted.rng.ts` 81.7 % vs 95 %. Thresholds were set at S1.7 when only foundation code existed; Steps 5–10 code is covered by **integration** tests but the gate only counts the unit project. | Blocker |
| F3 | **`docker compose --profile dev up` cannot boot from empty volumes** (job "Worker lifecycle" red since Step 6) | CI: `dependency failed to start: container rustnspark-api-1 exited (1)`. **Reproduced**: the built image against an empty database exits 1 with Prisma `P2021` (`table public.RulesSnapshot does not exist`). Nothing in `compose.yaml`, `api.Dockerfile` (`CMD node dist/main.js`) or the CI job runs `prisma migrate deploy` / seed. Same problem blocks anyone doing the S10.10 manual playthrough on a clean machine. | Blocker |
| F4 | **Dependency audit fails** on every run | `pnpm audit --prod`: 2 moderate — `react-router` open redirect via backslash in `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6) and SSR `deserializeErrors` (GHSA-337j-9hxr-rhxg). Vulnerable `>=6.0.0 <7.18.0`, **patched only in ≥ 7.18.0**; we use `react-router-dom@6.30.6`. The job stops at the audit step, so the gitleaks step never ran. | High |
| F5 | **Web tests and web build are not in CI** | `ci.yml` has lint/typecheck for the web, but no `vitest` and no `vite build`. The 91 web tests only ever run on a developer machine. | High |
| F6 | **No job has a timeout** | No `timeout-minutes` in `ci.yml`; F1 burned 6 h runners twice. | Medium |
| F7 | **One unexplained integration failure** | Step 8 run, `market.int-spec` › "used offer buy delivers the listed part at the listed condition": `Expected 200, Received 409` (run at 00:46 UTC). Passes locally (including around the same UTC time) and on the Step 9 CI run. Response body was not logged. Likely time/data dependent: `MarketService` reads `new Date()` directly, so the daily used-offer shelf cannot be replayed in tests. | Medium |
| F8 | **`GET /v1/inventory` has no `displayName`** | `parts.service.ts` `inventory()` returns `catalog: pickCatalogStats(...)`, which has no name. The web port/hangar screens read `(item.catalog as { displayName? }).displayName` (a cast that hides the gap) and fall back to the raw `partType` code, so owned parts show as `engine_chem_small` in both locales. The MSW mock includes the name, so tests were green. | High (real-API bug) |
| F9 | **Web ↔ API contract is hand-maintained** | `apps/web/src/api/generated.ts` is hand-written (no `@nestjs/swagger`, no `openapi.json`, no drift check, all promised by S10.1). F8 and the earlier scavenge/idempotency drift came from this. A route + error-code contract test exists now, but field shapes are unchecked. | High |
| F10 | **The client has never run against the real API** | All 91 web tests use MSW. The S10.10 manual playthrough was not done. Playwright browsers are already cached on this machine (`~/.cache/ms-playwright`) but Playwright is not a dependency of the repo. | High |
| F11 | Gitleaks: **clean** | Ran the CI's own image locally: `99 commits scanned … no leaks found`. No fix needed, but it is hidden behind F4 in CI. | Info |
| F12 | Undocumented decisions made during Steps 8–10 | Rescue fuel ration `economy.rescue_fuel_fraction = 0.25` (contradicts the old "rescue is not a fuel source" line); `parts.restart_condition_max` 50→30; default throttle 60→300 req/min/IP; plan Status paragraph still says "no owner decisions remain open". | Medium |
| F13 | Known compromises | Report loot/part popup shows name + kind only; `?locale=` invalid falls back silently; hangar grid size (10) duplicated client-side; risk band derived from zone; polling load (transit 2 s, board 15 s); no accessibility or phone-layout pass; earlier deferrals (S3.7 tuning HTTP test, no-mock admin login test, tier threshold ruling, ion engine energy value, minors M2/M3/M5/M6/M11/M15/M17, M4/M6/M9/M12). | Low–Medium |
| F14 | Housekeeping | Merged branches `feat/step-5…10` and `step-1…4` still exist locally and on origin; Node-20 action deprecation warnings in CI. | Low |

---

## Phase 0 — CI green (do first; nothing else merges until this is done)

**T0.1 Job timeouts and fail-fast.** Depends on: —  · Effort S
- Files: `.github/workflows/ci.yml`.
- Acceptance: every job has `timeout-minutes` (quality 10, unit 10, web 10, integration 25, docker-lifecycle 20, security 10, compose-check 5, oracle 10); a hung job now fails in minutes, not 6 h. Split **audit** and **gitleaks** into separate steps with `if: always()` on gitleaks so one failure never hides the other (F4/F11).

**T0.2 Fix the Jest hang (F1).** Depends on: —  · Effort S–M
- Files: `apps/api/src/app.module.spec.ts` (+ possibly `jest.config.ts`, `ci.yml`).
- Approach (in order of preference): (1) the compile test must not open real Redis connections: override the BullMQ queue providers with inert doubles (`overrideProvider(getQueueToken(NAME))`) or stub the BullMQ connection factory, and `await moduleRef.close()` in `afterEach`; (2) drop the hardcoded `redis://localhost:6379` — use `process.env.REDIS_URL` from the job; (3) safety net only: `--forceExit` is **not** the fix and must not be the only change.
- Acceptance: `unshare -rn` (network-less) run of `pnpm test:unit` prints **zero** `ENETUNREACH`/"Cannot log after tests are done" lines and exits on its own; CI unit job finishes in < 2 min on a runner with no Redis; add `--detectOpenHandles` to a one-off local check and record that it is clean.

**T0.3 Coverage gate that matches reality (F2).** Depends on: T0.2  · Effort M
- Files: `apps/api/jest.config.ts`, `apps/api/package.json`, `.github/workflows/ci.yml`.
- Approach: enforce coverage on the **union** of unit + integration + e2e + validation, in the job that already has Postgres + Redis (integration): one `jest --coverage --runInBand` over all projects (or per-project runs merged with `nyc`/`istanbul-merge`), and remove `--coverage` from the plain unit job. Re-measure and set thresholds 2–3 points below the merged numbers (global and per-path), record the measured numbers in the config comment. Keep the strict per-path bars that still make sense (`common/rng`, `common/env`, `common/guards`) and drop stale exclusions that the merge makes unnecessary (`jobs/processors/*` 100 %, etc.). If a merged run is too slow (> 8 min), fall back to extending `collectCoverageFrom` exclusions with the same per-file justification style already in the file.
- Acceptance: the coverage step is green on CI and fails when a covered file loses coverage (prove with a scratch commit that removes a test); numbers documented.

**T0.4 Dependency audit: upgrade React Router (F4).** Depends on: T0.6  · Effort M
- Files: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/app/router.tsx`, `apps/web/src/main.tsx`, router-using specs (`test/utils.tsx`, `*.spec.tsx`), `.github/workflows/ci.yml`.
- Approach: move `react-router-dom@^6.30` → `react-router@^7.18` (v7 keeps the `react-router-dom` re-export, but import from `react-router` going forward); v6 `future` flags (`v7_relativeSplatPath`, etc.) become defaults and the props are removed; check `createBrowserRouter`, `RouterProvider`, `MemoryRouter`, `createMemoryRouter` usages; confirm React 18 compatibility. **Fallback only if v7 cannot be adopted:** a documented, time-boxed audit exception (`pnpm audit` ignore with the advisory ids, expiry date, and the reasoning — all our `to=` values are static or server-issued ids, and there is no SSR so the second advisory is unreachable) approved by the owner.
- Acceptance: `pnpm audit --prod` exits 0 (or the approved exception is in the repo with an expiry); all web tests, typecheck and build pass; manual smoke of navigation.

**T0.5 Make the Docker dev stack boot from nothing (F3).** Depends on: —  · Effort M
- Files: `compose.yaml`, `docker/api.Dockerfile`, `apps/api/package.json` (scripts), `README.md` (runbook), `.github/workflows/ci.yml`.
- Approach: add a one-shot `migrate` service (same image, `restart: "no"`) that runs `prisma migrate deploy` then the insert-only seed (D33); `api` and `worker` get `depends_on: migrate: condition: service_completed_successfully`. Ensure the runtime image contains the Prisma CLI, migrations and seed data (add a `migrate` build stage if the slim runtime stage lacks them). Keep `test` profile untouched.
- Acceptance: on empty volumes, `docker compose --profile dev up -d --wait --build` ends with api, worker, web healthy; a second `up` is a no-op (seed never overwrites); the "Worker lifecycle" CI job turns green; the P2021 reproduction (empty DB) no longer crashes anything.

**T0.6 Run the web tests and build in CI (F5).** Depends on: —  · Effort S
- Files: `.github/workflows/ci.yml`.
- Acceptance: new `web` job runs `pnpm --filter web test` and `pnpm --filter web build` (also asserts no stray files in `dist`); it is part of the aggregate `CI` check.

**T0.7 Kill the market flake (F7).** Depends on: —  · Effort M
- Files: `apps/api/src/economy/market.service.ts`, `apps/api/test/unit/economy/*`, `apps/api/test/integration/market.int-spec.ts`.
- Approach: inject the existing `Clock` into `MarketService` (replace the two `new Date()` reads and the `dayKey` argument); add a **pure invariant test**: for every day in a 400-day window × all 12 seeded locations × every catalog part set, the listed used-offer price equals what `buy` charges and `buy` accepts the listing id; make integration failures print the response body (`expect(response.body).toEqual(...)`-style message) so a future 409 is diagnosable.
- Acceptance: the invariant test passes; `pnpm test:int -- market` loops 20× locally and on a CI stress run without a failure; if the loop reproduces the 409, the root cause is fixed in this task (not papered over).

**T0.8 CI hygiene (F14).** Depends on: T0.1  · Effort S
- Files: `.github/workflows/ci.yml`.
- Acceptance: action versions bumped off the Node-20 runtime warnings (`checkout`, `setup-node`, `pnpm/action-setup`); `concurrency` still cancels superseded runs; a short "CI map" comment lists what each job guards.

**Phase 0 exit criteria:** all jobs green on `develop` **twice in a row**, no job longer than its timeout, the audit clean, the dev stack boots from empty volumes. Only then start Phase 1.

---

## Phase 1 — Code and API

**T1.1 Fix `GET /v1/inventory` names (F8).** Depends on: T0.6  · Effort S
- Files: `apps/api/src/parts/parts.service.ts`, `apps/api/src/parts/part.types.ts`, `apps/api/test/integration/parts-ships.int-spec.ts`, `apps/web/src/api/generated.ts`, `port.page.tsx`, `hangar.page.tsx`, `ship-yard.tsx`, `msw/handlers.ts`.
- Acceptance: each inventory item carries `displayName: { en, 'pt-BR' }` (same helper as the market); integration test asserts non-empty names in both locales for the starter kit; the web casts `(item.catalog as { displayName? })` are deleted and use `pickLocalized`; the MSW inventory fixture is generated from the same shape (no name that the API does not send).

**T1.2 Shared contract (F9, S10.1).** Depends on: T0.6, T1.1  · Effort L — **Done (2026-09-25), with a deliberate change of mechanism.**
- Decision: the plan called for `@nestjs/swagger` + `openapi.json` + `openapi-typescript`. The API's response types are TypeScript **interfaces**, which the Swagger plugin cannot describe (it needs classes; ~45 of them would have been rewritten, and unions/nullability come out loose). Instead the contract is written **once as zod schemas** in a workspace package, `packages/contract` (`@rustandspark/contract`), and everything else derives from it. This gives the same guarantees S10.1 asked for, with more precise types and no controller churn.
- Delivered: (1) `apps/web/src/api/generated.ts` is now `export type * from '@rustandspark/contract'` — the hand-written file is gone; (2) every 200 body in the MSW handlers goes through `ok<ContractType>(…)`, so a drifting mock is a **compile error** (30 handlers); (3) `test/integration/contract.int-spec.ts` calls every endpoint the UI uses against the real app and `parse`s the answer with the same schemas (10 groups: auth/refresh cookie, player, world, ships/inventory/preview/auto-assemble, market buy/sell, materials, refuel/repair quote+start, scavenging, board→accept→dispatch→active with leg windows, rescue, admin tuning), and the happy-path e2e parses the report list and all three views from a real worker run; (4) `test/contract/api-contract.spec.ts` (web) still pins routes and error-code translations.
- What it found immediately: `DispatchResponse.durationClass` was typed `'slow'` (API: `'long'`); `ActiveMission` carried `rewardEstimate`/`eligibility` the endpoint never sends; a hangar **Auto layout** bug (the button sent `{}`, so the server arranged only loose parts — an empty, unviable ship for a freshly onboarded player), fixed in the web.
- Acceptance: contract spec green in CI (part of `test:cov`); web `tsc` fails when a handler body or a screen disagrees with the contract; Docker images (`api`, `web`, `migrate`) build with the workspace package.

**T1.3 Real-API browser smoke (F10; pulls S12.4 forward).** Depends on: T0.5, T1.1  · Effort L
- Files: `apps/web/e2e/smoke.spec.ts`, `apps/web/playwright.config.ts`, `apps/web/package.json` (`@playwright/test` dev dep), `.github/workflows/ci.yml` (optional job, then required), `README.md`.
- Approach: run the compose `dev` stack with `missions.time_scale` small (via the admin tuning API in test setup) and drive one player through: register → onboarding (each faction) → hangar auto-assemble → map → board accept → transit dispatch → report (3 views) → port (buy, sell part, sell material, refuel, repair with quote) → force ADRIFT → rescue. Log every failure as an issue and fix in this task; keep screenshots as CI artifacts.
- Acceptance: the smoke passes for all three factions in CI; a written **manual S10.10 sign-off checklist** (desktop + phone viewport, both locales) is executed once by a person and attached to the plan; any defect found is fixed or filed with an owner.

**T1.4 Client hygiene from the review backlog.** Depends on: T1.2  · Effort M
- Files: `hangar.geometry.ts`, `ship-yard.tsx`, `report.page.tsx`, `apps/api/src/reports/*`, `apps/api/src/ships/*`.
- Acceptance: (a) hangar grid half-size comes from the server (ship/preview response) instead of a duplicated constant; (b) report `ref` popups show real detail: for loot, name + rarity + base description; for parts, name + class + description — via either richer `ReportSegment` payloads or a small `GET /v1/catalog/:kind/:id` (decide in the task; must not embed template text in stored logs); (c) invalid `?locale=` keeps falling back to `en` (owner decision 5) — document it and pin it with a test; (d) a11y pass: axe checks in the web tests for each screen, keyboard path through hangar/board/port, focus trap in `Popup`; (e) phone-width layout checked at 360 px for every screen.

**T1.5 Polling and load.** Depends on: T1.3  · Effort M
- Files: `apps/web/src/features/{transit,board}/*`, `apps/api` (conditional GET).
- Acceptance: measured request rate per open screen (target ≤ 12 req/min per tab); transit polling backs off (2 s while a leg boundary is near, 10 s otherwise) and pauses when the tab is hidden; `ETag`/`If-None-Match` on `GET /v1/missions/active` and `/v1/locations` so unchanged polls are 304; the throttle stays at the value chosen in D42 with a test that a normal session never nears it.

**T1.6 Close the old deferrals.** Depends on: —  · Effort M
- Files: per item.
- Acceptance: each item from the Step 3/4 review list is either done with a test or explicitly re-deferred with a reason in the plan: S3.7 (`economy.start_credits` HTTP tuning proving Admin changes apply immediately); no-mock admin login test; tier threshold ruling; ion engine energy value; minors M2, M3, M5, M6, M11, M15, M17 (Step 3) and M4, M6, M9, M12 (Step 4); the "config key mutation" test now that Step 5 landed (`economy.rescue_fuel_fraction`, `economy.sell_ratio`, `scavenging.cooldown_seconds` verified live over HTTP).

**T1.6 result (audited 2026-09-25 against the code and the review doc `docs/reviews/2026-09-23-step3-step4-review.md`):**

| Old deferral | Status |
|---|---|
| S3.7: Admin change reaches gameplay over HTTP (`economy.start_credits`, then the keys added later: `economy.rescue_fuel_fraction`, `economy.sell_ratio`, `scavenging.cooldown_seconds`) | **Done** — `test/integration/tuning-live.int-spec.ts` (4 tests) |
| No-mock admin login test | **Already done** — `admin-access.int-spec.ts` creates the admin through the CLI and logs in via `POST /v1/auth/login` |
| Seeded pt-BR text still English "in one spot" | **Done** — `seed.int-spec.ts` now fails on any seeded pt-BR text identical to its English (only allow-listed names/loanwords: Luna, Sun, Explorers, Laser, Radar); the original defect no longer exists |
| Language switcher; login/register in Portuguese | **Done** (Step 3 lower-priority commit; keys are parity-tested) |
| Magic-number guard "checks nothing yet" | **Done** — `test/unit/lint/magic-numbers.spec.ts` covers `resolution/`, `economy/`, `missions/` |
| Unused code / missing admin-query index | **Done** — `TuningRevision(entityType, entityId, id desc)` index exists |
| Auto-assemble silently drops parts the player does not own | **Done** — `filterCandidateParts` rejects them (403) |
| Part load order not stable | **Done** — `findPlayerParts` orders by `id` |
| Ship class shown nowhere | **Done** — shown in the hangar (Step 10) |
| Starter kit not validated against active items | **Done** — `ConfigReferenceValidator` (`STARTER_PART_NOT_ACTIVE`) |
| Onboarding not atomic / repeatable | **Done** — single transaction under a Player row lock, second call returns the existing ship |
| Fixture "generated from this implementation, not the oracle" | **Done** — Step 5 parity against the Python oracle tapes (600 tournament tapes) |
| Ship-tier thresholds ruling | **Closed by D14** (installed-part value thresholds, decided by the owner) |
| Ion engine energy value | **Open (owner content decision)** — `engine_ion_micro` ships with the tournament-validated `energyCont: 0`; it is Admin-tunable, so it needs a ruling, not code |
| Generated API client | Tracked as T1.2 |

---

## Phase 2 — Decisions and housekeeping

**T2.1 Record the undocumented decisions (F12).** Depends on: owner  · Effort S
- Files: `docs/superpowers/plans/2026-09-21-rust-and-spark-v0.1-implementation.md`, `GDD-rust-and-spark-v0.1.md` (§14 note).
- Acceptance: three new decisions with owner ruling and rationale: **D40** rescue leaves an emergency fuel ration (`economy.rescue_fuel_fraction`, default 0.25; ratify or change the value; update the GDD §14 wording that says rescue is not a fuel source); **D41** restart-kit invariant (kit worst-case sell value < `economy.rescue_cost`, enforced by Admin validation) and `parts.restart_condition_max` default 30; **D42** default per-IP throttle 300/min with S12.1's Redis-backed policy matrix as the long-term answer. The plan's Status paragraph is rewritten to say which decisions are open (currently it claims none).

**T2.2 Branch cleanup (F14).** Depends on: T0 exit  · Effort S
- Acceptance: merged branches `step-1…4`, `feat/step-5…10` deleted locally and on origin after tagging each merge commit (`m1`…`m10`); `develop` and `main` are the only long-lived branches; a short `CONTRIBUTING`/README note documents the branch flow (feature branch → merge commit into `develop`).

**T2.3 Re-plan Steps 11–12 against what we learned.** Depends on: Phase 0–1  · Effort S
- Acceptance: S12.1 (Redis throttling), S12.4 (Playwright, now partly delivered by T1.3) and S12.5 (migrate/seed on boot, now delivered by T0.5) are trimmed to what remains; S11's inspector reuses the pure report renderer and the `rescue`/`repair quote` endpoints instead of new code.

---

## Order of work and dependencies

```
Phase 0:  T0.1 ─► T0.2 ─► T0.3
          T0.6 ─► T0.4
          T0.5            (parallel)
          T0.7            (parallel)
          T0.8 (after T0.1)
                 └── exit: two green runs ──►
Phase 1:  T1.1 ─► T1.2 ─┐
          T0.5 + T1.1 ─► T1.3 ─► T1.5
          T1.4 (after T1.2)   T1.6 (independent)
Phase 2:  T2.1 (owner, can start now)  T2.2 (after Phase 0)  T2.3 (last)
```

## Owner decisions (answered 2026-09-25)

1. **T0.4:** upgrade to React Router 7 — **approved** (no audit exception).
2. **T0.3:** merged coverage in one job — **approved**.
3. **D40:** keep the 0.25 rescue ration and change the GDD §14 wording — **approved**.
4. **D42:** default throttle 300 requests/min/IP until S12.1 — **approved**.
5. **T1.4(c):** invalid `?locale=` **keeps falling back to English** (`en` default); no 400. Document it, add a test that pins the fallback.
6. **T1.3:** the Playwright smoke waits until the service stack is complete (Phase 0 done); it starts non-blocking and becomes required later.

## Risks

| Risk | Mitigation |
|---|---|
| React Router 7 migration breaks routing tests | Do it on its own branch after T0.6; the 91 web tests plus the route contract test catch most breaks; keep the exception fallback. |
| Merged coverage run is slow or flaky | Measure first; fall back to per-file exclusions; keep the plain unit job fast and coverage-free. |
| OpenAPI annotations touch many controllers | Use the Nest CLI swagger plugin to infer most types; do the endpoints in vertical slices, one PR each; the drift check protects each slice. |
| The market flake is not reproducible | The pure invariant test + Clock injection remove the only known non-determinism; the body-logging change makes the next occurrence diagnosable; CI stress loop for 20 runs before closing. |
| Playwright smoke is slow in CI | Run only the happy path per faction; cache browsers; keep it a separate job. |

## Definition of done for this plan

- `develop` CI green twice in a row, every job with a timeout, audit and gitleaks both passing.
- `docker compose --profile dev up --build` works from empty volumes and is documented.
- The generated OpenAPI contract is the single source for web types and mock handlers.
- A Playwright smoke and a signed-off manual playthrough pass against the real stack, in both locales.
- Decisions D40–D42 recorded; the old deferral list is closed or explicitly re-deferred.
- Steps 11 and 12 re-scoped, then started.
