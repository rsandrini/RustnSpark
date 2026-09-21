# Rust and Spark v0.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT — waiting for the owner to confirm or override the decisions in §2. **No implementation code is written until then.**

**Goal:** Build the v0.1 playable loop of Rust and Spark (asynchronous idle space game): assemble a ship from parts, dispatch it on missions that resolve in real time on the server, read a narrated report, trade/repair/refuel, plus the admin tools to operate and tune it.

**Architecture:** Authoritative NestJS server (client sends intentions only). PostgreSQL is the source of truth. BullMQ delayed jobs resolve missions and repairs; a repeatable reconciliation job is the safety net. Game rules live in pure, I/O-free, seeded-RNG modules (`resolution`, `economy`, `ships`, `parts`) that take a typed `GameRules` snapshot (loaded from the `GameConfig` table) as an argument. React SPA is a window onto server state.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, Redis + BullMQ, React + Vite + TanStack Query + React Router, JWT (Argon2id), Docker Compose, Jest / Vitest / Playwright.

**Spec:** `GDD-rust-and-spark-v0.1.md` (single source of truth for rules and numbers), `arquitetura-tecnica-v0.1.md` (stack, tick, security, tests, build order §10, open decisions §11), `design/*.md` (detail; on numeric conflict `design/schema-dados-v0.1.md` says it wins), `prototypes/*.html` (visual reference only), `simulation/*.py` (executable spec of the numbers).

## Global Constraints

Every task below implicitly includes these. They are non-negotiable.

- **Authoritative server.** The client sends intentions (`POST /v1/missions/:id/accept`, `POST /v1/ships/:id/dispatch`, `POST /v1/market/buy`, `POST /v1/ships/:id/repair`), never results. No endpoint is a setter of game state (`PUT /player/credits` is forbidden). Every roll, damage, price, reward, drop and wear value is computed server-side from persisted state.
- **Security and tests from the first commit.** Global validation (`whitelist` + `forbidNonWhitelisted`), Helmet, CORS allowlist, throttling, Argon2id, ownership guards, idempotency on sensitive actions, atomic credit transactions. CI runs lint + typecheck + unit + integration on every PR from Step 1. Test databases are real Postgres/Redis, never mocks.
- **All balancing numbers live in the database** (`GameConfig` + world/catalog tables). No magic numbers in rule code; enforced by lint (S3.5). Runtime tuning without deploy (arch §4, GDD §17).
- **Deterministic and replayable.** Rules never call `Math.random()`; they receive a seeded `Rng`. Same seed + same snapshot + same config version => same result.
- **Docker Compose, modern syntax:** `docker compose` CLI, `compose.yaml`, no `version:` key, profiles (`dev`, `prod`, `test`). Never `docker-compose`.
- **All code, comments, identifiers, DB columns, enum values, API fields and log messages are English.** Domain terms follow the glossary in Appendix C.
- **Player-facing text (UX) ships in both English (`en`) and Brazilian Portuguese (`pt-BR`) from v0.1.** No player-facing string is hard-coded in code: UI strings, report templates and display names of catalog/world entities are locale data. The API returns stable machine codes (error codes, requirement reasons, event types), never translated sentences. Confirmed by the owner.
- **Reports:** narration is deterministic template text, **no LLM**. `MissionLog` stores structured events and the seed, **never narrated text** (GDD §15, §18).
- **Missions:** one active mission per player; at most 1 mission on hold; hold timer keeps running (GDD §12). **Ships:** UI limits a player to one ship; schema and services assume N (GDD §5.5).
- **Combat is non-lethal:** it ends at 20% HP = defeat/retreat, not annihilation (GDD §8). The player is never left without a ship (GDD §14).
- **Scope:** v0.1 only. Static world, no proactive world, no dynamic supply/demand, no tactical positioning, no chained missions, no inventory limit, no dumping core (GDD §20).

---

## 1. How this plan is organized

- The 12 steps are exactly arch §10. Each step ends at a **milestone** with a defined "what is testable now".
- A **task** (`S<step>.<n>`) is the smallest unit with its own test cycle. Each lists **Files** (paths relative to repo root), **Depends on**, and **Acceptance** (verifiable statements; every bullet must map to at least one automated test unless marked *manual*).
- Task working method (from the writing-plans / TDD skills): failing test first, minimal implementation, green, commit. Conventional commits, one commit per task minimum.
- Shell commands referenced (all defined in S1.1/S1.7): `pnpm lint`, `pnpm typecheck`, `pnpm --filter api test:unit`, `test:int`, `test:e2e`, `test:validation`, `pnpm db:migrate`, `pnpm db:seed`, `docker compose --profile test up -d --wait`.
- Paths: backend is `apps/api/src/...` (module layout = arch §4), frontend `apps/web/`, Python oracle tooling `tools/oracle/`. Existing `design/`, `prototypes/`, `simulation/`, GDD and README are **read-only inputs** and are not modified.

## 2. Decisions to confirm before code

**A. Marked open in arch §11** (recommended default + one-line rationale):

| ID | Decision | Recommended default | Rationale |
|---|---|---|---|
| D1 | Route-overlap (encounter) modeling | `RoutePresence` rows (`route_id`, `leg_index`, `tstzrange window`) written inside the dispatch transaction (the whole leg timeline is known at dispatch); GiST index on the range; encounters resolved when the *earlier-finishing* mission resolves; unique `Encounter(route, leg, missionA, missionB)`; pair seed derived from both mission seeds | Every overlapping mission is already registered by the time the earlier one ends, so detection is complete, idempotent and order-independent |
| D2 | Prisma vs TypeORM | **Prisma** | Declarative schema + versioned migrations + generated types; raw SQL only for the `tstzrange` GiST index and advisory locks |
| D3 | Worker in same process vs separate | **Separate entrypoint (`worker.ts`), same image, separate compose service from day 1** (slight deviation from "start together") | A crashing resolution job must not take the API down, and it proves no code relies on in-process state; cost is a few lines |
| D4 | Reconciliation tick granularity | **30 s**, env var `RECONCILE_INTERVAL_MS` | It is infrastructure, not balance; matches arch suggestion |
| D5 | JWT storage in the client | Access token (15 min) **in memory**; rotating refresh token in an **httpOnly, Secure, SameSite=Strict cookie** scoped to `/v1/auth`; SPA and API served same-origin behind nginx | Immune to token theft via XSS; same-origin removes most CORS/CSRF surface |
| D6 | API versioning | **`/v1` URI prefix now** | Costs nothing today, painful later |
| D7 | Observability | pino JSON logs with request id and redaction, `/v1/health` (terminus: db + redis), Prometheus metrics deferred | Minimum useful for a hobby v0.1 |

**B. Gaps and conflicts I found while reading the docs and running the Python oracle** (not listed in §11, but they change code):

| ID | Finding | Recommended default | Rationale |
|---|---|---|---|
| D8 | Repo layout unspecified | pnpm workspace: `apps/api`, `apps/web`; docs untouched | Single install, shared lint/TS config |
| D9 | Test tooling unspecified | Jest (api), Vitest + RTL + MSW (web), Playwright (browser E2E), compose `test` profile with tmpfs Postgres/Redis | Nest-native, real DB, no extra dependency like Testcontainers |
| D10 | **Part catalog values disagree** between GDD/catalog r1, catalog "r2 master table" (energy ×10, tank 1000, battery 300/80) and the simulators (shield ESC 14, casco BLI 1, placa BLI 4, battery output 80, `motor_pp`, `fuelUse` 0.7/2.5). The sims never check viability. | **Seed the simulator-validated values** (small-int energy scale, battery output 80, shield ESC 14, add a `motor_micro` = `motor_pp`); treat r1/r2 tables as superseded. Acceptance: all sim builds (5 tournament + 4 upgrade + starter) pass the 7 viability balances | The numbers that produced GDD §19 must be the numbers the engine runs |
| D11 | Failure threshold: `desgaste` doc §2 says 50% (`((50-c)/50)^2`); GDD §9/§19 and the sim use **30%** (`((30-c)/30)^2`) | **30%** | GDD is newer and is the sim's value |
| D12 | Environmental wear: GDD says "zone danger × 1.2"; sim uses `environment.nivel × 1.2` | **Sim semantics** (`base(3–5) + env.nivel × 1.2`) | It is what §19 validated |
| D13 | **Reward rule conflict.** GDD says payout comes only from object integrity (failures never embed money loss). The sim multiplies reward by ship-condition performance and applies it to HP only (`HP × perf`), with one ship-wide condition. Three different reward formulas exist in docs. | Production = **GDD rule** (`payout = base × integrity`, 0 below 50%) with the sim's validated base `(reward_base + tier × reward_per_tier) × (1 + danger/15) × (1 + (dist−800)/3000) × type_bonus`; per-part performance scales each part's own contribution (`wear.scale_mode = all_stats`). Parity harness runs the exact sim model (`hp_only`, ship-wide condition); a **second production-mode harness** must stay inside the health bands, retuning `reward_base`/pirate strength in config (not code) if it drifts | Keeps GDD semantics without losing the validation |
| D14 | "Ship tier" (drives reward scaling, NPC strength, upgrade cadence) is undefined for a parts-based ship; in the sim, tiers 2–5 even reuse the same build | `shipTier` = bucket of total installed-part base value against thresholds = `upgrade_costs {2:2500,3:7000,4:16000,5:32000}` | Keeps those validated numbers meaningful and progression emergent |
| D15 | Starting credits: GDD §19 says 3,000 ¢; the sim starts at 200 ¢ (first upgrade "~9 missions" is only valid from 200) | **DECIDED by the owner: `start_credits = 200`** (sim value; the GDD's 3,000 is superseded). Keeps the validated pacing (~9 missions to tier 2) and the oracle reproducible; still a config value | Validated numbers win |
| D16 | **Combat oracle quirks (measured):** (a) `fura` (pierce) cancels algebraically — winrates are identical with fura 0 and 0.35, so missiles get no piercing; (b) the "A" slot has a ~10-point advantage (Blindado-vs-Escudo: 38.7% as A, 28.5% as B) from tie-break initiative + `+2` first strike; (c) symmetrized, the tournament spread is ~13.5 and Blindado ~41%, not the GDD's "45–57%" (that holds only with fixed slot order); (d) Python `round()` is half-to-even: `round(3×1.5)=4`, JS `Math.round` gives 5 — wrong DC for odd MOB (DanoAlto has MOB 3) | **Port faithfully** (keep `fura` inert but read from config, `roundHalfEven`), assign slot A = the mission owner vs NPCs / the aggressor in PvP with SEN ties broken by a seeded coin flip, record (a) and (b) as known simulator defects and schedule a balance pass after playtest | Parity first; fixing changes the validated numbers and needs a re-tournament |
| D17 | Encounter chance is `danger/20` **per mission** in the sim; the engine is per leg | **Per leg** | One engine for all mission types (GDD §12); multi-leg missions get proportionally more risk |
| D18 | **No numeric oracle exists** for: escape roll, detection/ambush, encounter policy tree numbers, presets (Cruzeiro/Combate/Fuga), per-type part-failure consequences, object-integrity damage, mining chance, rescue deadline, escort encounter multiplier | **DECIDED by the owner: proposed defaults approved, see Appendix E** (all in `GameConfig`); e.g. escape: `d20 + round_half_even(MOB × dodge_factor) ≥ 10 + round_half_even(enemyMOB × dodge_factor) + enemySEN`, failure gives the enemy the first-strike bonus | Reuses the validated combat DC shape instead of inventing a second system |
| D19 | Runtime tuning vs replay: admin replay needs the numbers that were in force | Append-only `GameConfigRevision`; `MissionLog` stores `configVersion`, `seed` and the ship snapshot taken **at dispatch** (ship is locked while `ON_MISSION`) | Replay stays faithful after tuning |
| D20 | Hangar shows live derived stats while dragging (GDD §5.4) but the client must hold no rules | Server **dry-run** `POST /v1/ships/:id/preview` (debounced, generously throttled); client only does geometry | Keeps the rules single-sourced |
| D21 | Duration formula and fast/medium/long cutoffs are open (GDD §21) | `durationSec = round(distance / MOB × duration_k)`, `duration_k = 2.25` (800 distance @ MOB 2 = 15 min, matching "~15 min/mission"), cutoffs in config, plus `time_scale` (tests/dev) | Emergent from distance and MOB, all tunable |
| D22 | Language of player-facing text | **CONFIRMED by the owner:** code and identifiers in English; UX text in **both `en` and `pt-BR` at v0.1**. Report templates, UI strings and entity display names are data keyed by locale; player has a saved `locale` (default from `Accept-Language`); reports are rendered in the requested locale at read time (possible because only structured events are stored) | Matches the English-only code rule; a missing translation is a failing test, not a runtime gap |
| D23 | Schema corrections: `MISSION_REPORT.narrativa` (text) contradicts "never persist narrated text"; `PLAYER` has no credentials; `SHIP` has no location or stance; nothing models route presence, encounters, idempotency, config history | Drop the text column (report = `MissionLog` + payout record); add `Account`, `RefreshToken`, `IdempotencyKey`, `RoutePresence`, `Encounter`, `GameConfigRevision`, `AdminAuditLog`, `Ship.currentLocationId`, `Ship.stance`; **defer the `NPC` table** (pirates are generated per encounter and stored in the log) | Needed by the flows; YAGNI for NPC persistence |
| D24 | Map seed data | Derive from the prototype `mapa-esboco.html` (12 nodes, 18 edges): distance = euclid(x,y) × 2.5 (range ≈ 400–1150), danger from node risk (lo 2 / md 5 / hi 8, +1 on hot edges), the 5 prototype environments map to the 4 canonical ones, price mood from a fixed world seed | Uses the validated layout; every derived value is a seed-script constant |
| D25 | Market stock model is unspecified | Every port sells catalog parts at 100% with unlimited stock plus deterministic "used" offers (condition 40–90, price ∝ condition) derived from `hash(location, day)`; static prices | Satisfies "used parts cheaper" without dynamic supply |
| D26 | J6 "abort" mission has no defined semantics | **Not in v0.1 first pass**; revisit after step 10 | Undefined refund/penalty rules |
| D27 | Faction choice needs starter parts | Onboarding (`POST /v1/players/me/onboarding`: faction + starter kit + credits) is built in **Step 4**, not Step 2. **DECIDED by the owner: no "−20% at start" faction discount in v0.1** (faction identity comes from starting port, missions and price layers) | Needs catalog and ships; fewer rules |
| D28 | Scavenging free action is instant and could be spammed | Instant resolution + per-player cooldown in config | Anti-farming, tunable |
| D29 | Mission board is shared or per-player? | Shared (schema: `player_id` null while on the board), first accept wins (409 for the loser); reward finalized at accept from the accepting ship's tier | Matches the schema; simple concurrency rule |

**Status (2026-09-21):** the owner **accepted all technical defaults** (D1–D9, D11, D12, D17, D19, D20, D23, D24) and confirmed D22. **Owner decisions closed:** D10 (simulator values), D13 (GDD integrity rule + sim base formula + production-mode harness), D14 (installed-part value thresholds), D15 (start credits **200**, overriding the recommendation). D16 (port faithfully with `pierce_ratio` inert until a balance pass; slot A = mission owner vs NPCs, aggressor in PvP, SEN ties in a mutual attack by seeded coin flip), D27 (**no faction start discount in v0.1**), D29 (shared board, first accept wins). D21 (~15 min medium: `duration_k` 2.25, fast < 10 min, medium 10–30, long > 30), D25 (every port sells the whole catalog + deterministic used offers), D26 (no abort before Step 10), D28 (per-player scavenging cooldown, 5 min). D18 (rule defaults approved, Appendix E) and ship-class thresholds (approved, Appendix E). **No owner decisions remain open: the planning phase is complete and Step 1 can start.**

## 3. What running the Python oracle told us (facts, not opinions)

I ran the simulators from a scratch directory (project files untouched).

- **Combat, canonical dials** (`dodge 1.5, armor_cap 4, pierce .35, shield_regen 2, kite .2, first_strike 2`, 40 rounds), 3,000 fights/pair, fixed A/B order: `DanoAlto 55.8 · Equilib 53.3 · Rapido 48.6 · Escudo 48.1 · Blindado 44.1`, spread 11.7. The old tournament settings (fura .25, no first strike, 50 rounds) give spread 14.8.
- **Symmetrized** (both slot orders, 1,500/order, 3 seeds): spread 13.3–14.0, Blindado 40.6–41.3, DanoAlto 54.4–55.1.
- **Sweep, GDD config** (`--focado`, 2,000 lives × 3 configs, seed 1): bankruptcy 0%, combat winrate 55%, tier-2 in 9 missions, tier-5 in 144 / 129 / 121 missions (maintenance 350 / 200 / 100), choke 2% / 0% / 0%, median margin 778 / 794 / 803, tier-5 reached by 98–100% (deliberately generous, GDD §19). Matches `sweep-resultados.csv` (120/128/144).
- The simulators are **ship-level** (one condition value for the whole ship, no viability check, tiers reuse one build). The production engine is **per part**. Hence the layered validation in §6 Step 5.

---

## 4. Repository layout

```
compose.yaml                      # profiles: dev | prod | test
.env.example  .nvmrc  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs
.github/workflows/ci.yml
docker/{api.Dockerfile,web.Dockerfile,nginx.conf}
apps/api/                         # NestJS (arch §4 layout under src/)
  prisma/{schema.prisma,migrations/,seed.ts,seed-data/}
  src/{main.ts,worker.ts,app.module.ts,common,auth,players,ships,parts,missions,
       resolution,economy,world,factions,reports,jobs,admin,config,health,prisma}
  test/{support,fixtures/oracle,validation,e2e}
apps/web/                         # React + Vite SPA
tools/oracle/                     # Python: records "roll tapes" from simulation/*.py
docs/superpowers/plans/           # this file
design/ prototypes/ simulation/ GDD… README.md   # existing, read-only
```

Two entrypoints from one image: `main.ts` (HTTP) and `worker.ts` (BullMQ, `createApplicationContext`, no HTTP).

## 5. Milestones and dependencies

```
S1 ─► S2 ─► S3 ─► S4 ─┬─► S6 ─► S7 ─► S8 ─► S9 ─► S10 ─► S11 ─► S12
                 └──► S5 ─┘        (S5 needs only S3's GameRules type; it may run parallel to S4)
```

| Milestone | After | What is testable |
|---|---|---|
| M1 | S1 | Green CI, compose boots, `/v1/health` ok, delayed job survives a Redis restart, seeded RNG determinism |
| M2 | S2 | Register/login/refresh/logout, ownership guard, atomic wallet, idempotency, throttled login |
| M3 | S3 | World + catalog + `GameConfig` seeded; runtime config change visible across instances; no-magic-number lint |
| M4 | S4 | Onboarding, inventory, assemble/auto-assemble/preview, derived sheet + viability match the oracle sheets |
| **M5** | **S5** | **Engine reproduces the GDD §19 numbers** (exact tape parity + statistical bands). Biggest risk retired |
| M6 | S6 | Board generation, requirements, accept/hold state machine |
| **M7** | **S7** | Headless loop: dispatch → delayed job → worker → `MissionLog`; reconciliation; PvP overlap; replay determinism |
| M8 | S8 | Buy/sell, refuel, repair job, scavenging, rescue, negative-balance rules |
| M9 | S9 | 3 report views; **API-level E2E of the whole player loop** (curl-playable) |
| **M10** | **S10** | **Human-playable end-to-end loop in the browser** |
| M11 | S11 | Admin A–E, runtime tuning, inspector with replay |
| M12 | S12 | Hardened release candidate, browser E2E, security review |

Optional parallel tracks (for subagent execution): S10.1–S10.3 (scaffold, auth shell, UI kit) after S2 against MSW mocks; S9.2 (template content) alongside S7–S8; S11.1–S11.2 backend after S3.

---

## 6. Steps

### Step 1 — Foundation (→ M1)

**S1.1 Workspace and API scaffold.** Depends on: —
- Files: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore` (add `node_modules`, `.env`, `dist`, `coverage`), `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `apps/api/{package.json,nest-cli.json,tsconfig.json,tsconfig.build.json,jest.config.ts,src/main.ts,src/app.module.ts}`.
- Acceptance: `pnpm install --frozen-lockfile` works; strict TS (`strict`, `noUncheckedIndexedAccess`); `pnpm lint` and `pnpm typecheck` clean; ESLint bans `Math.random` in `apps/api/src/**`; scripts `test:unit|int|e2e|validation`, `db:migrate`, `db:seed` exist.

**S1.2 Environment validation.** Depends on: S1.1
- Files: `apps/api/src/common/env/{env.schema.ts,env.module.ts}`, `.env.example`.
- Acceptance: app refuses to boot on a missing/invalid variable (unit test); JWT/cookie secrets have no defaults and a minimum length; `.env` is git-ignored; `.env.example` lists every variable. (Not to be confused with the domain `ConfigService` in `src/config`.)

**S1.3 Prisma and database.** Depends on: S1.1
- Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/0001_extensions/` (`btree_gist`), `apps/api/src/prisma/{prisma.module.ts,prisma.service.ts}`.
- Acceptance: `pnpm db:migrate` on an empty database succeeds; CI runs `prisma migrate diff` and fails on drift; PrismaService shuts down cleanly. Schema grows migration-by-migration per Appendix B (no speculative tables).

**S1.4 Docker Compose.** Depends on: S1.1, S1.3
- Files: `compose.yaml`, `docker/api.Dockerfile` (multi-stage, non-root), `.dockerignore`.
- Acceptance: services `api`, `worker` (same image, different command), `postgres`, `redis` (AOF on) under profile `dev`; `postgres-test`/`redis-test` (tmpfs) under `test`; profile `prod` has no postgres/redis and reads `DATABASE_URL`/`REDIS_URL`; `docker compose --profile dev config -q` passes; `docker compose --profile dev up -d --wait` then `GET /v1/health` returns db+redis "up"; CI greps that no `version:` key and no `docker-compose` invocation exists; containers run non-root; DB/Redis published to localhost only.

**S1.5 Hardening baseline.** Depends on: S1.1, S1.2
- Files: `apps/api/src/health/*`, `apps/api/src/common/{filters/all-exceptions.filter.ts,pipes/validation.config.ts,interceptors/request-id.interceptor.ts,logging/pino.config.ts}`, `apps/api/src/main.ts` (global prefix `v1`, Helmet, CORS allowlist from env, body-size limit, throttler default, shutdown hooks).
- Acceptance (tests): unknown body property → 400; error responses never contain stacks in production mode; Helmet headers present; disallowed origin rejected; 429 after the configured limit; logs are JSON with a request id; `authorization`, `password`, `token`, `cookie` are redacted (unit test on logger config).

**S1.6 Seeded RNG.** Depends on: S1.1
- Files: `apps/api/src/common/rng/{rng.ts,sfc32.rng.ts,seed.ts}`.
- Interfaces: `interface Rng { float(): number; int(min: number, max: number): number; uniform(min: number, max: number): number; pick<T>(items: readonly T[]): T; child(label: string): Rng }`; `deriveSeed(parent: string | number, label: string): number`.
- Acceptance: golden first-N values for a fixed seed; `child('leg:1')` is independent of how many draws the parent made; `int` is inclusive and unbiased (chi-square smoke, 1e5 draws); string seeds hash stably across Node versions.

**S1.7 Test harness and CI.** Depends on: S1.3, S1.4
- Files: `apps/api/test/support/{test-db.ts,app-factory.ts}`, `apps/api/jest.config.ts` (projects `unit|integration|e2e|validation`, per-path coverage thresholds), `.github/workflows/ci.yml` (lint, typecheck, unit, integration with Postgres/Redis services, compose config check, `pnpm audit --prod`, secret scan).
- Acceptance: a PR runs green with one unit test, one DB round-trip integration test and one BullMQ round-trip test; integration tests reset state deterministically (truncate or schema-per-worker).

**S1.8 BullMQ skeleton and worker entry.** Depends on: S1.4, S1.7
- Files: `apps/api/src/jobs/{jobs.module.ts,queues.ts}`, `apps/api/src/worker.ts`, `apps/api/src/jobs/processors/ping.processor.ts` (removed once real processors exist).
- Acceptance: integration: a 200 ms delayed job is processed by the worker context, never earlier; the job survives a Redis container restart (AOF); the worker finishes the in-flight job on SIGTERM and exits 0.

**Milestone M1.** All of the above green in CI.

---

### Step 2 — Auth and Player (→ M2)

**S2.1 Accounts and events data model.** Depends on: S1
- Files: migration `0002_accounts_players` — `Account(id, email unique lower-cased, passwordHash, role PLAYER|ADMIN, status ACTIVE|BANNED, createdAt)`, `Player(id, accountId unique, name unique, credits int, locale `en`|`pt-BR`, createdAt)`, `RefreshToken(id, accountId, familyId, tokenHash, expiresAt, revokedAt, replacedById)`, `PlayerEvent(id, playerId, at, type, payload jsonb, creditsDelta)`, `IdempotencyKey(key, playerId, route, requestHash, responseStatus, responseBody, expiresAt)`.
- Acceptance: migration applies cleanly; indexes on `PlayerEvent(playerId, at)` and `RefreshToken(familyId)`; PII limited to email.

**S2.2 Password and token services.** Depends on: S2.1
- Files: `apps/api/src/auth/{password.service.ts,token.service.ts,refresh-token.service.ts}`.
- Acceptance: Argon2id with env-configured cost; access JWT (15 min) carries `sub`, `pid`, `role`; refresh tokens are stored hashed, rotated on use, and **reuse of a rotated token revokes the whole family**; no token or password ever appears in logs (test).

**S2.3 Auth endpoints.** Depends on: S2.2, S1.5
- Files: `apps/api/src/auth/{auth.module.ts,auth.controller.ts,auth.service.ts,dto/*}`.
- Endpoints: `POST /v1/auth/register` (optional `locale`, otherwise from `Accept-Language`, fallback `en`), `/login`, `/refresh` (cookie), `/logout`; `GET /v1/players/me`; `POST /v1/players/me/locale`.
- Locale acceptance: only `en` and `pt-BR` accepted (other values → 400); the preference is persisted and returned by `GET /v1/players/me`.
- Acceptance: DTO rules (email; password 10–128 chars; player name 3–24 `[A-Za-z0-9_-]`); duplicate email/name → 409 without leaking which; login failure is one generic message; login throttled (5/min per IP+email) and register (3/min per IP) → 429; cookie is httpOnly, Secure, SameSite=Strict, path `/v1/auth`; banned account cannot log in.

**S2.4 Guards and decorators.** Depends on: S2.2
- Files: `apps/api/src/common/{guards/jwt-auth.guard.ts,guards/roles.guard.ts,guards/ownership.guard.ts,decorators/{public,current-user,roles,owned-resource}.decorator.ts}`.
- Acceptance: default-deny (global JWT guard, `@Public()` opt-out); tampered/expired token → 401; `@OwnedResource({type,param})` uses a resolver registry and returns **403** when the resource belongs to another player, 404 when absent (test-only controller in `test/support`).

**S2.5 Wallet, player events, idempotency.** Depends on: S2.1, S2.4
- Files: `apps/api/src/players/{wallet.service.ts,player-event.service.ts,players.module.ts}`, `apps/api/src/common/idempotency/{idempotency.interceptor.ts,idempotent.decorator.ts}`.
- Interfaces: `WalletService.debit(playerId, amount, reason, tx): Promise<void>` (throws `INSUFFICIENT_FUNDS`), `credit(...)`; both write a `PlayerEvent` in the same transaction; implemented as a single conditional `UPDATE … WHERE credits >= amount`.
- Acceptance: 20 parallel debits of 10 against a balance of 100 → exactly 10 succeed, final balance 0, exactly 10 events; `@Idempotent()` routes require `Idempotency-Key`; same key + same body replays the stored response with one side effect; same key + different body → 422; forged `credits` in any body → 400.

**Milestone M2.** Security tests present: cross-player access → 403, forged payload ignored/rejected, insufficient balance → rejected with no debit, login rate limit fires, refresh reuse revokes family.

---

### Step 3 — Config and Seed (→ M3)

**S3.1 Config and world data model.** Depends on: S2
- Files: migration `0003_config_world` — `GameConfig(key PK, value jsonb, type, description, updatedAt, updatedBy)`, `GameConfigRevision(id, version, key, oldValue, newValue, actor, at, reason)`, `Faction`, `Environment`, `Location`, `Route`, `RouteEnvironment`, `PartCatalog`, `MissionTemplate`, `DropTable` (fields per `design/schema-dados-v0.1.md` §1, §6–§10, §12, English names). Player-visible names and descriptions (parts, factions, locations, environments, mission templates) are stored as `displayName`/`description` `jsonb` locale maps `{ "en": "...", "pt-BR": "..." }`, never as a single-language string.
- Acceptance: DB `CHECK`s only for structural invariants (zone 0–3, danger 0–10); tunable ranges are validated in the service layer, not the DB; `prisma validate` clean.

**S3.2 `GameRules` schema and defaults.** Depends on: S3.1
- Files: `apps/api/src/config/{game-rules.schema.ts,game-config.defaults.ts,game-config.types.ts}`.
- Interfaces: `type GameRules` (deeply readonly, dotted keys grouped by domain: `combat`, `ship`, `wear`, `economy`, `encounter`, `missions`); zod schema per key with min/max.
- Acceptance: every default in Appendix A validates; every key has bounds; a unit test asserts the key set equals Appendix A (adding a key requires updating both).

**S3.3 Domain `ConfigService`.** Depends on: S3.2, S1.8
- Files: `apps/api/src/config/{config.module.ts,game-config.service.ts,game-config.repository.ts}`.
- Interfaces: `snapshot(): { version: number; rules: GameRules }` (synchronous, from cache); `refresh(): Promise<void>`.
- Acceptance: integration — updating a row makes a second service instance see it within 2 s (Redis pub/sub `gameconfig:changed` + version poll); an out-of-bounds row is rejected, the last good snapshot is kept and an error is logged; boot fails fast if a required key is missing after seeding.

**S3.4 Seed data and script.** Depends on: S3.1, S3.2
- Files: `apps/api/prisma/seed.ts`, `apps/api/prisma/seed-data/{game-config.ts,parts.ts,factions.ts,environments.ts,world-builder.ts,mission-templates.ts,drop-tables.ts}`.
- Acceptance: idempotent upsert (second run = no diff); **never overwrites existing `GameConfig` rows** unless `--reset-config`; `parts.ts` header lists, per value, which source won (D10) and includes `motor_micro`; world built from the prototype data per D24; tests: 12 nodes, 18 routes, graph connected, distances 250–1,800, all 4 environments used, 3 playable factions + pirates with the GDD §10 relation matrix, every location can be served ≥1 template, faction colors match GDD §10; every seeded display name and description has non-empty `en` and `pt-BR` values (test iterates all seeded entities).

**S3.5 No-magic-number guard.** Depends on: S3.4
- Files: `eslint.config.mjs` override for `apps/api/src/{resolution,economy,ships,parts,missions}/**` (`no-magic-numbers`, allowlist `0, 1, -1, 100`), `apps/api/test/lint/magic-numbers.spec.ts`.
- Acceptance: a fixture containing `x * 1.5` in those directories fails lint (tested through the ESLint API); the real tree passes.

**Milestone M3.** `pnpm db:seed` produces a playable world; config edit propagates at runtime.

---

### Step 4 — Parts and Ships (→ M4)

**S4.1 Parts and ships data model.** Depends on: S3
- Files: migration `0004_parts_ships` — `PartInstance(id, partType, ownerPlayerId, condition float, location INVENTORY|INSTALLED, shipId?, propRoll jsonb?)`, `Ship(id, ownerPlayerId, name, layout jsonb, fuel float, status IN_PORT|ON_MISSION|ADRIFT, currentLocationId, stance DEFENSIVE|NEUTRAL|AGGRESSIVE)`.
- Acceptance: a part is installed in at most one ship (partial unique index); `condition` constrained 0–100; layout is never the source of derived stats.

**S4.2 Pure domain: condition, sheet, viability, geometry.** Depends on: S3.2
- Files: `apps/api/src/parts/{condition.ts,part.types.ts}`, `apps/api/src/ships/{sheet.deriver.ts,viability.ts,ship-class.ts,geometry.ts,auto-layout.ts}`.
- Interfaces: `performance(condition, rules): number`; `chokeChance(condition, rules): number`; `deriveSheet(parts, rules): ShipSheet` (MOB, PDF, BLI, ESC, SEN, CRG, HP, mass, energy, battery output, fuel cap, structure used, autonomy, class); `effectiveSheet(sheet, parts, rules)`; `checkViability(sheet, parts, rules): { viable: boolean; problems: ViabilityProblem[] }`; `validateLayout(placements, catalog): LayoutError[]`; `autoLayout(parts, catalog): Placement[]`.
- Acceptance: MOB = `max(1, roundHalfEven(Σpot / Σmass × mob_factor))`; sheets for the 5 tournament builds, 4 upgrade builds and the starter equal the oracle sheets in `test/fixtures/oracle/sheets.json` (fixture produced in S5.1; until then hand-checked table); each of the 7 viability balances (GDD §7) has a passing and a failing case with stable problem codes; all oracle builds are viable; a "kitchen-sink" build is viable but has the lowest MOB and ≥90% structure use (GDD §7 mediocrity); geometry rejects overlap and disconnected parts, supports rotation; `autoLayout` yields a connected, non-overlapping layout for random part subsets (property test); performance table 100→1.0, 50→0.75, 0→0.5; choke chance 0 at ≥30, 0.111 at 20, 0.444 at 10, dead at ≤1.

**S4.3 Services and API.** Depends on: S4.1, S4.2, S2.4
- Files: `apps/api/src/parts/{parts.module.ts,parts.service.ts,parts.controller.ts}`, `apps/api/src/ships/{ships.module.ts,ships.service.ts,ships.controller.ts,dto/*}`, `apps/api/src/players/onboarding.service.ts`.
- Endpoints: `POST /v1/players/me/onboarding` (faction + starter kit at `starter_condition` + `start_credits`), `GET /v1/parts/catalog`, `GET /v1/inventory`, `GET /v1/ships`, `GET /v1/ships/:id`, `POST /v1/ships/:id/assemble`, `POST /v1/ships/:id/auto-assemble`, `POST /v1/ships/:id/preview`, `POST /v1/ships/:id/stance`.
- Acceptance (integration): onboarding is idempotent and single-shot; assembling another player's ship → 403; using parts you do not own → 403/404; installing a part already installed elsewhere → 409; assemble and stance changes while `ON_MISSION` → 409; preview is allowed at any time and never persists; forged `mob`/`hp` in body → 400; sheet returned is server-derived.

**Milestone M4.** A player can register, pick a faction, receive the starter kit and assemble a viable ship purely through the API.

---

### Step 5 — Resolution engine (→ M5)  ⭐ CRITICAL

Port the Python resolution logic and prove it reproduces GDD §19. The validation is layered so a failure points at the cause.

**Validation layers**

| Layer | What | Pass condition |
|---|---|---|
| 0 | Python oracle records **roll tapes** (every `randint/random/choice/uniform` call with args and value) from `simulation/sweep-rust-and-spark.py` (its `main` is guarded, importable) | Fixtures regenerate byte-identically |
| 1 | **Exact parity, combat:** TS combat replayed against ≥500 tapes (all 10 build pairs, both orders) | Outcome, final HP and shield identical; every RNG call matches in order, function and arguments |
| 2 | **Exact parity, whole lives:** TS harness port of `uma_vida` replayed against ≥20 full-life tapes for the 3 GDD configs | Final credits, tier, mission count, choke count identical |
| 3 | **Statistical parity** with the production PRNG (independent of Python's Mersenne Twister) | Bands below |
| 4 | **Production-mode harness** (per-part wear, integrity-based payout, D13) | Health bands from the sweep `ALVOS`; baseline recorded in `baselines.json`; drift is fixed by config, not code |

**Layer 3 bands** (measured on the oracle; tolerance covers sampling noise):

| Metric | Oracle value | Band |
|---|---|---|
| Tournament, fixed A/B order, 3,000/pair | spread 11.7; each build 44.1–55.8 | each build 43–58, spread ≤ 13.5 |
| Tournament, symmetrized, 1,500/order | spread 13.3–14.0; Blindado ~41, DanoAlto ~55 | each build 39–57, spread ≤ 15 |
| Bankruptcy, 2,000 lives × 3 configs | 0% | 0% |
| Combat winrate | 55–56% | 53.5–57.5% |
| Median missions to tier 2 | 9 | 8–10 |
| Median missions to tier 5 (maintenance 100 / 200 / 350) | ~121 / ~129 / ~144 | ±8 each |
| Choke rate | 0–2% | ≤ 3% |
| Median mission margin | 778–803 | 760–820 |

Unit tables (exact): performance and choke tables from S4.2; payout 100→1.0, 80→0.8, 50→0.5, <50→0; wear per mission = `uniform(3,5) + env.nivel × 1.2`; `roundHalfEven` cases (`4.5→4`, `5.5→6`, `2.5→2`) verified against a Python-generated table of 10,000 floats.

**S5.0 Sign-off gate.** Depends on: decisions D13, D16, D17, D18 confirmed
- Resolved on 2026-09-21: the owner approved the rule defaults now listed in Appendix E. This task reduces to copying them into `game-config.defaults.ts` (with bounds in S3.2) and using them as the table-driven cases for S5.4–S5.6.

**S5.1 Oracle harness.** Depends on: S1.6
- Files: `tools/oracle/{gen_fixtures.py,tape.py}`, `apps/api/test/fixtures/oracle/{combat-tapes.json,life-tapes.json,sheets.json,tables.json,baselines.json}`, CI job `oracle-fixtures-fresh`.
- Acceptance: `gen_fixtures.py` imports the sim via `importlib` and swaps its module-level `random` for a recording wrapper — `simulation/` is never edited; output is deterministic; the CI job regenerates and diffs so silent drift in `simulation/` fails the build; fixtures cover ≥500 combat tapes and ≥20 lives.

**S5.2 Numerics and scripted RNG.** Depends on: S1.6, S5.1
- Files: `apps/api/src/resolution/numeric/round-half-even.ts`, `apps/api/src/common/rng/scripted.rng.ts` (test support).
- Acceptance: `roundHalfEven` matches the Python table exactly; `ScriptedRng` throws on any call-order/argument mismatch and on leftover tape.

**S5.3 Combat resolver.** Depends on: S5.2, S3.2
- Files: `apps/api/src/resolution/combat/{combat.types.ts,combat.resolver.ts}`.
- Interface: `resolveCombat(a: CombatSheet, b: CombatSheet, rules: GameRules['combat'], rng: Rng): CombatResult` (`outcome`, `rounds[]` with attacker, roll, DC, hit, damage, shield absorbed, HP).
- Acceptance: Layer 1 passes; both kite draws happen every round even at probability 0; first-strike bonus goes to the first attacker that actually attacks (skips do not consume it); shield regen capped at max; damage ≥ 1; retreat at `retreat_hp_ratio`; slot/initiative rule per D16; per-round events do not alter RNG consumption; **known-defect tests**: `pierce_ratio` 0 vs 0.35 gives identical outcomes; odd-MOB DC uses half-to-even.

**S5.4 Escape, detection, encounter policy.** Depends on: S5.0, S5.3
- Files: `apps/api/src/resolution/encounter/{escape.resolver.ts,detection.ts,encounter-policy.ts,stance.ts,encounter-chance.ts}`.
- Acceptance: policy tree evaluated top-down and stops at the first applicable rule (GDD §8: ally → ignore; delivery/transport → flee; hunt and target match → attack; hostile by faction → stance; else ignore); mission context overrides stance; escape is always attemptable, monotonic in MOB (property test), failure has the configured consequence; radar/sensor failure yields guaranteed ambush; zones 0–1 produce no PvP; per-leg encounter chance `danger / chance_divisor` (D17). No numeric oracle — tests are table-driven from the S5.0 addendum.

**S5.5 Wear and part failure.** Depends on: S5.0, S4.2
- Files: `apps/api/src/resolution/wear/{wear.calculator.ts,failure.resolver.ts}`.
- Acceptance: base + environment (`env.nivel × wear.env_multiplier`) + overload (8–15); performance/choke tables exact; ≤1% is dead; failure consequences by part type per GDD §9 (motor abort, battery drop, tank leak 30–50%, shield down, weapon jam = half the rounds, sensor blind); **a failure event never carries a credit effect** (test).

**S5.6 Object integrity and payout.** Depends on: S5.0
- Files: `apps/api/src/resolution/object/integrity.ts`, `apps/api/src/economy/reward.calculator.ts` (pure).
- Acceptance: payout `base × integrity`, linear 100→50, zero below 50; mining exempt (yield-based); escorted NPC below 50% → zero, destroyed → failure; reward base formula per D13 exactly matches the oracle for the tape lives.

**S5.7 Pirate generator.** Depends on: S5.3
- Files: `apps/api/src/resolution/encounter/pirate.generator.ts`.
- Acceptance: anchored to the player's own sheet using the strength/jitter tables from config (the construction that yielded ~55% winrate); tape parity in Layer 2; the `NPC` table is not needed (pirate is embedded in the log).

**S5.8 Economy pure calculators.** Depends on: S5.6
- Files: `apps/api/src/economy/{repair-cost.calculator.ts,fuel-cost.calculator.ts}`.
- Acceptance: repair cost = sum over parts of `part_price × condition_lost% × repair_factor × repair_price / repair_price_ref`, plus `tier × maintenance_per_tier` once per repair action (the sim's validated form, which per-ship equals GDD §9's formula); fuel cost = `round(Σfuel_use × distance / 100 × env.fuel_mult) × fuel_price`. I/O wiring waits for S8.

**S5.9 Leg and mission resolvers.** Depends on: S5.3–S5.8
- Files: `apps/api/src/resolution/{leg/leg.resolver.ts,mission/mission.resolver.ts,events/mission-event.ts,resolution.module.ts}`.
- Interface: `resolveMission(input: { seed; snapshot; mission; rules; }): MissionOutcome` producing events `{ leg, category: 'combat'|'environment'|'loot'|'failure'|'payment'|'transit', type, actors, effects: { hp, condByPart, credits, loot[] }, magnitude }`.
- Acceptance: same inputs twice → deep-equal outputs; per-leg/per-purpose RNG streams via `child()`; fuel exhaustion → adrift, not death; **no I/O**: ESLint `no-restricted-imports` forbids `@prisma/client`, `@nestjs/*` and `bullmq` in every file under `resolution/**` and in the pure `economy/*.calculator.ts` files (only `*.module.ts` wiring files are exempt).

**S5.10 Validation harnesses.** Depends on: S5.1–S5.9
- Files: `apps/api/test/validation/{tournament.ts,life-sim.ts,parity.spec.ts,bands.spec.ts,production-mode.spec.ts}`.
- Acceptance: harness ports of `torneio-balanceamento.py` and `uma_vida`/`gerar_mapa` (test-only constants such as 300-mission cap and 90% post-upgrade condition live here, not in `GameConfig`); Layers 1–4 all pass; `pnpm --filter api test:validation` runs in CI in under a few minutes.

**Milestone M5.** The engine reproduces the validated numbers and the known simulator defects are pinned by tests.

---

### Step 6 — Missions (→ M6)

**S6.1 Missions data model.** Depends on: S4
- Files: migration `0005_missions` — `MissionInstance(id, templateId, type, factionId, originId, destinationId, legs jsonb, cargo jsonb, reward, expiresAt, status AVAILABLE|HELD|ACCEPTED|IN_TRANSIT|RESOLVING|DONE|FAILED|EXPIRED, playerId?, shipId?, acceptedAt?, arrivalAt?, seed, version)`.
- Acceptance: partial index on `(status, arrivalAt)` for `IN_TRANSIT`; index on `(originId, status, expiresAt)`; unique constraint enforcing one active mission per player.

**S6.2 Generator and board.** Depends on: S6.1, S3.4
- Files: `apps/api/src/missions/{generator/mission.generator.ts,generator/template.filler.ts,board.service.ts}`.
- Acceptance: deterministic for `(location, epoch, config version)`; lazy top-up on read guarded by `pg_advisory_xact_lock` so concurrent reads never duplicate; every location always has ≥1 mission (GDD §12); all 5 types appear across the map; expired missions are replaced with no penalty; reward estimate uses the viewer's tier.

**S6.3 Requirement checker.** Depends on: S4.2
- Files: `apps/api/src/missions/requirements.checker.ts`.
- Acceptance: returns `{ eligible, reasons[] }` with stable reason codes (cargo type, pressurized + life support, weapons, minimum mobility, miner, speed); pass/fail table per mission type (GDD §12).

**S6.4 Accept and hold.** Depends on: S6.2, S6.3, S2.5
- Files: `apps/api/src/missions/{mission.state-machine.ts,missions.controller.ts,missions.service.ts}`.
- Endpoints: `GET /v1/locations/:id/missions`, `POST /v1/missions/:id/accept`, `POST /v1/missions/:id/hold`, `DELETE /v1/missions/:id/hold`, `GET /v1/missions/active`.
- Acceptance: transition table tested exhaustively (pure state machine); the ship must be at the mission origin and viable; requirement failure returns the reasons; max 1 hold, hold timer keeps running, expired hold → `EXPIRED` ("start deadline"), no penalty; two players accepting the same mission → exactly one 200, one 409; accept is idempotent; reward finalized from the accepting ship's tier (D29).

**Milestone M6.** Board → requirement feedback → accept/hold works through the API.

---

### Step 7 — Jobs and time (→ M7)

**S7.1 Execution data model.** Depends on: S6
- Files: migration `0006_execution` — `MissionLog(id, missionId unique, playerId, seed, configVersion, outcome, shipSnapshot jsonb, legs jsonb, schemaVersion, createdAt)`, `RoutePresence(id, missionId, shipId, routeId, legIndex, window tstzrange)` with a raw-SQL GiST index, `Encounter(id, routeId, legIndex, missionAId, missionBId, seed, result jsonb, resolvedAt)` with a unique key.
- Acceptance: no text column anywhere in `MissionLog` (schema test); GiST index used by the overlap query (`EXPLAIN` test).

**S7.2 Duration and dispatch.** Depends on: S7.1, S4.3, S6.4
- Files: `apps/api/src/missions/{duration.calculator.ts,dispatch.service.ts}`, `POST /v1/ships/:id/dispatch { missionId }`.
- Acceptance: `duration = round(distance / MOB × duration_k) × time_scale`, class (fast/medium/long) from config cutoffs; in **one transaction**: ownership, viability re-check, fuel check, ship snapshot, ship → `ON_MISSION`, mission → `IN_TRANSIT` with `arrivalAt`, presence rows; the delayed job is enqueued after commit with `jobId = missionId`; if the enqueue fails the reconciler still resolves the mission (test); response carries `arrivalAt` and `serverTime`; dispatch is idempotent.

**S7.3 Resolve processor.** Depends on: S7.2, S5.9, S2.5
- Files: `apps/api/src/jobs/processors/mission.processor.ts`, `apps/api/src/jobs/producers/mission.producer.ts`.
- Acceptance: claims the mission with a conditional update (`IN_TRANSIT → RESOLVING`); one transaction writes the log, ship damage/fuel/location, wallet credit + `PlayerEvent`, loot into inventory and final status; **double invocation produces a single effect** (payout credited once); retries with backoff and a dead-letter path; a mission stuck in `RESOLVING` is returned to `IN_TRANSIT` by the reconciler.

**S7.4 Reconciliation tick.** Depends on: S7.3
- Files: `apps/api/src/jobs/{reconcile.scheduler.ts,processors/reconcile.processor.ts}`.
- Acceptance: repeatable job every `RECONCILE_INTERVAL_MS`; resolves `IN_TRANSIT` missions past `arrivalAt` whose job is missing (kill-worker and lost-job scenarios); "resolve on read": `GET /v1/missions/active` triggers a bounded reconcile for that player; server down at `arrivalAt` → resolved on next boot.

**S7.5 PvP overlap encounters.** Depends on: S7.1, S5.4
- Files: `apps/api/src/missions/encounters/{route-presence.service.ts,encounter.service.ts}`.
- Acceptance (D1): overlapping missions produce exactly one `Encounter` row and an event in **both** logs; result is identical regardless of which mission resolves first (permutation test); non-overlapping windows → none; defender need not be online (uses the dispatch snapshot); same-faction → ignored per the tree; zones 0–1 → no PvP.

**S7.6 Replay determinism.** Depends on: S7.3
- Files: `apps/api/test/e2e/replay.e2e-spec.ts`.
- Acceptance: re-running a stored `MissionLog` (snapshot + seed + `configVersion`) reproduces identical events, including after `GameConfig` was changed in between (uses the stored revision, D19).

**S7.7 In-transit lock.** Depends on: S7.2
- Acceptance: assemble, stance, repair, sell of installed parts and a second dispatch are rejected with 409 while `ON_MISSION`.

**Milestone M7.** Headless loop works: accept → dispatch → worker → log → payout, with restart resilience.

---

### Step 8 — Economy (→ M8)

**S8.1 Pricing.** Depends on: S5.8, S3
- Files: `apps/api/src/economy/{price.calculator.ts,pricing.service.ts}`.
- Acceptance: `price = base × isolation × faction × mood` (isolation 0.9/1.0/1.4/2.0, faction 0.8/1.0/2.5, mood 0.85–1.15 fixed per location) times a condition multiplier; sell = `sell_ratio` (0.6) × value; no faction start discount in v0.1 (D27); the hub-vs-hostile spread is ≈6× (economy doc table reproduced within tolerance).

**S8.2 Market.** Depends on: S8.1, S2.5
- Files: `apps/api/src/economy/{market.service.ts,market.controller.ts}`.
- Endpoints: `GET /v1/locations/:id/market`, `POST /v1/market/buy { listingId, expectedPrice }`, `POST /v1/market/sell { partInstanceId, expectedPrice }`.
- Acceptance: buy = validate + debit + deliver in one transaction; `expectedPrice` is only a stale-price guard (409 `PRICE_CHANGED`), never trusted as the price; parallel buys cannot overspend; idempotent; blocked while balance is negative (GDD §14); used offers per D25.

**S8.3 Refuel.** Depends on: S8.1
- Files: `apps/api/src/economy/refuel.service.ts`, `POST /v1/ships/:id/refuel { mode, amount? }`.
- Acceptance: instant (no job); capped by tank; local price; atomic with the wallet.

**S8.4 Repair job.** Depends on: S8.1, S7.3
- Files: `apps/api/src/economy/repair.service.ts`, `apps/api/src/jobs/processors/repair.processor.ts`, `POST /v1/ships/:id/repair { targets: [{ partInstanceId, toCondition }] }`.
- Acceptance: cost per S5.8 charged up-front and atomically; duration = points × `k` (3 s/point at a hub, 8 at an outpost); parts change condition only on completion; ship cannot dispatch while repairing; job idempotent; reconciler also covers lost repair jobs.

**S8.5 Scavenging and drops.** Depends on: S8.1, S3.4
- Files: `apps/api/src/economy/scavenging.service.ts`, `POST /v1/locations/:id/scavenge`.
- Acceptance: drop chances 25% / 55% / 75% by field type, quality 30–70%, common parts mostly (GDD §14), deterministic per seed; per-player cooldown (D28); loot lands in inventory.

**S8.6 Inventory, defeat and rescue.** Depends on: S8.2, S7.3
- Files: `apps/api/src/economy/{inventory.service.ts,rescue.service.ts}`, `POST /v1/ships/:id/rescue`.
- Acceptance: auto-rescue costs 800 ¢ and may drive the balance negative; restart parts are common, ≤50% condition, free; while negative: buy/upgrade blocked, navigation and mining allowed, missions pay it back (spending guard has tests both ways); the player always ends with a viable ship.

**S8.7 Ship tier.** Depends on: S8.1
- Files: `apps/api/src/economy/ship-tier.ts`.
- Acceptance: tier = bucket of installed-part base value against the `upgrade_costs` thresholds (D14); consumed by reward scaling and pirate strength.

**Milestone M8.** Complete economic loop through the API; money invariants hold under parallel requests.

---

### Step 9 — Reports (→ M9)

**S9.1 Event schema.** Depends on: S5.9, S7.1
- Files: `apps/api/src/reports/events/{event.types.ts,event.schema.ts}`.
- Acceptance: persisted events are validated (zod) and versioned; unknown `schemaVersion` fails loudly on read.

**S9.2 Template engine and content.** Depends on: S9.1
- Files: `apps/api/src/reports/templates/{template.engine.ts,en/*.json,pt-BR/*.json}`.
- Acceptance: deterministic variant choice via `deriveSeed(seed, 'narr:' + eventIndex)`; every event `type` in the union has ≥2 templates **in each locale** (a coverage test iterates union × locales and fails on any gap); the same stored log renders in either locale with identical structure and numbers; locale is chosen per request (`?locale=`, default the player's saved locale); all placeholders resolved; entity placeholders (`{part}`, `{loot}`) render as popup-able references; tone per GDD §1 (Expanse), mechanical numbers inline and discreet.

**S9.3 Views and API.** Depends on: S9.2, S2.4
- Files: `apps/api/src/reports/{summary.view.ts,narrative.view.ts,log.view.ts,reports.controller.ts,reports.service.ts}`, `GET /v1/reports`, `GET /v1/reports/:missionId?view=summary|narrative|log`.
- Acceptance: the three views render the **same stored events**; summary = highest-magnitude events + result + balance (2–3 lines); log = one line per event as `[leg · category] description — effect`; ownership enforced (a PvP participant reads only their own log); stored data contains no template text (schema test); rewriting a template changes output but not stored data; identical log → byte-identical text.

**S9.4 API-level E2E of the whole loop.** Depends on: S9.3, S8
- Files: `apps/api/test/e2e/happy-path.e2e-spec.ts`.
- Acceptance: with `time_scale` making a mission ~2 s: register → onboarding → auto-assemble → board → accept → dispatch → wait → read report → sell loot → refuel → repair; runs in CI.

**Milestone M9.** The complete v0.1 player loop works via the API.

---

### Step 10 — Frontend (→ M10, playable)

Visual references are the prototypes; they are rebuilt as React components consuming the API. The client holds **no game rules**: it renders server state, sends intentions, and derives nothing beyond geometry and countdown display.

**S10.1 Scaffold and API client.** Depends on: S2 (can start early against mocks)
- Files: `apps/web/{package.json,vite.config.ts,tsconfig.json,src/main.tsx,src/app/router.tsx,src/api/{client.ts,generated.ts},src/test/msw/*}`, `docker/{web.Dockerfile,nginx.conf}`.
- Acceptance: OpenAPI from Nest Swagger (dev only) committed as `openapi.json`; `openapi-typescript` client regenerated in CI and diffed (drift fails); MSW handlers are typed from the same spec; nginx serves the SPA and proxies `/v1` same-origin with CSP and security headers; ESLint forbids `Math.random` and imports of any rules code. i18n: `react-i18next` with `apps/web/src/i18n/{en,pt-BR}/*.json`; a test fails when any key exists in one locale and not the other, and an ESLint rule (`react/jsx-no-literals`) fails on hard-coded user-visible strings; language switcher persists via `POST /v1/players/me/locale`; dates, numbers and currency use `Intl` with the active locale; API error codes and requirement reasons are mapped to translated messages on the client.

**S10.2 Auth shell and J8.** Depends on: S10.1, S2.3, S4.3
- Files: `apps/web/src/features/auth/*`, routes `/login`, `/onboarding`.
- Acceptance: access token in memory only, silent refresh via the cookie (D5), protected routes, expired session redirects cleanly; faction picker (no switching, GDD §10) shows GDD colors; error and loading states.

**S10.3 Shared UI kit.** Depends on: S10.1
- Files: `apps/web/src/ui/{ItemCard,PortTabs,Countdown,RiskBadge,FactionBadge,Popup}.tsx`, design tokens from the prototypes' CSS variables.
- Acceptance: component tests; `Countdown` uses the server clock offset from `serverTime`; each screen accepts a `guided` prop placeholder for the future tutorial (GDD §16 note, not built).

**S10.4 J3 Hangar `/hangar`.** Depends on: S10.3, S4.3 — reference `montagem-esboco-v2.html`
- Acceptance: drag/snap/rotate is client-side geometry only; derived stats and viability warnings come from the server preview call (D20, debounced); auto mode works; saving sends `assemble`; viability problems shown with their reasons.

**S10.5 J2 Map `/map`.** Depends on: S10.3, S3 — reference `mapa-esboco.html`
- Acceptance: 12 nodes, routes, faction control, risk, mission counts, "you are here"; keyboard-navigable nodes.

**S10.6 J1 Board `/board`.** Depends on: S10.3, S6.4 — reference `quadro-missoes-esboco.html`
- Acceptance: 5 mission types, filters, requirement mismatch disables Accept and shows the reason, hold flow (max 1), expiry display.

**S10.7 J6 Transit `/transit`.** Depends on: S10.3, S7.2
- Acceptance: countdown to `arrivalAt`; current leg shown from server-provided leg windows; refetch when the timer ends (the client never decides the mission is done); abort is intentionally absent (D26).

**S10.8 J4 Report `/report/:id`.** Depends on: S10.3, S9.3 — reference `relatorio-narrado-esboco.html`
- Acceptance: 3 views (summary default, narrative and log opt-in); loot and damage cascade (shield → armor → HP) open detail popups.

**S10.9 J5 Port, J7 Inventory, J9 Profile.** Depends on: S10.3, S8 — reference `porto-esboco.html`
- Acceptance: one screen with tabs market · repair · refuel · scavenging; confirmation popup on every buy/sell; repair slider per part + "repair all"; "fill tank"; negative balance displayed and spending disabled; inventory install/sell; profile shows wallet and history.

**S10.10 Navigation flow.** Depends on: S10.4–S10.9 — reference `fluxograma-navegacao.html`
- Acceptance: Hangar → Map → Board → Transit → Report → Port → Map loop reachable without dead ends; *manual* full playthrough against `docker compose --profile dev up`.

**Milestone M10.** A person can play the whole loop in a browser.

---

### Step 11 — Admin (→ M11)

**S11.1 Admin access.** Depends on: S2.4
- Files: `apps/api/src/admin/{admin.module.ts,guards/admin.guard.ts,audit/admin-audit.service.ts}`, migration adds `AdminAuditLog`, CLI `pnpm --filter api admin:create`.
- Acceptance: everything under `/v1/admin/*` requires role `ADMIN`; no default admin credentials and no public admin-creation endpoint; every write produces an audit row (actor, action, target, before/after, ip); non-admin → 403 on all routes (route-metadata test).

**S11.2 Tuning (screen E).** Depends on: S11.1, S3.3
- Files: `apps/api/src/admin/tuning/*`, `SystemFlag`/`SystemNotice` tables.
- Acceptance: `GameConfig` edits validated against S3.2 bounds, written with a `GameConfigRevision` in one transaction, published on pub/sub; optimistic `expectedVersion` (409 on concurrent edit); part catalog, map (control, mood, environments) and mission-type/generation-rate editing; feature flags, broadcast, maintenance mode (player intents → 503, admin unaffected); an edit takes effect without restart (integration).

**S11.3 Dashboard, economy, world (A–C).** Depends on: S11.1, S9
- Files: `apps/api/src/admin/analytics/{dashboard,economy,world}.service.ts`.
- Acceptance: with a seeded fixture the aggregates are exact: active/new players, mission success rate, **real winrate vs the 55% baseline**, credits entering vs leaving (inflation), sinks breakdown (confirms wear as main drain), tier distribution, traffic per route, pirate encounters, generation vs consumption per zone; queries are time-windowed and indexed.

**S11.4 Player inspector (D).** Depends on: S11.1, S7.6
- Files: `apps/api/src/admin/inspector/*`.
- Acceptance: player sheet, `PlayerEvent` timeline, report **replay** using the stored `configVersion`; support actions (grant/remove credits, unstick ship, clear negative balance, ban, reset) each audited and requiring a reason.

**S11.5 Admin frontend.** Depends on: S11.2–S11.4, S10.1
- Files: `apps/web/src/admin/**` (lazy-loaded route bundle `/admin`), screens A–E; screen F (raw logs) deliberately skipped (GDD §17: maybe unnecessary).
- Acceptance: component tests; non-admin cannot load the bundle route; destructive actions need confirmation.

**Milestone M11.**

---

### Step 12 — Hardening (→ M12)

**S12.1 Rate-limit policy.** Depends on: S1.5, S2
- Files: `apps/api/src/common/throttling/{policies.ts,throttler-redis.storage.ts}`.
- Acceptance: policy matrix per route class (auth strict, intents moderate, reads generous, preview generous); Redis-backed store so limits hold across instances; tests per class.

**S12.2 Security automation.** Depends on: all API steps
- Files: `apps/api/test/security/{route-audit.spec.ts,authz-matrix.spec.ts,forged-payload.spec.ts,idempotency-matrix.spec.ts,redaction.spec.ts}`.
- Acceptance: **route-metadata audit** fails if any route lacks `@Public`, `@Roles` or an ownership declaration, a DTO, or a throttle policy; the authz matrix exercises every `:id` route as player A vs player B (→ 403); every intent endpoint rejects forged result fields; every mutating endpoint is either idempotency-keyed or naturally idempotent (enumerated list); cookie flags, CORS and CSP asserted; `pnpm audit --prod` and secret scanning gate CI.

**S12.3 Concurrency soak.** Depends on: S8, S7
- Files: `apps/api/test/e2e/soak.e2e-spec.ts`.
- Acceptance: parallel buys, accepts, dispatches and repairs; invariants hold: no negative balance from a non-rescue path, no double payout, no duplicate encounter, no part owned twice.

**S12.4 Browser E2E.** Depends on: S10, S9.4
- Files: `apps/web/e2e/happy-path.spec.ts` (Playwright), CI job using compose `test` profile and `time_scale`.
- Acceptance: register → play one full loop → report visible → sell loot, green in CI.

**S12.5 Operations.** Depends on: S1.4, S11
- Files: README runbook section (migrations/seed on boot, first-admin CLI, backup/restore, env reference), `compose.yaml` prod review.
- Acceptance: `docker compose --profile prod config` valid against external Postgres/Redis; readiness/liveness endpoints; graceful shutdown drill (SIGTERM mid-job) *manual*.

**S12.6 Security review and release.** Depends on: S12.1–S12.5
- Acceptance: run the `security-review` skill over the full tree, fix or explicitly accept each finding; tag `v0.1.0`.

**Milestone M12.** Release candidate.

---

## Appendix A — `GameConfig` key inventory (seeded defaults)

Sources: `S` = `simulation/sweep-rust-and-spark.py`, `I` = `simulador-integrado.py`, `G` = GDD, `E` = `economia`/`desgaste` docs. Keys are dotted, values typed and bounded in S3.2. Environment and catalog values live in their own tables, not here.

| Key | Default | Source | Notes |
|---|---|---|---|
| `combat.dodge_factor` | 1.5 | S/G §19 | DC = 10 + roundHalfEven(defender MOB × this) |
| `combat.dc_base` / `attack_die` / `damage_die` | 10 / 20 / 6 | S | literals in the sim |
| `combat.armor_cap` | 4 | S/G | |
| `combat.pierce_ratio` | 0.35 | S/G | **inert** (D16a) |
| `combat.pierce_min_pdf` | 8 | S | |
| `combat.shield_regen` | 2 | S/G | |
| `combat.kite_factor` | 0.2 | S/G | |
| `combat.first_strike_bonus` | 2 | S/G | |
| `combat.max_rounds` | 40 | S/I | tournament used 50 |
| `combat.retreat_hp_ratio` | 0.2 | S/G §8 | |
| `ship.mob_factor` | 1.6 | G §6.2 | |
| `ship.fuel_mass_per_unit` | 0 | I | catalog says 0.1; sim ignores fuel mass |
| `wear.performance_floor` / `performance_slope` | 0.5 / 0.5 | G §9 | |
| `wear.choke_threshold` | 30 | G §9 | D11 |
| `wear.dead_at_or_below` | 1 | G §9 | |
| `wear.base_min` / `base_max` | 3 / 5 | S/G | |
| `wear.env_multiplier` | 1.2 | S/G | D12 |
| `wear.choke_loss_min` / `max` | 3 / 8 | S | |
| `wear.defeat_loss_min` / `max` | 8 / 15 | S | |
| `wear.overload_min` / `max` | 8 / 15 | G §9 | |
| `wear.scale_mode` | `all_stats` | D13 | `hp_only` in parity tests |
| `economy.fuel_price` | 3 | S/G | tolerates 2–4 |
| `economy.repair_price` / `repair_price_ref` | 6 / 4 | S/G | |
| `economy.repair_factor` | 0.8 | S/G §9 | |
| `economy.maintenance_per_tier` | 100 | S/G | 100–200 valid |
| `economy.reward_base` / `reward_per_tier` | 200 / 120 | S/G | |
| `economy.reward_danger_divisor` | 15 | S | |
| `economy.reward_distance_ref` / `distance_divisor` | 800 / 3000 | S | |
| `economy.reward_type_bonus` | 1.0 per type | D13 | tune later |
| `economy.combat_win_base` / `per_tier` | 100 / 50 | S | |
| `economy.combat_loss_penalty` | 120 | S | |
| `economy.upgrade_costs` | `{2:2500,3:7000,4:16000,5:32000}` | S/G | also tier thresholds (D14) |
| `economy.start_credits` | 200 | S | D15 decided; GDD's 3,000 superseded |
| `economy.rescue_cost` | 800 | G §14 | |
| `economy.sell_ratio` | 0.6 | G §13 | |
| `economy.isolation_mult` | `{0:0.9,1:1.0,2:1.4,3:2.0}` | G §13 | |
| `economy.faction_mult` | `{ally:0.8,neutral:1.0,hostile:2.5}` | G §13 | |
| `economy.mood_min` / `mood_max` | 0.85 / 1.15 | G §13 | |
| `economy.rarity_base_price` | `{common:100,uncommon:300,rare:800,epic:2000,legendary:5000}` | E | |
| `economy.payout_floor_integrity` | 0.5 | G §12 | |
| `economy.repair_seconds_per_point` | `{hub:3,outpost:8}` | G §13 | |
| `encounter.chance_divisor` | 20 | S | D17 |
| `encounter.pirate_strength_options` | `[0.55,0.7,0.8,0.85,1.0,1.1]` | S | |
| `encounter.pirate_mob_jitter` / `sen_jitter` | `[-1,0,1]` | S | |
| `encounter.pirate_bli_ratio` | 0.6 | S | |
| `encounter.pirate_min_pdf` / `min_hp` | 2 / 30 | S | |
| `escape.enemy_sen_weight` / `preset_bonus` | 1 / 2 | D18 | Appendix E |
| `detection.ambush_per_sen_point` / `ambush_cap` | 0.1 / 0.5 | D18 | |
| `stance.neutral_attack_ratio` / `rating_armor_weight` | 1.2 / 5 | D18 | |
| `failure.tank_leak_min` / `max` | 0.3 / 0.5 | D18 | |
| `failure.weapon_skip_ratio` | 0.5 | D18 | |
| `integrity.combat_factor` / `env_factor` | 0.6 / 0.4 | D18 | |
| `mining.richness` | `{open:0.2,radiation:0.35,gravitational:0.3,debris:0.6}` | D18 | |
| `mining.rarity` / `material_price` | `{common:0.3,uncommon:0.6,rare:0.85}` / `{common:20,uncommon:60,rare:200}` | D18 | prices provisional |
| `mining.attempts_per_stop` | 10 | D18 | |
| `rescue.reference_mob` / `deadline_factor_min` / `max` | 3 / 1.25 / 2.0 | D18 | |
| `escort.encounter_multiplier` / `client_target_share` | 1.5 / 0.4 | D18 | |
| `ship_class.cargo_share` / `pressurized_share` / `combat_share` | 0.30 / 0.15 / 0.45 | owner | display label only |
| `missions.hold_max` / `active_max` | 1 / 1 | G §12 | |
| `missions.duration_k` | 2.25 | D21 | |
| `missions.duration_class_cutoffs` | `{fast:600,medium:1800}` | D21 decided | seconds; long is above medium |
| `missions.time_scale` | 1 | D21 | tests/dev shrink it |
| `missions.board_min_per_location` | 1 | G §12 | |
| `scavenging.chance` | `{common:0.25,mission:0.55,pirate:0.75}` | G §14 | |
| `scavenging.quality_min` / `max` | 30 / 70 | G §14 | |
| `scavenging.cooldown_seconds` | 300 | D28 decided | |
| `parts.starter_condition` | 80 | G §9 | |
| `parts.restart_condition_max` | 50 | G §14 | |
| `world.seed` | fixed | G §13 | drives price mood |

## Appendix B — Entity → step map

| Entity (GDD §18) | Step | Notes |
|---|---|---|
| `PLAYER`, `Account`, `RefreshToken`, `PlayerEvent`, `IdempotencyKey` | S2 | credentials split from `PLAYER` (D23) |
| `GameConfig`, `GameConfigRevision` | S3 | |
| `FACTION`, `LOCATION`, `ROUTE`, `ENVIRONMENT`, `PART_CATALOG`, `MISSION_TEMPLATE`, `DROP_TABLE` | S3 | seeded |
| `PART_INSTANCE`, `SHIP` | S4 | + `currentLocationId`, `stance` |
| `MISSION_INSTANCE` | S6 | |
| `MissionLog` (= `MISSION_REPORT` without text), `RoutePresence`, `Encounter` | S7 | |
| `NPC` | deferred | pirates embedded in the log; escort client stored in mission cargo |
| `AdminAuditLog`, `SystemFlag`, `SystemNotice` | S11 | |

## Appendix C — Glossary (Portuguese docs → English identifiers)

faccao→faction · nave→ship · peça→part · catálogo→catalog · condição→condition · desgaste→wear · engasgo→choke · perna→leg · missão→mission · entrega/transporte/escolta/mineração/resgate→delivery/transport/escort/mining/rescue · carga→cargo · perigo→danger · isolamento→isolation · humor→mood · porto→port · sucata→scrap · encontro→encounter · postura→stance · fuga→escape · integridade→integrity · prêmio→payout · ponte→bridge · escudo→shield · blindagem→armor · quadro→board · reparo→repair · abastecer→refuel · resgate automático→rescue · nó→node · rota→route · fronteira→frontier · MOB/PDF/BLI/ESC/SEN/CRG/HP keep their acronyms (mobility, firepower, armor, shield, sensors, cargo, hit points).

## Appendix D — Spec coverage (self-review)

| GDD § | Covered by |
|---|---|
| 2 RPG foundation, 8 Combat | S5.3, S5.4 |
| 3 Multiplayer, 4 Loop | S7, S9.4, S10 |
| 5 Ship and assembly, 6 Catalog, 7 Energy/viability | S3.4, S4 |
| 9 Wear and maintenance | S4.2, S5.5, S8.4 |
| 10 Factions, 11 Map/environments | S3.4, S5.4 |
| 12 Missions | S5.6, S6, S7 |
| 13 Economy, 14 Defeat/scavenging | S5.8, S8 |
| 15 Narrated report | S9 |
| 16 Screens J1–J9 | S10 |
| 17 Admin A–E | S11 |
| 18 Data model | Appendix B |
| 19 Reference numbers | S5 (validation layers), Appendix A |
| Arch §7 Security, §8 Tests | S1.5, S2, S12.2, per-step acceptance |
| Arch §9 Docker | S1.4, S12.5 |

Not built in v0.1 (by design): proactive world, dynamic markets, tactical positioning, chained missions, inventory limit, dumping core, reputation, mission abort, cosmetic hull, tutorial, screen F.

All items that had no numeric oracle (escape, detection/ambush, presets, per-type failure consequences, integrity damage, mining, rescue deadline, escort, ship class) are resolved in Appendix E.

## Appendix E — Approved rule defaults (S5.0 addendum, owner-approved 2026-09-21)

No simulator oracle exists for these; they are first guesses built from validated mechanics and are all `GameConfig` values, tuned by playing. Each rule below becomes table-driven test cases in the task named in brackets.

- **Escape** [S5.4]: success if `d20 + roundHalfEven(MOB × dodge_factor) ≥ combat.dc_base + roundHalfEven(enemyMOB × dodge_factor) + enemySEN × escape.enemy_sen_weight`. Failure: enemy takes slot A and the `first_strike_bonus` ("fight at a disadvantage"). Every escape attempt applies overload wear (`wear.overload_min..max`, 8–15%) to motor parts. Escape preset adds `escape.preset_bonus` (+2) to the roll.
- **Ambush / detection** [S5.4]: dead sensor → guaranteed ambush and no escape attempt. Otherwise, if enemy SEN > player SEN, ambush chance = `(enemySEN − playerSEN) × detection.ambush_per_sen_point`, capped at `detection.ambush_cap`. An ambushed ship loses slot A and the first strike.
- **Neutral stance** [S5.4]: attack only if `rating(self) ≥ stance.neutral_attack_ratio × rating(enemy)`, with `rating = PDF × (HP + ESC + stance.rating_armor_weight × BLI)`.
- **Presets** [S5.4]: Cruise / Combat / Escape are named profiles recorded as events. Only Escape has a numeric effect (bonus and overload wear above); Combat has none in v0.1 because the validated sim assumes the shield is always on.
- **Part choke** [S5.5]: rolled once per leg for each critical part with the validated `((30 − condition) / 30)²`; a triggered choke also costs `wear.choke_loss_min..max` (3–8) condition. Consequences: motor → leg aborted and mission `FAILED` (fuel burned, wear applied, no pay); battery → shield offline for the leg; tank → lose `failure.tank_leak_min..max` (30–50%) of remaining fuel; shield → next hit bypasses it; weapon → skips `failure.weapon_skip_ratio` (half) of its attacks; sensor → guaranteed ambush.
- **Object integrity damage** [S5.6]: combat costs `integrity.combat_factor × (share of max HP lost) × 100` points; environment costs `integrity.env_factor × env.nivel` points per leg; a defeat with cargo aboard fails the mission. Escort: integrity is the client ship's HP share.
- **Mining** [S5.6, S8]: chance per attempt = `richness(env) × (1 − rarity(material)) × efficiency`, `efficiency = MIN × performance(miner)`; `mining.attempts_per_stop` = 10. Material sale prices (`mining.material_price`) were **not** in the approved table and are provisional.
- **Rescue deadline** [S6.2]: `round-trip time at rescue.reference_mob × uniform(rescue.deadline_factor_min, rescue.deadline_factor_max)` (1.25–2.0); a MOB 2 ship needs a factor ≥ 1.5.
- **Escort** [S5.9]: encounter chance × `escort.encounter_multiplier` (1.5) per leg; the client ship absorbs `escort.client_target_share` (40%) of enemy attacks; client HP comes from the mission template.
- **Ship class** (display label only) [S4.2]: first match wins — Hauler if cargo ≥ 30% of structure cost, Transport if pressurized ≥ 15%, Warship if weapons + defense ≥ 45%, Miner if it carries mining gear, else Multirole.
