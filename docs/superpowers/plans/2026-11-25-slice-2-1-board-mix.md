# Slice 2.1: the board mix (four core types, races, short and long offers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every board posts the four core types (cargo = `DELIVERY`, people = `TRANSPORT`, `ESCORT`, `MINING`) when its place can, at least 2 races, one short offer and one long offer, on bigger boards, with every number an Admin knob.

**Architecture:** A pure planner (`board-composition.ts`) reads what the place can reach (per type: destination count, nearest and farthest trip in reference seconds) and the live offers, and names the next slot (types + length). `topUp` and the sim board ask it before each draft; the filler honours a length target by choosing the destination by path time, and loosens instead of failing.

**Tech Stack:** NestJS + Prisma + Postgres (`apps/api`), Jest (unit / integration), the sim (`apps/api/sim`, Node 22).

**Spec:** `docs/TODO_v0.1.5.md` item 5a; `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md` "Slice 2.1"; prior work `docs/design/board-diversity-plan.md`.

## Gap analysis (measured 2026-11-25 on the dev DB: 7 days of shared offers, boards sampled at each top-up)

| | today | owner wants |
|---|---|---|
| sizes | `board_min_by_detail` main 8 / regional 6 / local 4 (test pad 1), hard target in `topUp` | more offers, "the limit goes away" |
| core types | soft round-robin (`preferTypes` = types the board lacks) bent by the giver's weights | always, where the place can post them |
| on main ports that can post all 4 | all 4 present on **86%** of boards (ESCORT 96%, MINING 97%) | 100% |
| races | no minimum; cap `max(2, ceil(size/2))`; **21%** of those boards hold >= 2 races | >= 2 |
| short (<= 800 units = 600 s at mob 3) | random destination: **36%** of main boards have none (local 63%, regional 100%) | always one |
| long (>= 4800 units = 1 h at mob 3) | **31%** of main boards have none (local 33%) | always one ("some hours") |

Map facts (seeded map, path seconds at reference mobility 3, `duration_k` 2.25, short-trip floor 300 s):
- Inner main ports: nearest destination 120-575 units (300-431 s); farthest 10 000-11 800 units (2.1-2.5 h), only by DELIVERY/TRANSPORT (far-zone templates). ESCORT/RACE/MINING reach at most ~2 000-3 000 units (25-40 min).
- `ziggy` (regional): nearest 900 units (675 s): no destination under 600 s. Far places (`halcyon`, `thule`, `lantern`...): nearest 1 650-4 425 s.
- Races: main inner ports have 19-37 race destinations; local stops, `vesta`, `echo` and far places have exactly 1 (`race_explorers_ziggy` / one opt-in target); `drift`, `veil`, `nadir` (pirates, no quest givers) have none.
- ESCORT is not eligible at any local stop, nor at `echo`, `drift`, `veil`, `nadir`; MINING not at `echo`, `gate_depot`, `marsa_station`. Fixing that is content (new templates), **out of scope** (see Rulings).
- No hard cap exists in the web (`apps/web/src` has no slice/limit on the board) nor in the API besides the size target. New config keys need no migration (`game-config.service.ts` merges DB rows over `GAME_CONFIG_DEFAULTS`; the zod schema has `.default`); a **changed default of an existing key does** (pattern: `prisma/migrations/20261022220000_balance_round_6`).

## Rulings (made here; the owner may overturn)

1. "The limit goes away" = the size knob becomes a **floor**: `boardTarget = max(boardSize(place), required slots)`, and the defaults rise to **main 10, regional 8, local 6** (SQL migration, only where the DB still holds the old default). The schema max (20) stays; there is no other cap.
2. **Length is measured in reference seconds**: `missionDuration` at `missions.board_reference_mob` (default 3, same as `race`/`rescue.reference_mob`), `time_scale` **ignored** (1), short-trip floor applied. Short = `<= max(board_short_max_seconds, nearest)`; long = `>= min(board_long_min_seconds, farthest)`, so a place that cannot meet a threshold uses its own nearest / farthest trip. Defaults: short 600 s (= the "fast" class), long 3600 s (1 h at mob 3; the map's farthest is ~2.5 h, so 2 h would leave 1-3 destinations; raise it with slice 5c).
3. Race quota = `min(board_min_races, distinct race destinations)` (variety rule 1 forbids two races to one place).
4. A required slot ignores a giver who cannot offer its type (the offer is posted with no giver). The length target beats the giver's zone band.
5. No eviction: a full board is not reshuffled to fix its mix; gaps close as offers expire (TTL 6-40 min). Old live offers simply expire (no retro-compat).
6. ESCORT/MINING at places with no such template, and races for pirate places: content for the owner, not this slice.
7. No new player-facing string (the card already shows the duration estimate); the new knobs carry en + pt-BR admin labels.

## Global Constraints

- Commit on `develop` only; run `git branch --show-current` before every commit; never commit to `release/*`, `main`, `master`.
- NO retro-compatibility for missions: old offers expire; new rules replace them; no legacy branches or tests.
- Admin owns every tunable number: new knobs go in the config registry with en + pt-BR descriptions; DB wins over TS defaults; the seed fills only empty tables, so a changed default of an existing key needs a SQL migration.
- Every player string en + pt-BR. Code in English.
- `apps/api/src` must not import `@rustandspark/contract`.
- Sims need Node 22 (`set -a; . ../../.env; set +a` in `apps/api`); missions resolve in the `worker`: rebuild api AND worker when deploying.
- Run only the specs for touched files (unit by path; integration with the int-test stack recipe in memory `feedback_targeted_tests.md`).

## Review Focus

1. A place whose reach is tiny (one faction, one or two types, one destination): the planner must return a satisfiable slot or `{}`, `topUp` must still fill the board and never loop: unit `nextSlot` with a one-type reach (Task 2) + int `drift` fills 10 (Task 4).
2. A port with no eligible race (`drift`, `veil`): race quota 0, board still full: Task 4 int.
3. A guest/starter private offer at the same port: not counted in the mix, still created: Task 4 int.
4. Boards refreshing while offers are HELD: a held long offer leaves the board, the refill posts another long one: Task 4 int.
5. `time_scale` != 1 (dev fast ops, Admin): which offers are short/long must not change: Task 3 unit `referenceSeconds`.

---

### Task 1: Knobs, bigger sizes, migration (and the sim baseline before any change)

**Files:**
- Modify: `apps/api/src/config/game-config.defaults.ts` (~485-492), `game-config.types.ts` (key union ~152 and `missions` ~651), `game-rules.schema.ts` (~326), `config-registry.ts` (after `missions.board_min_by_detail` ~2660)
- Create: `apps/api/prisma/migrations/20261125120000_board_mix_sizes/migration.sql`
- Test: `apps/api/test/unit/config/config-registry.spec.ts` (key list ~136), `apps/api/test/unit/missions/board-size.spec.ts`, `apps/api/test/integration/board.int-spec.ts` (literals 8 at 71, 90, 94)

**Interfaces:** Produces `rules.missions.board_core_types: readonly string[]` (default `['DELIVERY','TRANSPORT','ESCORT','MINING']`), `board_min_races: number` (2, int 0-10), `board_short_max_seconds: number` (600, 60-86400), `board_long_min_seconds: number` (3600, 60-86400), `board_reference_mob: number` (3, 0.1-100); `board_min_by_detail` default `{ main: 10, regional: 8, local: 6 }`.

- [ ] **Step 0: Sim baseline on the unchanged code** (Node 22, `apps/api`): `pnpm sim export`, then `sim/run-parallel.sh board21-base sim/edits/none.json --temperament balanced --runs 8 --missions 300 --seed 1`. Expected: `all builds finished: board21-base`. Do not re-export the snapshot again in this slice (stock depends on the snapshot date).
- [ ] **Step 1: Failing tests.** Registry spec: add the 5 keys to the sorted list. `board-size.spec.ts`: `boardSize({type:'port',detail:'main'})` 10, regional 8, local 6, test pad 1; `maxOffersOfOneType(10, rules)` 5. Schema test in the registry spec already checks defaults validate and stay in bounds.
- [ ] **Step 2:** `pnpm test:unit test/unit/config/config-registry.spec.ts test/unit/missions/board-size.spec.ts` → FAIL (missing keys, 8 != 10).
- [ ] **Step 3: Implement** the defaults, types, zod (`board_core_types: z.array(z.string()).default([...])`, the others with `.default`), and 5 registry entries (group `missions`, `type: 'json'` for core types, `integer` for races, `number` for the rest). Descriptions (exact copy):
  - core types: en `Mission types every board posts at least once when its place can (cargo DELIVERY, people TRANSPORT, ESCORT, MINING).` / pt-BR `Tipos de missão que todo quadro publica ao menos uma vez quando o local permite (carga DELIVERY, pessoas TRANSPORT, ESCORT, MINING).`
  - races: en `Races every board posts, when the place has that many race destinations.` / pt-BR `Corridas que todo quadro publica, quando o local tem esse número de destinos de corrida.`
  - short: en `A trip this short (seconds at the reference ship) counts as the board's short offer; a place with none uses its nearest trip.` / pt-BR `Uma viagem até esse tempo (segundos na nave de referência) conta como a oferta curta do quadro; um local sem nenhuma usa a viagem mais próxima.`
  - long: en `A trip this long (seconds at the reference ship) counts as the board's long offer; a place with none uses its farthest trip.` / pt-BR `Uma viagem a partir desse tempo (segundos na nave de referência) conta como a oferta longa do quadro; um local sem nenhuma usa a viagem mais distante.`
  - reference mob: en `Mobility of the reference ship that measures a board offer as short or long (the game speed is ignored).` / pt-BR `Mobilidade da nave de referência que mede uma oferta do quadro como curta ou longa (a velocidade do jogo é ignorada).`
  - Update the `board_min_by_detail` comment in defaults to say it is a floor.
- [ ] **Step 4: Migration** `migration.sql`: `UPDATE "GameConfig" SET "value" = '{"main":10,"regional":8,"local":6}'::jsonb WHERE "key" = 'missions.board_min_by_detail' AND "value" = '{"main":8,"regional":6,"local":4}'::jsonb;` with a header comment (slice 2.1, an Admin edit is kept). No INSERT for the new keys (defaults merge).
- [ ] **Step 5:** update the int-spec literals 8 → 10 and the local 4 → 6 (`ceres_dock`, `tycho_slip`); grep `apps/api/test/e2e` and `apps/web/e2e` for board counts (none found today; re-check). Re-run Step 2 → PASS.
- [ ] **Step 6: Commit** `feat(missions): board mix knobs; boards hold 10/8/6 offers`.

### Task 2: The pure planner `board-composition.ts`

**Files:**
- Create: `apps/api/src/missions/board-composition.ts`
- Test: `apps/api/test/unit/missions/board-composition.spec.ts`

**Interfaces:**
- Consumes: Task 1 knobs.
- Produces:
```ts
export type LengthNeed = 'short' | 'long';
export interface TypeReach { readonly destinations: number; readonly nearestSeconds: number; readonly farthestSeconds: number }
export type BoardReach = ReadonlyMap<MissionType, TypeReach>;
export interface LiveOffer { readonly type: MissionType; readonly seconds: number }
export interface LengthBounds { readonly shortMax: number; readonly longMin: number }
export interface BoardSlot { readonly types?: ReadonlySet<MissionType>; readonly length?: LengthNeed }
export function lengthBounds(reach: BoardReach, rules: GameRules): LengthBounds | null;
export function requiredTypes(reach: BoardReach, rules: GameRules): MissionType[];
export function boardTarget(baseSize: number, reach: BoardReach, rules: GameRules): number;
export function nextSlot(input: { readonly reach: BoardReach; readonly live: readonly LiveOffer[]; readonly capped: ReadonlySet<MissionType>; readonly rules: GameRules }): BoardSlot;
```
`MissionType` from `@prisma/client`. Rules: `lengthBounds` = `{ shortMax: max(board_short_max_seconds, min nearest), longMin: min(board_long_min_seconds, max farthest) }`, null on empty reach. `requiredTypes` = `board_core_types` that are keys of `reach` (unknown strings, `TRAVEL`, `SCAVENGE` dropped), in that order, then `RACE` repeated `min(board_min_races, reach.RACE.destinations)` times. `boardTarget` = `max(baseSize, requiredTypes.length)`. `nextSlot` algorithm:
1. Missing required = `requiredTypes` minus live counts (multiset, in order). Needs = `long` if no live `seconds >= longMin`, `short` if no live `seconds <= shortMax`.
2. If a required type is missing: pick the first missing type that can serve a need (`long`: `farthestSeconds >= longMin`, checked before `short`: `nearestSeconds <= shortMax`), else the first missing; return `{ types: {T}, length? }`.
3. Else if a need is open (long first): `types` = reach keys not in `capped` that can serve it (all reach keys if none); return `{ types, length }`.
4. Else: reach keys absent from live and not capped; return `{ types }` when non-empty and smaller than the reach, else `{}`.

- [ ] **Step 1: Failing tests** (fixture reach for a main port: DELIVERY {37, 300, 8400}, TRANSPORT {39, 300, 8400}, ESCORT {36, 300, 1900}, MINING {18, 300, 1900}, RACE {37, 300, 1900}, RESCUE {36, 600, 3900}):
  - `an empty main-port board asks for DELIVERY long first, then TRANSPORT short` → `nextSlot({live:[]})` equals `{types:{DELIVERY},length:'long'}`; with live `[{DELIVERY,8400}]` → `{types:{TRANSPORT},length:'short'}`.
  - `asks for two races when the place has two race destinations, one when it has one, none when it has none` → `requiredTypes` ends with `RACE,RACE` / `RACE` / no RACE.
  - `with every required type live but nothing long, asks for long among the types that reach it, never a capped one` → `{types:{DELIVERY,TRANSPORT},length:'long'}`; with `capped={DELIVERY}` → `{types:{TRANSPORT},...}`.
  - `a place with no trip under the threshold counts its nearest as short` → reach nearest 675 → `lengthBounds().shortMax` 675; long side: farthest 1900 → `longMin` 1900.
  - `core types the place cannot post are skipped` (reach without ESCORT → required DELIVERY, TRANSPORT, MINING, RACE).
  - `an edited board_core_types with TRAVEL or an unknown name ignores them`.
  - `a full mix asks only for types the board lacks; returns {} when nothing is missing`.
  - `boardTarget grows above the base when the required slots do not fit, never shrinks` (`boardTarget(4, mainReach)` 6, `boardTarget(10, mainReach)` 10).
  - `a one-type reach with one destination still returns a slot it can serve` (reach `{DELIVERY:{1,450,450}}` → first `{types:{DELIVERY},length:'long'}`, then `{}`); `empty reach → lengthBounds null, nextSlot {}`.
- [ ] **Step 2:** `pnpm test:unit test/unit/missions/board-composition.spec.ts` → FAIL (module not found).
- [ ] **Step 3:** implement as specified (pure, no I/O, no imports outside `@prisma/client` types and `GameRules`).
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5: Commit** `feat(missions): board composition planner (core types, races, short and long)`.

### Task 3: The filler measures reach and honours a length target

**Files:**
- Modify: `apps/api/src/missions/generator/template.filler.ts` (`FillMissionInput` ~105; destination choice ~542-581)
- Test: `apps/api/test/unit/missions/template.filler.spec.ts`

**Interfaces:**
- Consumes: `BoardReach`, `TypeReach` (Task 2); knobs (Task 1).
- Produces:
```ts
export function referenceSeconds(totalDistance: number, rules: GameRules): number; // missionDuration at board_reference_mob, timeScale 1, the short-trip floor/exempt knobs
export function reachByType(origin: FillerLocation, world: FillerWorld, rules: GameRules): BoardReach; // per eligible type (non-starter rules): distinct reachable destinations, nearest/farthest referenceSeconds of the path (RESCUE: doubled, out and back)
// FillMissionInput gains:
readonly lengthTarget?: { readonly maxSeconds?: number; readonly minSeconds?: number };
```
Destination choice with `lengthTarget` (non-starter only): first of `banded ∩ fits`, `reachable ∩ fits`, `banded`, `reachable` that is non-empty (`fits` = the destination's `referenceSeconds` of its path, doubled for RESCUE, within the target); then the existing random pick. No target = today's behaviour, byte for byte (seeded drafts unchanged).

- [ ] **Step 1: Failing tests** (own small world: origin `o`, `near` 200 units, `mid` 2000, `far` 6000, one DELIVERY template; reference mob 3):
  - `referenceSeconds ignores time_scale and applies the short-trip floor` → `referenceSeconds(200, rules)` 300, `referenceSeconds(6000, rules)` 4500, same with `time_scale: 10`.
  - `reachByType counts destinations and nearest/farthest seconds per type; rescue doubles the path` → DELIVERY `{3, 300, 4500}`; RESCUE nearest 300 (400 units → 300 floor? use 2x200=400 → 300), farthest 9000.
  - `with lengthTarget.maxSeconds only short destinations are drawn` → over 30 seeds `destinationId` always `near`.
  - `with lengthTarget.minSeconds only long destinations are drawn` → always `far`.
  - `a length target no destination fits falls back to any destination, never throws` (`minSeconds: 99999`).
  - `the length target beats the giver's zone band` (giver maxZone 0, `far` in zone 2, min target → `far`).
  - `no lengthTarget: the same seed gives the same draft as before` (snapshot of one draft's `destinationId`/`reward` from the existing fixture).
- [ ] **Step 2:** `pnpm test:unit test/unit/missions/template.filler.spec.ts` → the new tests FAIL.
- [ ] **Step 3:** implement (`reachByType` reuses `eligibleTemplates`, `matchesDestination`, `shortestPath`; one Dijkstra per destination is fine at 30 places, but compute path lengths once per origin).
- [ ] **Step 4:** same command → PASS (old tests unchanged).
- [ ] **Step 5: Commit** `feat(missions): the filler measures a place's reach and picks a destination by trip length`.

### Task 4: `topUp` posts the mix (integration on the seeded map)

**Files:**
- Modify: `apps/api/src/missions/board.service.ts` (`topUp` ~290-425; `countOffers` keeps `boardSize` for its cheap pre-check)
- Test: `apps/api/test/integration/board.int-spec.ts`

**Interfaces:** Consumes `reachByType`, `referenceSeconds` (Task 3), `boardTarget`, `nextSlot`, `lengthBounds` (Task 2).

Wiring: test pads keep `boardSize` 1 and today's path. Otherwise `reach = reachByType(location, worldTables, rules)`; `boardMin = boardTarget(boardSize(place), reach, rules)`; `live` gains `seconds` (from the row's `legs` distances via `referenceSeconds`); per draft: `capped` = types at `maxOffersOfOneType(boardMin)`; `slot = nextSlot(...)`; `pickGiver({... wantTypes: slot.types})`, drop the giver when `slot.types` is set and `!offersAnyOf(giver, slot.types)`; `fillMission({... preferTypes: slot.types, avoidTypes: capped, lengthTarget: slot.length === 'short' ? {maxSeconds: bounds.shortMax} : slot.length === 'long' ? {minSeconds: bounds.longMin} : undefined})`. The old `missingTypes` round-robin is replaced by the planner (step 4 of `nextSlot`). The strictness ladder, seed-collision skip and `MissionGenerationError` break stay.

- [ ] **Step 1: Failing tests:**
  - `every inner main port posts the four core types, two races, a short and a long offer, over 25 refreshes` (`ceres`, `tycho`, `gate`, `hedus`, `marsa`, `rennick`, `cair`; expire all between rounds as the existing mix test does): per board `rows.length` 10; types ⊇ DELIVERY, TRANSPORT, ESCORT, MINING; RACE count >= 2; some row with path distance <= 800 and some >= 4800.
  - `a local stop holds what it can: delivery, transport, mining, its one race, a short and a long offer` (`ceres_dock`, 6 rows).
  - `ziggy has no trip under 10 minutes and still posts its nearest destination as the short one` (min distance on the board == 900).
  - `drift (pirates, no givers, no race) still fills its board` (10 rows, no RACE, DELIVERY and TRANSPORT present).
  - `a held long offer leaves the board and the refill posts another long one` (set the only >= 4800 row to `HELD`, read, a new >= 4800 AVAILABLE row exists).
  - `a private starter offer does not count toward the mix` (create one via `createStarterOffer` at `ceres` for a seeded player, then the shared rows alone hold a short offer).
  - Keep: same type + destination never twice; at most half the board of one type; test pad 1.
- [ ] **Step 2:** int stack up (memory recipe), `pnpm test:int test/integration/board.int-spec.ts` → new tests FAIL.
- [ ] **Step 3:** implement the wiring.
- [ ] **Step 4:** same command → PASS; also `pnpm test:int test/integration/starter-mission.int-spec.ts test/integration/world.int-spec.ts` (board sizes touched) → PASS.
- [ ] **Step 5: Commit** `feat(missions): boards always post the core types, two races, a short and a long offer`.

### Task 5: The sim board mirrors it; income per hour does not regress; docs

**Files:**
- Modify: `apps/api/sim/core/world.ts` (`boardAt` ~388-480)
- Create: `apps/api/sim/edits/board-21.json` (`{ "rules": { "missions": { "board_min_by_detail": { "main": 10, "regional": 8, "local": 6 } } } }`: the snapshot from Task 1 still carries the old sizes)
- Modify: `docs/TODO_v0.1.5.md` (5a status), `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md` (slice 2.1 built)

**Interfaces:** Consumes the same functions as Task 4 (the sim already imports `src/missions`).

- [ ] **Step 1:** wire `boardAt` exactly as `topUp` (same planner call, giver drop, `lengthTarget`); keep its comment "Same sizes and rules as `board.service.ts → topUp`".
- [ ] **Step 2:** `pnpm exec tsc --noEmit -p .` and `pnpm test:unit test/unit/missions` → PASS.
- [ ] **Step 3: Sim** (Node 22): `sim/run-parallel.sh board21-new sim/edits/board-21.json --temperament balanced --runs 8 --missions 300 --seed 1`.
- [ ] **Step 4: Compare** `python3 sim/compare.py base=board21-base-% new=board21-new-%` and `python3 sim/levels.py "base=board21-base-%-edit" "new=board21-new-%-edit"`, plus net credits per game hour per build: `select cell, 3600.0*avg(reward+fuel+repair)/avg(total_seconds) from runs where experiment_id in (<ids>) group by cell` on `sim-data/sim.db`. Pass: for every build, net credits/hour >= 95% of base and L2day/L3day no more than 10% later, no new stalls. If it fails, stop and report the numbers (a balance round is the owner's call); do not tune silently.
- [ ] **Step 5:** docs: 5a status line (built, the measured before/after shares from Task 4's numbers and the sim result, the deploy note: run migration `20261125120000_board_mix_sizes`, rebuild api AND worker, new knobs `missions.board_core_types`, `board_min_races`, `board_short_max_seconds`, `board_long_min_seconds`, `board_reference_mob`; the open content decision from Ruling 6).
- [ ] **Step 6: Commit** `feat(sim): the sim board posts the same mix; docs: slice 2.1 built`.
