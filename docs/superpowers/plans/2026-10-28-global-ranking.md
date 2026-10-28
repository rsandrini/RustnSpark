# Global Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Four live boards (distance, fights won, race wins, fastest time per route), weekly and lifetime, top 50 plus the pilot's own position.

**Architecture:** Counter boards read `PlayerStats` / `PlayerStatsDaily` JSON totals through one ranked SQL; race times come from a new `RaceResult` table written at mission resolve. One `RankingsService`, one controller, one web page.

**Tech Stack:** NestJS + Prisma/Postgres raw SQL, zod contract, React + Vitest, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-28-global-ranking-design.md`

## Global Constraints

- Code in English; every string en + pt-BR; every new API error code translated (`error.*`); no `@rustandspark/contract` import in `apps/api/src` (local types, parsed in an int-spec).
- Stage explicit paths; commit on green; do not push. Node 22. Own test Postgres/Redis on other ports than the owner's.
- Name constants (no magic numbers in `src`). Controls 40 px+ on a phone.
- Param routes need an entry in `test/security/route-audit.spec.ts` `SELF_SCOPED_PARAM_ROUTES`.

## Review Focus

- A pilot ranked 51st or lower still sees their own row. A pilot with no result sees `me: null`.
- Ties order deterministically. Banned accounts and zero values never appear.
- A weekly board right after Monday 00:00 UTC is empty, not an error; a route with no results is empty, not 404.
- A hostile `route` or `board` value cannot reach SQL (board whitelisted, route a bound parameter).

## Tasks

### Task 1: RaceResult table
**Files:** `apps/api/prisma/schema.prisma`, new migration, `apps/api/test/integration/race-result-schema.int-spec.ts`.
**Produces:** model `RaceResult { id, playerId (cascade), missionId @unique, routeKey, originId, destinationId, seconds Int, place Int, day @db.Date, createdAt }`, indexes `(routeKey, seconds)`, `(routeKey, day)`, `(playerId)`.
- [ ] Failing int test: insert two results, duplicate `missionId` rejected, deleting the pilot removes them.
- [ ] Add the model, `prisma migrate dev --name race_result`; test passes. Commit.

### Task 2: Record race results at resolve
**Files:** `src/stats/run-stats.ts` (return `race: { place, seconds } | null`), `src/missions/resolve.service.ts`, tests `test/unit/stats/run-stats.spec.ts`, `test/integration/resolve-processor.int-spec.ts`.
**Produces:** `RunStats.race`; resolve inserts a `RaceResult` (routeKey `${mission.originId}>${mission.destinationId}`, day = UTC day) in the same transaction when `race !== null`.
- [ ] Failing unit test: race event gives `race: { place: 2, seconds: 220 }`, none otherwise. Failing int: resolving a race mission writes one row; a second resolve call writes no second row.
- [ ] Implement. Commit.

### Task 3: RankingsService
**Files:** `src/stats/rankings.service.ts`, `src/stats/rankings.types.ts`, `src/stats/week.ts`, tests `test/unit/stats/week.spec.ts`, `test/integration/rankings.int-spec.ts`.
**Produces:** `weekStartOf(now: Date): Date` (Monday 00:00 UTC); `type RankingBoard = 'distance'|'fights_won'|'race_wins'|'race_time'`; `RankingsService.board(playerId, board, window, route?)` and `.raceRoutes()` returning the shapes in the spec.
- [ ] Failing unit: `weekStartOf` for a Wednesday, for Monday 00:00:00 exactly (same instant), for Sunday 23:59 (previous Monday).
- [ ] Failing int, one case each: lifetime and weekly for a counter board (daily rows decide the week); race time lifetime vs weekly min; tie order by join date then name; banned hidden; zero hidden; own row at position 60 returned in `me` while `entries` has 50; empty board; unknown route empty.
- [ ] Implement with a ranked CTE (`ROW_NUMBER() OVER (ORDER BY value, "createdAt", id)`), `COUNT(*) OVER ()` for the total, board key from a whitelist, route as a bound parameter. Commit.

### Task 4: Controller, errors, contract
**Files:** `src/stats/rankings.controller.ts`, `stats.module.ts`, `packages/contract/src/index.ts` (`RankingResponseSchema`, `RaceRoutesResponseSchema`), `test/security/route-audit.spec.ts`, `apps/web/src/i18n/{en,pt-BR}.json` (`error.INVALID_BOARD`, `INVALID_WINDOW`, `ROUTE_REQUIRED`), `test/integration/rankings-api.int-spec.ts`.
- [ ] Failing int: 200 shapes parse with the contract schemas for each board; `race-routes` is matched before `:board`; 400 codes for bad board, bad window, missing route; 401 anonymous.
- [ ] Implement; route-audit entry for `GET /v1/rankings/:board`. Commit.

### Task 5: Web page
**Files:** `apps/web/src/features/rankings/rankings.page.tsx` (+ spec), `router.tsx` (`/rankings`), `ui/AccountMenu.tsx` (link), `app/navigation.spec.tsx`, `styles/rankings.css`, i18n `rankings.*` and `nav.rankings`, MSW handlers.
- [ ] Failing Vitest: renders rows from a fixture with the own row pinned; empty board message; switching Weekly/Lifetime and board refetches; race-time board shows the route picker with location names; pt-BR labels.
- [ ] Implement. `tsc`, lint, whole web suite. Commit.

### Task 6: Smoke and docs
**Files:** `apps/web/e2e/rankings.spec.ts`, `docs/TODO.md` (remove the ranking item).
- [ ] Spec: a pilot flies a mission, opens `/rankings`, sees themselves on Distance lifetime and weekly, the page passes `assertClean`.
- [ ] Run the isolated-stack smoke, then the full gate (lint, api unit/int/security/validation, web). Rebuild the dev stack. Commit.
