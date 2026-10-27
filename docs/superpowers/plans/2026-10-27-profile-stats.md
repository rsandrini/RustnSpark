# Profile Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the maximum per-pilot numbers from the first flight (lifetime and per day), and serve them as a public card and a private view.

**Architecture:** A `PlayerStats` row per pilot holds a JSON bag of totals and records, plus a `PlayerStatsDaily` row per pilot per UTC day. A `PlayerStatsService` adds deltas with one `INSERT ... ON CONFLICT` JSONB merge, always inside the caller's transaction. Hooks sit in the wallet (money), mission resolve (run numbers), and the economy services (counts). One visibility table in code decides public versus private.

**Tech Stack:** NestJS 10, Prisma 5 + Postgres (JSONB), Jest (unit / int-spec), React 18 + Vitest, zod contract package, Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-10-27-profile-stats-design.md` (read it first; the owner's answers are in its "Decisions" section).

## Global Constraints

- Code and comments in English; every player-facing string bilingual (`en.json` + `pt-BR.json`), none hard-coded.
- Never `git add -A`: stage explicit paths. Commit only on green tests. Do not push unless asked.
- Node 22 for API tests: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`; run `pnpm --filter api test:unit` / `test:int` (not bare `npx jest`).
- Stats are a **read model**: they never feed back into resolution (determinism and replay stay untouched).
- Every stat write uses the caller's `tx`. A failed action writes no stat.
- A stat key is a member of one list (`STAT_KEYS`); an unknown key is a compile error.
- No magic numbers in `src` (the lint rule that flagged `board-size.ts`): name constants.
- The DB is reset after this lands (owner): no backfill, no data migration; one new Prisma migration is enough.
- The public card never shows the ship's parts, layout or picture. Always public for now (no off switch).
- Mobile first: the web page works at 320 px.

## Review Focus

- A mission retried or resolved twice must count once (the `MissionLog.missionId` unique claim guards the stat write).
- A pilot with no stats row yet (just registered) reads as zeros, not 404/500.
- A pilot name with odd characters (spaces, unicode, `%`, `/`) in `GET /players/:name/profile` resolves or 404s cleanly.
- A credit near `MAX_CREDITS` must not overflow a stat counter (use `bigint`-safe JSON numbers: counters stay far below 2^53; the wallet peak is a record, not a sum).
- A ship destroyed in a run (bridge dead) still records the run, then the loss.
- A visibility key added to `STAT_KEYS` without a visibility entry fails a test, never leaks.

---

## File Structure

New module `apps/api/src/stats/`:
- `stat-keys.ts`: `STAT_KEYS`, `StatKey`, `RECORD_KEYS`, `RecordKey`, `StatDelta`.
- `visibility.ts`: `PUBLIC_STAT_KEYS`, `PUBLIC_RECORD_KEYS`, `publicView()`.
- `player-stats.service.ts`: `PlayerStatsService` (`add`, `best`, `touch`, `read`).
- `run-stats.ts`: pure `runStatsOf()` from a resolved mission's events.
- `callsign.ts`: pure placeholder ship name.
- `profile.service.ts` + `stats.controller.ts` + `stats.module.ts`.
- `dto/` as the project does it.

Modified: `prisma/schema.prisma`, `players/wallet.service.ts`, `missions/resolve.service.ts`, `missions/mining-job.service.ts`, `economy/{repair,refuel,market,rescue,part-upgrade,bridge-resize,materials}.service.ts`, `auth/auth.service.ts`, `packages/contract/src/index.ts`, `apps/web/src/features/profile/*`, `i18n/{en,pt-BR}.json`, `docs/TODO.md`.

---

### Task 1: Schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_player_stats/migration.sql` (generated)
- Test: `apps/api/test/integration/player-stats-schema.int-spec.ts`

**Interfaces:**
- Produces: Prisma models `PlayerStats { playerId @id, totals Json, records Json, firstMissionAt DateTime?, lastActiveAt DateTime?, createdAt, updatedAt }` and `PlayerStatsDaily { playerId, day DateTime @db.Date, totals Json; @@id([playerId, day]) }`, both relating to `Player` (cascade delete), plus `Player.stats PlayerStats?`.

- [ ] **Step 1: Write the failing test** `player-stats-schema.int-spec.ts`: create a player; insert a `PlayerStats` row with `totals: {}`; insert two `PlayerStatsDaily` rows for different days; assert the same `(playerId, day)` twice throws a unique error; assert deleting the player removes both.
- [ ] **Step 2: Run it** (`pnpm --filter api test:int -- player-stats-schema`) → FAIL (model missing).
- [ ] **Step 3: Add the models** to `schema.prisma`; run `pnpm --filter api prisma migrate dev --name player_stats`.
- [ ] **Step 4: Run it** → PASS. Run `pnpm --filter api test:int -- accounts-schema` (schema-wide guard tests) → still PASS. If the S7.1 "no TEXT column" guard covers new tables, comply (JSONB is fine).
- [ ] **Step 5: Commit** `feat(stats): PlayerStats and PlayerStatsDaily tables`.

---

### Task 2: Stat keys and the visibility table

**Files:**
- Create: `apps/api/src/stats/stat-keys.ts`, `apps/api/src/stats/visibility.ts`
- Test: `apps/api/test/unit/stats/visibility.spec.ts`

**Interfaces:**
- Produces: `STAT_KEYS` (readonly tuple of the keys below) / `type StatKey`; `RECORD_KEYS` / `type RecordKey`; `type StatDelta = Partial<Record<StatKey, number>>`; `PUBLIC_STAT_KEYS: readonly StatKey[]`; `PUBLIC_RECORD_KEYS: readonly RecordKey[]`; `publicView(totals, records): {totals, records}` keeping only public keys.

Keys (all dotted, lowercase). **Totals:**
- flying: `missions.started`, `missions.success`, `missions.failed`, `missions.aborted`, `missions.ship_lost`, `flight.distance`, `flight.legs`, `flight.seconds`, `fuel.burned`, `fuel.lost`, `rescue.called`, `adrift.times`
- combat: `fights.won`, `fights.lost`, `fights.escaped`, `fights.drawn`, `fights.pirate`, `fights.pvp`, `damage.taken`, `damage.taken_shield`, `damage.taken_armor`, `damage.taken_hull`, `damage.dealt`, `pirates.parts_stolen`
- wear: `wear.points`, `parts.failures`, `parts.destroyed`, `ships.destroyed`
- races: `races.entered`, `races.won`, `races.podium`
- field work: `scavenge.ship_runs`, `scavenge.foot_runs`, `scavenge.parts_found`, `scavenge.scrap_found`, `mining.runs`, `mining.ore`
- money in: `money.earned_missions`, `money.earned_parts`, `money.earned_materials`, `money.earned_other`
- money out: `money.spent_parts`, `money.spent_refuel`, `money.spent_repair`, `money.spent_upgrade`, `money.spent_resize`, `money.spent_rescue`, `money.spent_other`
- counts: `parts.bought`, `parts.sold`, `repairs.count`, `refuels.count`

**Records** (`{value, at, missionId?}`): `best.payout` (max), `best.run_distance` (max), `best.wallet` (max), `best.race_place` (min), `best.race_seconds` (min), `worst.run_damage` (max).

**Public:** totals `missions.started`, `missions.success`, `missions.failed`, `flight.distance`, `fights.won`, `races.entered`, `races.won`, `races.podium`, `scavenge.ship_runs`, `scavenge.foot_runs`; records `best.race_place`, `best.race_seconds`. Everything else private.

- [ ] **Step 1: Write the failing tests**: (a) `PUBLIC_STAT_KEYS` equals exactly the list above (explicit literal in the test, so adding a public key forces a test edit); (b) every public key is a member of `STAT_KEYS`; (c) `publicView({'money.earned_missions': 5, 'flight.distance': 9}, {...})` returns only `flight.distance`; (d) `STAT_KEYS` has no duplicates.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both files as `as const` tuples.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stats): stat keys and the public visibility table`.

---

### Task 3: PlayerStatsService

**Files:**
- Create: `apps/api/src/stats/player-stats.service.ts`, `apps/api/src/stats/stats.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `StatsModule`), `apps/api/src/worker.ts` module list if it enumerates modules
- Test: `apps/api/test/integration/player-stats.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `Clock` (`common/clock/clock.js`).
- Produces (exported from `StatsModule`):
  - `add(playerId: string, delta: StatDelta, tx: Prisma.TransactionClient): Promise<void>`: adds each key to the lifetime row and to today's UTC daily row, creating either. Zero and non-finite values are skipped; an empty delta does nothing.
  - `best(playerId: string, key: RecordKey, value: number, tx, meta?: { missionId?: string }): Promise<void>`: replaces the record only when better (max or min per key; a per-key direction table lives next to `RECORD_KEYS`).
  - `touch(playerId: string, tx?: Prisma.TransactionClient): Promise<void>`: sets `lastActiveAt = now`, and `firstMissionAt` when `markMission` is passed.
  - `read(playerId: string): Promise<{ totals: Partial<Record<StatKey, number>>; records: Partial<Record<RecordKey, StatRecord>>; firstMissionAt: Date|null; lastActiveAt: Date|null }>`: zeros/empty for a pilot with no row.

- [ ] **Step 1: Write failing int tests**: `add` creates both rows and sums on a second call; two concurrent `add`s of 1 on the same key give 2 (run with `Promise.all` in separate transactions); `add` inside a rolled-back transaction leaves nothing; `best` keeps the max for a max key and the min for a min key and ignores a worse value; `read` of an unknown pilot returns empties; the daily row uses the injected clock's UTC day (a fixed clock, then advance one day, assert two daily rows).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `tx.$executeRaw` doing `INSERT ... ON CONFLICT DO UPDATE SET totals = merge` where the merge adds per key; build the delta JSON in TS and merge in SQL with `jsonb_each` + `jsonb_object_agg` (union of old and new keys, summing). Records use the same conflict pattern with a conditional replace. Keep SQL in one small private method each.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stats): PlayerStatsService with atomic JSONB adds`.

---

### Task 4: Money through the wallet

**Files:**
- Modify: `apps/api/src/players/wallet.service.ts`, `apps/api/src/players/players.module.ts` (import `StatsModule`)
- Create: `apps/api/src/stats/money-category.ts`
- Test: `apps/api/test/unit/stats/money-category.spec.ts`, extend `apps/api/src/players/wallet.service.spec.ts` or an int-spec

**Interfaces:**
- Produces: `type MoneyDirection = 'in' | 'out'`; `moneyKeyOf(direction, reason: string): StatKey` mapping the **existing reason prefixes** to a key: `mission:*:payout` → `money.earned_missions`; `market.sell:` → `money.earned_parts`; `material.sell:` → `money.earned_materials`; out: `market.buy:` → `money.spent_parts`, `refuel:` → `money.spent_refuel`, `repair.start:` → `money.spent_repair`, `part.upgrade:` → `money.spent_upgrade`, bridge resize reason → `money.spent_resize`, rescue → `money.spent_rescue`; anything else `money.earned_other` / `money.spent_other`. **Read the real constants** (`MARKET_BUY_EVENT`, `REFUEL_EVENT`, `RESCUE_EVENT`, `MATERIAL_SELL_EVENT`, …) and import them rather than retyping strings.
- Wallet `credit`/`debit`/`debitAllowingNegative` call `stats.add` (and `best('best.wallet', balance)` after a credit, reading the balance in the same tx) inside their existing transaction. No signature change for callers.

- [ ] **Step 1: Failing tests**: each reason prefix above maps to its key (table-driven); unknown reasons fall to `other`; a wallet `credit` of 40 with a market-sell reason adds 40 to `money.earned_parts` and raises `best.wallet`; a rejected debit (insufficient funds) adds nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `moneyKeyOf` and the wallet calls. Mission-payout debits that are penalties (`debitAllowingNegative` from resolve) count as `money.spent_other`.
- [ ] **Step 4: Run** unit + the wallet specs + `pnpm --filter api test:int -- economy` → PASS.
- [ ] **Step 5: Commit** `feat(stats): money in and out recorded by category from the wallet`.

---

### Task 5: Run numbers at mission resolve

**Files:**
- Create: `apps/api/src/stats/run-stats.ts`
- Modify: `apps/api/src/missions/resolve.service.ts` (inside the existing transaction, right after the `mission.resolved` event), `apps/api/src/missions/missions.module.ts` (import `StatsModule`)
- Test: `apps/api/test/unit/stats/run-stats.spec.ts`, `apps/api/test/integration/mission-stats.int-spec.ts`

**Interfaces:**
- Produces: `runStatsOf(input: { type: MissionType; status: string; events: readonly MissionEvent[]; fuelBefore: number; fuelAfter: number; credited: number; shipLost: boolean; onFoot: boolean; durationSeconds: number }): { delta: StatDelta; records: { key: RecordKey; value: number }[] }`.
  - `fuel.burned = max(0, fuelBefore − fuelAfter − fuel.lost)`; `fuel.lost` = sum of `event.fuelLost`.
  - `damage.dealt` = sum of `rounds[].damage` where `attacker==='player'` and `hit`, on `combat_win|combat_loss|combat_draw|escort_absorbed`; `damage.taken*` from the same events' `cascade` (fight-closing events only, as `report.stats.ts` does; do **not** double count).
  - `wear.points` from `mission_wear` events' `condByPart` against the dispatch condition (same method as `report.stats.ts`); `parts.failures` = the six failure types.
  - races: from the `race_result` event (`place`, the player's `seconds` × `timeScale`); `races.podium` when `place <= 3`.
  - `flight.distance` = sum of `|magnitude|` of `leg_travel`; `flight.legs` = their count.
  - `scavenge.*` and `mining.ore` from `scavenge_find` / `mining` events and mission type; `onFoot` picks `scavenge.foot_runs`.
  - `missions.started`+1 always; outcome key by `status` (SUCCESS→success, ABORTED→aborted, else failed); `ships.destroyed` when `shipLost`.
  - Records: `best.payout` = `credited`, `best.run_distance`, `worst.run_damage` = damage taken total, `best.race_place`, `best.race_seconds`.
- Resolve calls `stats.add`, `stats.best` for each record, and `stats.touch(playerId, tx, { markMission: true })` once, guarded by the same claim that writes the `MissionLog`.

- [ ] **Step 1: Failing unit tests** with hand-built event arrays: a clean 2-leg delivery; a fight with `rounds` (player hits 12 + 8, enemy hit ignored → `damage.dealt` 20); a tank leak (`fuelLost` 3 with fuel 40→30 gives `fuel.burned` 7, `fuel.lost` 3); a race at place 2 gives `races.entered 1`, `races.podium 1`, no win; an on-foot scavenge with two finds; a ship-lost run.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `runStatsOf` (pure; no Prisma). Reuse the damage and wear loops' logic from `reports/report.stats.ts` by extracting shared helpers only if it is a clean move; otherwise duplicate the few lines and add a parity test that runs both on one fixture log.
- [ ] **Step 4: Failing int test** `mission-stats.int-spec.ts`: resolve a seeded mission twice (second is skipped) → stats counted once; a failed resolve rolls back stats; payout lands in `money.earned_missions` and `best.payout`.
- [ ] **Step 5: Wire resolve**; run unit + int → PASS. Also run `pnpm --filter api test:validation` (replay suite must be unaffected).
- [ ] **Step 6: Commit** `feat(stats): a resolved mission records its flight, fights, wear, races and finds`.

---

### Task 6: Counts and spend in the economy services

**Files:**
- Modify: `economy/market.service.ts` (buy/sell → `parts.bought`/`parts.sold`), `economy/repair.service.ts` (`repairs.count`), `economy/refuel.service.ts` (`refuels.count`), `economy/rescue.service.ts` (`rescue.called`), `missions/mining-job.service.ts` (`mining.runs`), `ships` code that marks a ship adrift if it is outside resolve (`adrift.times`; skip if resolve already covers it), module imports for `StatsModule`
- Test: `apps/api/test/integration/economy-stats.int-spec.ts`

**Interfaces:**
- Consumes: `PlayerStatsService.add(playerId, delta, tx)` (Task 3). Money is already handled by Task 4; these add only the **counts**.

- [ ] **Step 1: Failing int tests**: a market buy adds `parts.bought` 1 and `money.spent_parts`; a sell adds `parts.sold` 1 and `money.earned_parts`; a repair adds `repairs.count` 1 and `money.spent_repair`; a refuel adds `refuels.count` 1 and `money.spent_refuel`; a rejected purchase (not enough credits) adds none.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Add the `stats.add` calls** next to the existing `events.record` calls (same `tx`).
- [ ] **Step 4: Run** the new spec and `pnpm --filter api test:int -- economy market repair refuel rescue` → PASS.
- [ ] **Step 5: Commit** `feat(stats): purchases, repairs, refuels, rescues and mining runs are counted`.

---

### Task 7: Last active

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` (`login`, line ~88), `apps/api/src/auth/auth.module.ts` (import `StatsModule`)
- Test: extend `apps/api/test/integration/auth-flow.int-spec.ts`

**Interfaces:**
- Consumes: `PlayerStatsService.touch(playerId, tx?)`.

- [ ] **Step 1: Failing test**: after a login, `read(playerId).lastActiveAt` is set to the clock's now; a failed login (wrong password) does not touch it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `login` after the credential check. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stats): last active time is set on login`.

---

### Task 8: Callsign (placeholder ship name)

**Files:**
- Create: `apps/api/src/stats/callsign.ts`
- Test: `apps/api/test/unit/stats/callsign.spec.ts`

**Interfaces:**
- Produces: `callsignOf(input: { factionId: string | null; playerName: string; playerId: string }): string`, deterministic, short, shaped `TAG-Name-Word`: `TAG` = first 3 letters of the faction id upper-cased (`---` when none); `Name` = the pilot name trimmed to 10 characters; `Word` = one entry of `CALLSIGN_WORDS` (a 16-word list in the same file, e.g. `Wren`, `Rook`, `Ember`, `Flint`, `Drift`, `Comet`, `Spark`, `Rust`, `Gale`, `Cinder`, `Tern`, `Vesper`, `Quill`, `Atlas`, `Moth`, `Echo`) picked by a stable hash of `playerId`. Marked in a comment as a placeholder until real ship names exist.

- [ ] **Step 1: Failing tests**: same input twice → same output; different `playerId` can pick a different word; a 30-char name is cut to 10; a null faction gives `---`; output length ≤ 3+1+10+1+6.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stats): placeholder callsign for the public ship title`.

---

### Task 9: Profile API and contract

**Files:**
- Create: `apps/api/src/stats/profile.service.ts`, `apps/api/src/stats/stats.controller.ts`
- Modify: `packages/contract/src/index.ts` (schemas), regenerate `apps/web/src/api/generated` the way the repo does (check `package.json` scripts), `stats.module.ts`
- Test: `apps/api/test/integration/profile-stats.int-spec.ts`, `apps/api/test/unit/stats/profile.service.spec.ts`

**Interfaces:**
- Contract: `PublicProfileResponseSchema = { name, factionId, joinedAt, ship: { title: string, shipClass: ShipClassType, bridgeRarity: Rarity } | null, totals, records, successRate: number | null }`; `MyStatsResponseSchema = { totals, records, firstMissionAt, lastActiveAt }` (everything).
- `GET /v1/players/me/stats` (auth): `MyStatsResponse`.
- `GET /v1/players/by-name/:name/profile` (auth): `PublicProfileResponse` with `publicView()` applied; 404 `PLAYER_NOT_FOUND` for an unknown name. `shipClass` from `deriveShipClass` on the installed parts (`ships/ship-class.ts`), `bridgeRarity` from the installed BRIDGE part's catalog rarity, `title` from `callsignOf`. `successRate` = success / (success + failed + aborted), `null` when none.
- Route must not collide with `players/me/*` (name route uses the `by-name/` prefix).

- [ ] **Step 1: Failing tests**: (unit) `successRate` math incl. zero missions → null; (int) a pilot with stats fetched by another pilot gets only public keys (assert a private key like `money.earned_missions` is absent); `me/stats` includes it; an unknown name → 404; name `a%20b` and a unicode name resolve; a pilot with no stats row returns zeros and `ship` still present; unauthenticated → 401.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** controller, service, schemas. **Step 4: Run** → PASS, plus `pnpm --filter api test:int -- contract` (contract drift guard) and `test:security` (default-deny and authorization coverage lists new routes).
- [ ] **Step 5: Commit** `feat(stats): profile endpoints with a public card and a private view`.

---

### Task 10: Web profile

**Files:**
- Modify: `apps/web/src/features/profile/profile.page.tsx` (+ `profile.spec.tsx`), `apps/web/src/App.tsx` (route `/pilots/:name`), `apps/web/src/i18n/en.json`, `apps/web/src/i18n/pt-BR.json`, `apps/web/src/styles/profile.css`
- Create: `apps/web/src/features/profile/pilot-card.tsx`, `apps/web/src/features/profile/my-stats.tsx` (+ specs)

**Interfaces:**
- Consumes: the two endpoints (Task 9) through `client` and the generated types.
- `PilotCard({ profile })`: name, faction badge (`FactionBadge`), ship title with class and bridge rarity, joined date, and the public numbers (missions, success rate, distance, fights won, races, best place, fastest time as `m:ss`).
- `MyStats({ stats })`: tabs Flying / Combat / Money / Records over the private view; money as earned versus spent with the net.
- `/pilots/:name` shows `PilotCard`; the own profile page keeps what it has and adds `MyStats`.

- [ ] **Step 1: Failing Vitest specs**: the card renders each public number from a fixture; a pilot with zero missions shows "No flights yet" and no NaN; pt-BR renders the Portuguese labels; the card has no money, damage or part text; `MyStats` shows net money = earned − spent.
- [ ] **Step 2: Run** (`pnpm --filter web test -- profile`) → FAIL. **Step 3: Implement** with keys under `profile.stats.*`. **Step 4: Run** → PASS, then `pnpm --filter web exec tsc --noEmit` and `pnpm lint`.
- [ ] **Step 5: Commit** `feat(web): pilot card and personal stats`.

---

### Task 11: Smoke, docs, TODO

**Files:**
- Create: `apps/web/e2e/profile-stats.spec.ts`
- Modify: `docs/TODO.md` (move the profile-stats bullet out of "Online mechanics" as done; the ranking item now reads from `PlayerStats`), `docs/operations.md` only if a new rule is needed

- [ ] **Step 1: Write the spec**: register and launch (`registerAndLaunch`), fly the first mission (reuse the helper the other flight specs use), open the profile → missions and distance are non-zero; open `/pilots/<name>` as the same pilot → the card shows no money.
- [ ] **Step 2: Run** the smoke recipe (`reference_browser_smoke_local`; fresh DB for the race spec) → PASS.
- [ ] **Step 3: Full gate**: `pnpm --filter api test:cov`, `pnpm --filter web test`, `pnpm lint`, `pnpm --filter api test:security` → all green.
- [ ] **Step 4: Update `docs/TODO.md`**, then commit `test(e2e): profile stats smoke; docs: TODO`.
- [ ] **Step 5: Rebuild the dev stack** (`docker compose --profile dev up -d --build` including `worker`: missions resolve there) and reset the DB if the owner asks.

---

## Self-review notes

- Spec coverage: storage (T1), keys and privacy (T2, T9), writes (T3-T7), callsign decision (T8), endpoints (T9), web (T10), tests and docs (T11). Per-day slice is in T3.
- Names match across tasks: `PlayerStatsService.add/best/touch/read`, `StatDelta`, `runStatsOf`, `moneyKeyOf`, `callsignOf`, `publicView`.
- Open point left to the builder: the exact JSONB merge SQL, and whether the shared damage/wear helpers are extracted from `report.stats.ts` or duplicated with a parity test (T5 step 3).
