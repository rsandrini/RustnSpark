# Slice 2.2: route fuel planning and manual refuel stops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Ordering (owner, 2026-11-25): this is the LAST slice of v0.1.5.** More change requests from testing come first; pick this up only when the roadmap says it is next.

**Goal:** Before flying, the pilot sees along the route how far the fuel lasts (leg colours, fuel at each place, where it runs dry, the last place that sells fuel before that, today's price there) and may plan stops at places that sell fuel; at a stop the ship docks, the pilot does what they need there by hand (refuel, repair, shop) and presses "Continue the trip".

**Architecture:** One server source of truth: a pure module `apps/api/src/missions/route-fuel.ts` (fuel along a path, suggested stops, reach by fuel burn, stop validation, segment split) behind `POST /v1/ships/:id/route-plan` and `GET /v1/ships/:id/reach`; one rule for "sells fuel" (`apps/api/src/economy/sells-fuel.ts`, every place sells fuel except the place types on an Admin list) used by the refuel service, the escort rule and the planner. A mission with stops flies as segments: each segment is an ordinary delayed resolve job; between segments the mission is `AT_STOP` and the ship is `IN_PORT` at the stop; the resolver runs a leg range and carries the run's state to the next segment, paying only at the last one.

**Tech Stack:** NestJS + Prisma + Postgres (`apps/api`, Jest unit/integration), React + TanStack Query + Vitest (`apps/web`), zod (`packages/contract`), the sim (`apps/api/sim`, Node 22).

**Spec:** owner words 2026-11-25 (route planning, colours, "the amount estimated until the last port before run dry", "the user can define if will stop on that port or soon", "the last price known"); owner rulings 2026-11-25 (below); `docs/TODO_v0.1.5.md` 5c, 5d; roadmap `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md` slice 2.2; card fuel design `docs/design/mission-fuel-display-plan.md`.

## Gap analysis (read 2026-11-25 on develop and the dev DB)

| | today | wanted |
|---|---|---|
| refuel on the way | none: `dispatch.service.ts:484-503` refuses `FUEL_INSUFFICIENT` when the whole route burns more than is aboard; the resolver goes `adrift` on the leg that runs dry (`leg.resolver.ts:365`) | planned manual stops at places that sell fuel |
| who sells fuel | `RefuelService` sells at ANY place (`assertRefuelable` checks only `IN_PORT`); the escort rule (`escort.service.ts:265`) says a place sells none when `services.refuel === false`, which no seeded place sets (24 place types; `refuel: true` only on local stops / far stations) | ONE rule (owner 2026-11-26): every place sells fuel as today, except the types on an Admin list `economy.no_fuel_place_types` (default EMPTY); the map shows the listed places as no fuel |
| route fuel on screen | card: total burn vs aboard vs tank (`fuel-block.tsx`, `fuel-status.ts`); map range halo = Dijkstra on raw **distance** × fuel share (`features/map/reach.ts`), ignoring the route's `env.fuelMult` (debris 1.1, gravitational 1.5) | per-leg fuel, dry point, last fuel place, stops, from server numbers |
| price | deterministic: `fuel_price × isolation × faction_mult[relation]` (`refuel-cost`, `pricing.service.ts:35`), no mood, no stock; the quote already returns `unitPrice` | show today's price per place as is (no estimates) |
| mission timing | one delayed job at `arrivalAt` resolves every leg; presence windows pro-rata by distance; `deadlineAt` exists only for RESCUE and only gates the START (`dispatch.service.ts:268`); nothing expires once flying; race times are simulated per leg (`race.resolver.ts:250`), not wall clock | stop time is real time added to the mission |
| statuses | `MissionStatus` has no between-legs state; `ShipStatus` `IN_PORT/ON_MISSION/ADRIFT` | `AT_STOP` (mission) + `IN_PORT` at the stop (ship) |

Map today (35 routes, 30-3400 units, avg 985; tanks 300-2640, median 1050; `fuelUse` 7-60 per 100): a long route fits one tank for most ships, so stops matter little until the next version's 5x map. This slice builds the mechanic so it scales; it adds NO zones or places.

## Rulings (owner, 2026-11-25; the ones marked "made here" may be overturned)

1. Scope: route planning + manual stops on today's map only. Far zones / hours-long crossings are the next version's 5x map (5c stays open for it). This slice is the last of v0.1.5.
2. **Owner, 2026-11-26: "All places except in the border, or what is easy to implement. If its easy to add fuel to all places now lets keep that way."** Every place sells fuel (as today). ONE source of truth: `sellsFuel(type, rules)` = `!rules.economy.no_fuel_place_types.includes(type)`; the Admin knob `economy.no_fuel_place_types` is a list of place types that do NOT sell fuel, DEFAULT EMPTY (the owner may later list the border/edge types, e.g. frontier ones, from Admin). The escort rule, the refuel service and the route planner use the SAME list. The 'No fuel here' mark on the map/route shows only for listed types. The `services.refuel` flag is removed (migration + seed) only so nothing else decides it (the escort rule reads it today; no seeded place sets it false). A docked refuel at a listed place answers `FUEL_NOT_SOLD_HERE`.
3. A stop is MANUAL: the ship docks at the stop (`IN_PORT` there, mission `AT_STOP`), nothing is bought or charged automatically; the pilot uses the place (refuel, repair, market, upgrade, as its services allow) and presses "Continue the trip" (`POST /v1/missions/:id/continue`), optionally with a new list of stops for the rest of the route. Stops are allowed only at interior places of the route that sell fuel (not the origin, not the destination, no repeats).
4. Timing (from the code): the mission's flight time is computed once for the whole route (`missionDuration` on the total distance, as today) and split pro-rata by distance into segments, so stops never add short-trip floors; each segment's timer starts when it departs; the time docked is real time added to the mission (no pause, no expiry: nothing expires once a mission is dispatched). RACE: the seconds docked are added to the pilot's race time (`dockedSeconds / time_scale`, race times are before the scale). RESCUE: its `deadlineAt` only gates the start, so nothing changes after departure. The plan summary warns (never blocks) when stops are planned on a RACE or RESCUE contract.
5. Prices: exactly today's pricing, unchanged. The route plan shows each place's unit price as the refuel quote computes it now (`refuelCost(1, isolation, relation, rules)`); it is deterministic per place and player faction, so there is no "last known" store and no estimate. Fill cost shown = `max(1, round(units × unitPrice))`, the quote's rounding.
6. Amber: a leg ends "low" when the fuel left after it is below `missions.route_fuel_low_share` (default 0.2) of the tank; "dry" when it runs out on that leg. Admin knob.
7. Planning lives on the map (route layer + place sheet + stop toggles); the contract card gets one fuel-plan line; the existing red fuel chip shows only when no stop plan can fly the route (a segment between fuel places longer than the tank).
8. Fallback: a pilot at a stop who cannot pay to continue is the existing stranded/escort path (`escort-stuck.ts` already covers "empty tank, cannot pay"). **Made here:** calling the escort or abandoning at a stop ends the mission as FAILED (no pay; delivery cargo forfeited, as for adrift).
9. No retro-compat: missions in flight at deploy finish as one segment; no legacy branches. Dispatch/travel without `stops` behave as today.
10. **Made here:** no automatic suggestion is applied: the web pre-selects the server's suggested stops in the planner, the pilot sees and can change them, and the request carries the final list.

## Global Constraints

- Commit on `develop` only; run `git branch --show-current` before every commit; never commit to `release/*`, `main`, `master`.
- No retro-compatibility for missions/trips in flight; no legacy branches or tests.
- Admin owns every number: new keys in the config registry with en + pt-BR descriptions; DB wins over TS defaults; new keys need no migration, a changed default does.
- Every player string en + pt-BR; `src/i18n/keys.spec.ts` needs literal `t('...')` keys. New error codes get en + pt-BR in the web `errors` block.
- `apps/api/src` must not import `@rustandspark/contract`; contract shapes are checked in `test/integration/contract.int-spec.ts`.
- Code in English. Web verified by unit tests only (owner reviews visually later).
- Missions resolve in the `worker`: deploy = migrations + rebuild api AND worker; re-export the sim snapshot.
- Run only the specs of touched files (memory `feedback_targeted_tests.md`); run `test:e2e` before push (default-change literals).
- Scale (next version: 5x map, 8+ hour missions): every path computation is a Dijkstra or a single pass over the path (no per-pair tables); route-plan and reach are per request (cache by `(shipId, fuel, location, rulesHash)` only if measured slow); `shortestPath` scans linearly today: swap in a binary heap when the map passes ~500 places. UI: the route layer labels only fuel places, the dry point and stops (never every node); the stop list in the sheet scrolls; the card keeps ONE line whatever the stop count.

## Review Focus

1. Ion ship / `fuelUse` 0: plan `unlimited`, no stops suggested, stops in a request ignored, no chip, no line on the card. Test: Task 2 `planRouteFuel` unlimited; Task 6 card.
2. A route through places listed as no-fuel (the default list is empty, so the test lists a type, e.g. `dead_zone`) longer than the tank: infeasible, red chip, dispatch refuses `FUEL_INSUFFICIENT`; a stop requested at such a place answers `ROUTE_STOP_INVALID`. Test: Task 2 `validateStops`, Task 5 int.
3. Plan made, then the fuel changes (refuel, a docked leak, a repair): the server re-plans at dispatch and at continue from live fuel; the web query key holds `ship.fuel`. Test: Task 5 int "continue after refuelling at the stop flies the next segment".
4. Pilot at a stop with an empty tank and no credits: not stranded in a broken state: escort-stuck says stuck, the escort ends the mission FAILED, the ship is towed as today. Test: Task 5 int.
5. Stop at the origin or the destination, duplicate stops, a stop not on the path: `ROUTE_STOP_INVALID`. Test: Task 2.
6. `time_scale` != 1 and debug fast ops: segments split the scaled total pro-rata (sum equals the no-stop duration); race docked seconds are divided by `time_scale`. Test: Task 2 `segmentSeconds`, Task 4 race.
7. Tank smaller than one segment: `feasible: false`, `maxSegmentBurn > fuelCap`. Test: Task 2.
8. A segment that goes adrift or fails: the mission ends as today (FAILED, log written with every leg flown so far), never `AT_STOP`. Test: Task 4 + Task 5 int.

---

### Task 1: One rule for "sells fuel" (refuel service, escort, seed) and the two knobs (`economy.no_fuel_place_types`, default empty)

**Files:**
- Create: `apps/api/src/economy/sells-fuel.ts`; `apps/api/prisma/migrations/20261126120000_route_fuel_stops/migration.sql` (this task writes only its services part; Task 5 appends)
- Modify: `apps/api/src/economy/refuel.service.ts` (`assertRefuelable` callers: `refuel`, `quote`), `apps/api/src/economy/escort.service.ts:262-267`, `apps/api/src/economy/escort-stuck.ts` (doc of `sellsFuel`), config `game-config.defaults.ts` (economy ~119, missions ~478), `game-config.types.ts` (key union + interfaces), `game-rules.schema.ts`, `config-registry.ts`; seed `prisma/seed-data/map-extension.ts:16-40` (drop `refuel` keys)
- Test: `apps/api/test/unit/economy/sells-fuel.spec.ts`, `apps/api/test/unit/config/config-registry.spec.ts`, `apps/api/test/integration/refuel.int-spec.ts`; web `apps/web/src/i18n/en.json`, `pt-BR.json` (`errors.FUEL_NOT_SOLD_HERE`)

**Interfaces:**
- Produces: `sellsFuel(placeType: string, rules: GameRules): boolean`; `rules.economy.no_fuel_place_types: string[]` (default `[]`, Ruling 2); `rules.missions.route_fuel_low_share: number` (0.2, 0-1); error `FUEL_NOT_SOLD_HERE` (409).

- [ ] **Step 1: Failing tests.** `sells-fuel.spec.ts`: with the default `[]` every type sells (`'port'`, `'far_station'`, `'dead_zone'`, `'test_pad'`, `'unknown_type'` all true); with `no_fuel_place_types: ['dead_zone','frontier']` those two are false and `'port'` true. Registry spec: the 2 new keys in the sorted key list. `refuel.int-spec.ts`: "refuses at a place whose type is on the no-fuel list" (the test sets `economy.no_fuel_place_types` to include the type of `drift`, ship docked there, `POST /v1/ships/:id/refuel` and `/refuel/quote` -> 409 `{ error: 'FUEL_NOT_SOLD_HERE' }`, wallet unchanged); "refuels at ceres and at `drift` with the default empty list".
- [ ] **Step 2:** `pnpm test:unit test/unit/economy/sells-fuel.spec.ts test/unit/config/config-registry.spec.ts` -> FAIL.
- [ ] **Step 3: Implement.** Knobs: `economy.no_fuel_place_types` (group `economy`, `type: 'json'`, default `[]`; en "Place types that do NOT sell fuel (empty: every place sells it). A docked refuel, the escort rule and route stops all read this list." / pt-BR "Tipos de lugar que NÃO vendem combustível (vazio: todo lugar vende). O reabastecimento atracado, a regra da escolta e as paradas de rota leem esta lista."), `missions.route_fuel_low_share` (`number`, 0-1, unit `×`; en "A route leg is shown as low on fuel when the fuel left after it is below this share of the tank." / pt-BR "Um trecho da rota aparece com pouco combustível quando o que sobra depois dele fica abaixo desta fração do tanque."). `RefuelService`: after `assertRefuelable`, load the location type and throw `ConflictException({ error: 'FUEL_NOT_SOLD_HERE' })` when `!sellsFuel` (never with the default empty list). Escort: `sellsFuel = sellsFuel(market.location.type, rules)`.
- [ ] **Step 4: Migration** (kept only to make ONE source of truth: the list replaces the flag; the default list changes no behaviour; header: slice 2.2): `UPDATE "Location" SET "services" = "services" - 'refuel' WHERE "services" ? 'refuel';`. Seed constants lose `refuel`.
- [ ] **Step 5:** run the unit specs + `refuel.int-spec.ts` + `test/unit/economy/escort-stuck.spec.ts` -> PASS. Grep web/e2e for places refuelled in fixtures: with the default empty list nothing changes, so the prologue sandbox needs no change. Commit `feat(fuel): one rule for places that sell fuel (every place, Admin list of exceptions)`.

### Task 2: The pure route-fuel module and the contract shapes

**Files:**
- Create: `apps/api/src/missions/route-fuel.ts`, `apps/api/test/unit/missions/route-fuel.spec.ts`
- Modify: `packages/contract/src/index.ts` (after `TravelQuoteSchema` ~1607; `MissionStatus` enum ~781 area; active-mission schema ~1022)

**Interfaces:**
- Consumes: `fuelUnits` (`economy/fuel-cost.calculator.ts`), `sellsFuel` (Task 1).
- Produces (all pure, no I/O):
  ```ts
  export interface RouteNodeInput { id: string; sellsFuel: boolean; unitPrice: number | null }
  export interface RouteLegInput { routeId: string; distance: number; fuelMult: number }
  export interface RouteFuelInput {
    nodes: readonly RouteNodeInput[];      // legs.length + 1, origin first
    legs: readonly RouteLegInput[];
    fuelUse: number; fuel: number; fuelCap: number;
    extraAtEnd: number;                    // dig fuel of a mining run, burned at the destination
    stops: readonly string[] | 'suggest';  // node ids; at a stop the plan assumes a full tank
    lowShare: number;
  }
  export type LegTone = 'ok' | 'low' | 'dry';
  export interface RouteFuelPlan {
    unlimited: boolean;
    legs: { routeId: string; fromId: string; toId: string; burn: number; fuelStart: number; fuelEnd: number; tone: LegTone }[];
    nodes: { id: string; sellsFuel: boolean; unitPrice: number | null; fuelArrive: number; fuelLeave: number; stop: { fillUnits: number; fillCost: number } | null }[];
    dry: { legIndex: number; share: number } | null;   // first point it runs dry with these stops
    lastFuelBeforeDry: string | null;                   // last node selling fuel reached before `dry`
    stops: string[];                                    // the stops used (suggested or given)
    feasible: boolean;      // some stop list flies it starting from a full tank at the origin
    feasibleNow: boolean;   // these stops fly it from the fuel aboard now
    maxSegmentBurn: number; // largest burn between two fuel places (or ends), incl. extraAtEnd on the last
    missingAtOrigin: number;// units to buy at the origin before the first segment fits (0 when it does)
  }
  export function planRouteFuel(input: RouteFuelInput): RouteFuelPlan;
  export function suggestStops(input: Omit<RouteFuelInput, 'stops' | 'lowShare'>): string[];
  export type StopsCheck = { ok: true } | { ok: false; reason: 'NOT_ON_PATH' | 'ORIGIN' | 'DESTINATION' | 'DUPLICATE' | 'NO_FUEL' | 'ORDER' };
  export function validateStops(pathNodeIds: readonly string[], stops: readonly string[], sells: (id: string) => boolean): StopsCheck;
  export function segmentsOf(pathNodeIds: readonly string[], stops: readonly string[]): { fromLeg: number; toLeg: number }[];
  export function segmentSeconds(totalSeconds: number, distances: readonly number[], segment: { fromLeg: number; toLeg: number }): number;
  export function reachByFuel(routes: readonly { nodeAId: string; nodeBId: string; distance: number; fuelMult: number }[], originId: string, fuelUse: number, fuel: number): Map<string, number>; // place -> cheapest burn <= fuel
  ```
- Contract: `RoutePlanSchema` (the `RouteFuelPlan` shape + `warnings: z.array(z.enum(['TIMED_CONTRACT']))` + `blockers: z.array(TravelBlockerSchema)`), `ReachSchema` (`{ unlimited: boolean; fuel: number; places: { id: string; fuelNeeded: number }[] }`), `'AT_STOP'` in the mission status enum, `journey: { stops: string[]; atStopId: string | null; segment: number; segments: number }.nullable()` on the active mission.

- [ ] **Step 1: Failing tests** (`route-fuel.spec.ts`, a 4-node line A-B-C-D, legs 1000/1000/1000, `fuelUse` 10, mult 1 so each leg burns 100; B sells fuel, C does not):
  - `planRouteFuel unlimited when fuelUse is 0`: `{ unlimited: true, stops: [], feasible: true, feasibleNow: true, dry: null }`.
  - `fuel 300 cap 300 no stops`: fuel ends 200/100/0, tones `['ok','ok','low']` (0 is below 0.2×300 but not dry), `feasibleNow` true, `dry` null.
  - `fuel 250 cap 300, stops []`: `dry` `{ legIndex: 2, share: 0.5 }`, `lastFuelBeforeDry` `'B'`, `feasibleNow` false; `'suggest'` gives `stops ['B']`, fuel leaving B 300, `feasibleNow` true, `nodes[1].stop.fillUnits` 150 (250-100 arrives 150), `fillCost` `max(1, round(150 × unitPrice))`.
  - `cap 150`: B splits A-B (100) and B-D (200): `maxSegmentBurn` 200, `feasible` false; `suggest` still returns `['B']`.
  - `extraAtEnd 50` adds to the last segment's burn and to `missingAtOrigin` when there are no fuel places.
  - `env multiplier`: leg mult 1.5 burns `fuelUnits({fuelUse:10, distance:1000, envFuelMult:1.5})` = 150.
  - `validateStops`: `['A']` ORIGIN, `['D']` DESTINATION, `['C']` NO_FUEL, `['B','B']` DUPLICATE, `['X']` NOT_ON_PATH, ok for `['B']`.
  - `segmentsOf(['A','B','C','D'], ['B'])` = `[{fromLeg:0,toLeg:0},{fromLeg:1,toLeg:2}]`; `segmentSeconds(900, [1000,1000,1000], {fromLeg:1,toLeg:2})` = 600; the sum over segments equals the total.
  - `reachByFuel`: weights are `fuelUnits` with the route mult; a place behind a 1.5 route is cheaper via a longer 1.0 path when that burns less.
- [ ] **Step 2:** `pnpm test:unit test/unit/missions/route-fuel.spec.ts` -> FAIL.
- [ ] **Step 3: Implement.** `suggestStops`: greedy farthest reach (fly from the current fuel; when the next fuel place cannot be reached with the fuel left after the current one, stop at the current one; at a stop assume a full tank). `feasible` = `maxSegmentBurn <= fuelCap` where segments split at every interior node that sells fuel. Burns use `fuelUnits` per leg exactly as dispatch does. Contract schemas as listed (`pnpm --filter @rustandspark/contract build` clean).
- [ ] **Step 4:** run the spec -> PASS; `pnpm -r tsc --noEmit` clean. Commit `feat(route-fuel): fuel along a route, suggested stops, reach by burn`.

### Task 3: Server plan, reach and the offer's fuel plan

**Files:**
- Create: `apps/api/src/missions/route-plan.service.ts`, `apps/api/src/missions/route-plan.controller.ts`, `apps/api/src/missions/dto/route-plan.dto.ts`
- Modify: `missions.module.ts`; `missions.service.ts:941-1058` (offer estimate + `FUEL_CAPACITY` row); `travel.service.ts` (`TravelQuote` gains `fuelPlan`); `apps/api/src/missions/requirements.checker.ts:145` (doc only)
- Test: `apps/api/test/integration/route-plan.int-spec.ts`, `contract.int-spec.ts` (parse `RoutePlanSchema`, `ReachSchema`, offers)

**Interfaces:**
- Consumes: Task 2 functions; `PricingService.contextForLocation`, `refuelCost`; the tuned flight sheet exactly as `engine-preview.service.ts:85-122` builds it (extract `tunedFlightSheet(ship, rows, rules)` there and reuse; dispatch keeps its own).
- Produces: `POST /v1/ships/:id/route-plan` body `{ missionId?: string; destinationId?: string; stops?: string[] }` (exactly one of mission/destination; from the mission: its legs from the ship's current place if `AT_STOP`, else from the origin) -> `RoutePlan`; `GET /v1/ships/:id/reach` -> `Reach` (`unlimited` for `fuelUse` 0; 404 for another player's ship via `OwnershipGuard`); offer `info.estimate.fuelPlan: { stops: number; stopsCost: number; feasible: boolean; feasibleNow: boolean; warnTimed: boolean } | null` (null for ion ships); travel quote `fuelPlan` (same shape). `RouteFuelService.planFor(playerId, shipId, path, stops)` used by Task 5.

- [ ] **Step 1: Failing int tests** (`route-plan.int-spec.ts`, seeded map): "plans a trip to a far place with the route mult in the burn" (fuel values equal `fuelUnits` sums of the mission legs); "suggests a stop when the tank is short and a fuel place is on the path"; "unit price equals the refuel quote's unitPrice at that place"; "a place whose type is on the no-fuel list has unitPrice null and cannot be a stop" (the test lists the type of `drift`; `stops:['drift']` -> 400 `ROUTE_STOP_INVALID`, `reason: 'NO_FUEL'`); "ion ship is unlimited"; "warns TIMED_CONTRACT for a RACE with stops"; "reach lists places by fuel burn, not distance". Contract spec parses both responses and a board offer with `fuelPlan`.
- [ ] **Step 2:** run them (int-test stack recipe) -> FAIL.
- [ ] **Step 3: Implement.** Unit prices: one `contextForLocation` per fuel place on the path (`refuelCost(1, ...)`). Offer: replace the `estimate.fuelNeeded > sheet.fuelCap` condition with `fuelPlan.feasible === false` for the `FUEL_CAPACITY` row (the row's `needed` becomes `maxSegmentBurn`). Error text: `errors.ROUTE_STOP_INVALID` en "That place cannot be a stop on this route: pick a place on the way that sells fuel." / pt-BR "Esse lugar não pode ser uma parada nesta rota: escolha um lugar no caminho que venda combustível."
- [ ] **Step 4:** int + contract specs PASS; `test/unit/missions/requirements.checker.spec.ts` PASS. Commit `feat(route-fuel): route plan and reach endpoints, the offer's fuel plan`.

### Task 4: The resolver runs a leg range and carries the run

**Files:**
- Modify: `apps/api/src/resolution/mission/mission.resolver.ts:58-235` and the payout/race tail; `apps/api/src/resolution/race/race.resolver.ts:189-280`; `apps/api/src/missions/resolution-input.ts:263` (`buildResolveInput` passes `segment`/`carry`); `apps/api/src/missions/dispatch.service.ts:60-96` (`DispatchSnapshot.segment?`)
- Test: `apps/api/test/unit/resolution/mission.resolver.spec.ts`, `apps/api/test/unit/missions/resolution-input.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MissionCarry { integrity: number; client: EscortClient | null; combatCredits: number; loot: MissionLoot[]; storageTaken: string[]; legs: LegOutcome[]; events: MissionEvent[] }
  // MissionInput gains:
  readonly segment?: { readonly fromLeg: number; readonly toLeg: number; readonly final: boolean; readonly dockedSeconds: number };
  readonly carry?: MissionCarry;
  // MissionOutcome gains: readonly stopped: boolean; readonly carry: MissionCarry;
  // resolveRace input gains: readonly extraSeconds?: number  (added to the pilot's total only)
  ```
- [ ] **Step 1: Failing tests.** `mission.resolver.spec.ts`: "a run split at a stop equals the run in one go when nothing changes between" (seed S, 3 legs: segment 0-0 non-final then 1-2 final with the first outcome's `carry` and ship state -> deep-equal `events`, `legs`, `creditsDelta`, `loot` of the unsplit run); "a non-final segment pays nothing and returns `stopped: true`"; "a segment that goes adrift is final: `stopped` false, status `adrift`"; "race docked seconds push the pilot back" (`extraSeconds` 600 at `time_scale` 1 moves the pilot's `seconds` by 600 and can drop the place); "leg RNG uses the global leg index" (segment from leg 1 draws `leg:1`).
- [ ] **Step 2:** `pnpm test:unit test/unit/resolution/mission.resolver.spec.ts` -> FAIL.
- [ ] **Step 3: Implement.** Loop `index` from `segment.fromLeg` to `segment.toLeg` (default whole route), RNG `root.child(`leg:${index}`)`, start integrity/client/storage/loot/combat credits from `carry`; non-final: return after the loop with `stopped: true` unless adrift/failed; final: everything after the loop as today, over `carry.legs + legs` and `carry.events + events`. Race: `extraSeconds = dockedSeconds / rules.missions.time_scale`.
- [ ] **Step 4:** resolver + resolution-input specs PASS (and `test/unit/resolution/*` untouched specs stay green: run the folder). Commit `feat(resolver): run a leg range and carry the run between stops`.

### Task 5: Stops in flight: dispatch, the stop, continue, abandon, the worker

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`MissionStatus` + `AT_STOP`; `MissionInstance.journey Json?`), migration `20261126120000_route_fuel_stops` (append `ALTER TYPE "MissionStatus" ADD VALUE 'AT_STOP';` and `ALTER TABLE "MissionInstance" ADD COLUMN "journey" JSONB;`); `missions/dispatch.service.ts` (fuel gate 484-503, duration 505-516, presence 690-, `rebuildDispatchData` 143); `missions/dto/dispatch.dto.ts`, `dto/travel.dto.ts` (`stops?: string[]`, `@IsArray() @IsString({each:true}) @ArrayMaxSize(16)`); `missions/travel.service.ts`; `missions/resolve.service.ts` (segment mode); `missions/missions.service.ts` (`ACTIVE_STATUSES`, `PLAYER_VISIBLE_STATUSES` + `AT_STOP`, `abandon`, active-mission `journey`); `missions/missions.controller.ts` (continue); `economy/escort.service.ts` (escort from a stop fails the mission); `missions/waiting-mission.ts` (jobs refused while `AT_STOP`)
- Test: `apps/api/test/integration/route-stops.int-spec.ts`, `dispatch.int-spec.ts`, `travel.int-spec.ts`, `resolve-processor.int-spec.ts`, `contract.int-spec.ts`

**Interfaces:**
- Consumes: Task 2 (`validateStops`, `segmentsOf`, `segmentSeconds`, `planRouteFuel`), Task 3 (`RouteFuelService.planFor`), Task 4 (`segment`, `carry`).
- Produces: `POST /v1/ships/:id/dispatch` `{ missionId, stops? }`, `POST /v1/travel` `{ destinationId, stops? }`, `POST /v1/missions/:id/continue` `{ stops?: string[] }` -> `DispatchResponse` (`@Idempotent`); `journey` JSON `{ path: string[]; stops: string[]; segment: number; segments: {fromLeg:number;toLeg:number}[]; totalFlightSeconds: number; dockedSince: string | null; dockedSeconds: number; atStopId: string | null; carry: MissionCarry | null }`; errors `ROUTE_STOP_INVALID` (400), `MISSION_NOT_AT_STOP` (409), `FUEL_INSUFFICIENT` now judged on the next segment only.

- [ ] **Step 1: Failing int tests** (`route-stops.int-spec.ts`, seeded map, debug fast ops on): "dispatch with a stop flies only to the stop" (arrivalAt = `segmentSeconds` of segment 0; presence windows only for its legs); "the worker docks the ship at the stop" (mission `AT_STOP`, ship `IN_PORT` at the stop, fuel burned, wear applied, no payout, no MissionLog yet, `journey.carry` set); "the pilot refuels at the stop by hand" (`/refuel` works there and charges the stop's price); "continue flies the rest and pays once" (final MissionLog `legs` holds every leg, reward credited once, `journey.dockedSeconds` > 0); "continue re-plans" (`stops` for the remaining path accepted; a stop behind the ship -> `ROUTE_STOP_INVALID`); "continue without enough fuel for the next segment -> 409 FUEL_INSUFFICIENT"; "continue refused while repairing -> 409 SHIP_REPAIRING"; "a stop at the origin -> 400 ROUTE_STOP_INVALID"; "adrift before the stop ends the mission FAILED"; "abandon at a stop: FAILED, no pay, ship stays docked there"; "escort called at a stop with an empty tank and no credits fails the mission and tows the ship"; "accept or a mining job while AT_STOP -> ACTIVE_MISSION_EXISTS / JOB refused"; "dispatch without stops behaves as before" (existing `dispatch.int-spec.ts` stays green, no edits).
- [ ] **Step 2:** run them -> FAIL.
- [ ] **Step 3: Implement.** Dispatch: validate stops on the mission path (nodes from origin + route node pairs, as `pathOfLegs` does), compute `totalFlightSeconds` once (today's `missionDuration` call), segment 0 = `segmentsOf(...)[0]`; fuel gate sums only segment 0 (plus dig fuel when it is the last); snapshot `segment` + `legs` of the segment; `arrivalAt = now + segmentSeconds` (+ dig seconds on the last segment); store `journey`. Worker: `segment.final === false` and outcome `stopped` -> one transaction: ship fuel/parts/hp as today's ship update, `currentLocationId` = stop, `status IN_PORT`; mission `AT_STOP`, `arrivalAt` null, `journey.carry`, `dockedSince = now`, `atStopId`; otherwise the final path as today (log `legs` = all). Continue: same gates as travel's blockers (`SHIP_REPAIRING`, `FORMAT_CHANGE_REQUIRED`, `SHIP_NOT_VIABLE`, requirements), fresh snapshot from live parts (repairs count), `dockedSeconds += now - dockedSince`, next segment, new job. `rebuildDispatchData` rebuilds the CURRENT segment from `journey`. Error texts: `errors.MISSION_NOT_AT_STOP` en "This mission is not waiting at a stop." / pt-BR "Esta missão não está esperando numa parada."
- [ ] **Step 4:** all listed int specs + contract spec PASS; `pnpm test:unit test/unit/missions` PASS. Commit `feat(route-fuel): manual refuel stops (AT_STOP, continue, segments)`.

### Task 6: Web: plan on the map, the card line, the chip, the stop screen

**Files:**
- Create: `apps/web/src/features/map/layers/route-fuel-layer.tsx` (+ `.spec.tsx`), `apps/web/src/features/map/use-route-plan.ts`, `apps/web/src/features/map/fuel-stops-store.ts` (+ `.spec.ts`, localStorage pattern of `features/tutorial/tutorial-store.ts`, key per mission id or `travel:<destId>`), `apps/web/src/features/transit/stop-panel.tsx` (+ `.spec.tsx`)
- Modify: `features/map/map.page.tsx` (range 298-311 uses `GET reach`; trip preview 531; sheet 797), `features/map/place-sheet.tsx` (stop list + "No fuel here" mark), `features/map/use-travel.ts` (send `stops`), delete `features/map/reach.ts` + `reach.spec.ts` (no legacy), `features/map/layers/range-layer.tsx` (input = reach places), `features/board/fuel-status.ts` (+ spec), `fuel-block.tsx`, `mission-row.tsx:57`, `mission-card.tsx:361`, `features/transit/transit.page.tsx` (dispatch sends `stops`; `AT_STOP` renders `StopPanel`), `test/msw/handlers.ts`, prologue `sandbox-api.ts` (route-plan/reach handlers: unlimited false, no stops), `styles/*.css`, `i18n/en.json`, `i18n/pt-BR.json`

**Interfaces:**
- Consumes: Tasks 2-5 endpoints and schemas.
- Produces: `useRoutePlan(shipId, target: { missionId } | { destinationId }, stops: string[] | 'suggest')` (query key `['routePlan', shipId, target, stops, ship.fuel]`); `fuelStatus(have, needed, cap, plan: { feasible: boolean; feasibleNow: boolean; stops: number })` -> state `'ok' | 'short' | 'stops' | 'tank'` (`!feasible` tank; `feasibleNow && stops === 0` ok; `feasibleNow && stops > 0` stops; else short).

- [ ] **Step 1: Failing tests.** `fuel-status.spec.ts`: the four states incl. ion (`feasible` true, `stops` 0 -> ok). `route-fuel-layer.spec.tsx`: legs get classes `fuel-ok|fuel-low|fuel-dry`; a dry marker at the leg share; labels only on fuel places, stops and the dry point; places with `sellsFuel` false on the route carry `data-fuel="none"`; each stop shows `unitPrice` with `t('map.fuel.price', { price })`. `place-sheet.spec.tsx`: "No fuel here" on a place that sells none; the stop toggles list the route's fuel places with the suggested ones checked; un-checking one re-queries the plan; the line "Runs dry after {place}; last fuel at {place}" when `dry`. Card (`board.spec.tsx` / `contract-face.spec.tsx`): one line `t('board.fuel.plan', { stops, cost })` for state `stops`, the red chip only for `tank`, the timed warning for RACE/RESCUE. `stop-panel.spec.tsx`: `AT_STOP` shows the place, "stop {n} of {m}", links to Refuel/Repair/Market and the Continue button posting `/v1/missions/:id/continue` with the stored stops; a 409 `FUEL_INSUFFICIENT` shows the error text.
- [ ] **Step 2:** `pnpm --filter web test -- <the specs above>` -> FAIL.
- [ ] **Step 3: Implement** with these strings (en / pt-BR): `map.fuel.noFuel` "No fuel here" / "Sem combustível aqui"; `map.fuel.price` "{{price}} ¢/unit" / "{{price}} ¢/unid."; `map.fuel.stopHere` "Stop here to refuel" / "Parar aqui para abastecer"; `map.fuel.dry` "Runs dry after {{place}}; last fuel at {{last}}" / "Fica sem combustível depois de {{place}}; último combustível em {{last}}"; `board.fuel.state.stops` "{{count}} refuel stop(s)" / "{{count}} parada(s) para abastecer"; `board.fuel.plan` "Plan: {{stops}} stop(s), about {{cost}} ¢ of fuel" / "Plano: {{stops}} parada(s), cerca de {{cost}} ¢ de combustível"; `board.fuel.timed` "Timed contract: a stop costs you time" / "Contrato com tempo: uma parada custa tempo"; `transit.stop.title` "Docked at {{place}} (stop {{n}} of {{m}})" / "Atracado em {{place}} (parada {{n}} de {{m}})"; `transit.stop.hint` "Refuel, repair or shop here, then continue the trip." / "Abasteça, conserte ou compre aqui e depois siga viagem."; `transit.stop.continue` "Continue the trip" / "Seguir viagem"; `transit.stop.replan` "Change stops on the map" / "Mudar paradas no mapa". Colours: ok = the fuel tone, low = amber, dry = the danger tone (existing tokens).
- [ ] **Step 4:** the specs + `src/i18n/keys.spec.ts` + `pnpm --filter web tsc --noEmit` + lint PASS. Commit `feat(web): plan fuel stops on the map, card fuel plan, the stop panel`.

### Task 7: Sim mirror, gate, docs

**Files:**
- Modify: `apps/api/sim/actions/fuel.ts` (refuse where `!sellsFuel(place.type, rules)`, as the service; a no-op with the default empty list), `apps/api/sim/bots/bot.ts` (the refuel call sites 467, 717, 760, 894 skip a place that sells none, only when the list is not empty; the bot never plans stops in this slice), `apps/api/sim/README.md`; docs `docs/TODO_v0.1.5.md` (5c, 5d status), roadmap (slice 2.2 status)
- Test: `apps/api/sim` unit specs if present for `actions/fuel.ts`

**What needs a mirror and why:** the resolver change is shared code (`resolveMission` without `segment` = today's run, so the sim's `takeMission` is unchanged); the sell-fuel rule is the same as today with the default empty list (the bot may refuel anywhere), so the mirror in `actions/fuel.ts` only keeps the sim equal to the game when the owner lists types; stops are not used by the bot (a later bot task once the 5x map makes them necessary).

- [ ] **Step 0 (before Task 1 lands):** sim baseline on the unchanged code (Node 22, `apps/api`): `pnpm sim export`, `sim/run-parallel.sh fuel22-base sim/edits/none.json --temperament balanced --runs 16 --missions 300 --seed 1`.
- [ ] **Step 1:** mirror; `sim/run-parallel.sh fuel22-new ...` same args. Gate: net credits per game hour >= 95% of base per build, no new stalls (`bots/stuck.ts` counts). If a build fails because the bot sat at a no-fuel place, fix the bot (move to the nearest fuel place first), not a game number.
- [ ] **Step 2: Docs.** `TODO_v0.1.5.md` 5d: built (rulings, endpoints, deploy: migration `20261126120000_route_fuel_stops`, rebuild api AND worker, re-export the sim snapshot, new knobs `economy.no_fuel_place_types` (default empty), `missions.route_fuel_low_share`, removed `services.refuel`); 5c: still open for the next version's 5x map. Roadmap slice 2.2 status. Commit `docs: slice 2.2 built (route fuel planning and manual stops)`.

## Open decisions for the owner

1. Which border/edge place types (if any) to list in `economy.no_fuel_place_types`: none by default (owner 2026-11-26: every place sells fuel); the owner may list, for example, the frontier types from Admin without code.
