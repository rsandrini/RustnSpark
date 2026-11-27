# Explore Missions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new board mission type, EXPLORE. The ship flies to an open-space place and scans it with the Radar the store already sells (SENSOR parts, `sen` stat). It is paid by its share of the area asked for. This work also builds the shared steps that REPAIR and FIGHT will reuse.

**Architecture:** EXPLORE is one row of the specialty table. That row uses a new `work` curve: the radar sets the minimum and the blocker, and the flight time is not stretched. A pure module `resolution/explore/explore-scan.ts` owns the scan numbers: strength, ticks, area covered, seconds, fuel. Dispatch plans the scan ticks once and stores them on the last leg (the way a mining contract stores `digTicks`). It adds the scan time and fuel to the trip. The leg resolver scans on the last leg only. The mission resolver pays `reward × covered / area`. A success also gets the core-drop roll every mission already has. Offers are posted through a new "extras" board slot, never as a core type.

**Tech Stack:** NestJS + Prisma (`apps/api`), Jest unit/int, React + Vitest (`apps/web`), zod contract (`packages/contract`), sim (`apps/api/sim`, Node 22).

**Spec:** `docs/superpowers/plans/2026-11-26-new-mission-types-options.md` §1 (R1 + A, accepted by the owner 2026-11-26, `docs/TODO_v0.1.5.md` 5b), built on `docs/superpowers/plans/2026-11-26-missions-follow-ship-specialty.md` ("Adding a type later").

## Gap analysis (read 2026-11-26 on develop @ 74e61c1d)

- **Radar:** `sensor_radar` has sen 4/6/8/12/16 across its 5 tiers, and `sensor_radar_large` has 10/14/19/29/38 (`prisma/seed-data/parts.ts:2951-3096`). Only SENSOR parts carry `sen`. `sheet.sen = sumStat(parts,'sen')` counts DEAD parts too (`ships/sheet.deriver.ts:61`). `sen` is not one of the 7 profile axes. The starter kit has no radar (`onboarding.starter_parts`). The sim's target kit DOES have one (`sim/bots/policy.ts:385`, `sensor_radar`), so bots can take small scans.
- **Mining, the pattern to copy:** dispatch sets `digTicks` on the last leg (`dispatch.service.ts:467-485`), adds `ticks × job_duration_seconds` and fuel (`:587-603`), and stores `cargo.digSeconds` (`:620`). The leg resolver digs when `context.mining !== null` (`leg.resolver.ts:998-1107`); the rig's power share is `successChance(cruisePower.byKind.rig)`. The mission resolver passes mining only on `isLast` (`mission.resolver.ts:184`). It pays `contractedMiningPayout(pay, delivered, required)` and emits `mining_paid`/`mining_partial_failure`, setting `partial_failure` when short (`:344-380`). `ships.service.ts:1037-1068` turns `cargo.digSeconds` into `activity.flightUntil`, and `active-ship-stage.tsx:36-60` switches the scene to `mining`. A sensor already has a power kind (`power.ts:153`, `'sensor'`).
- **Core drops:** `rollCoreDrops('mission', peakZone)` already runs for every `success` that is not TRAVEL and not unpaid (`mission.resolver.ts:264-283`). EXPLORE gets it with no new code.
- **Board:** core = `missions.board_core_types` (D/T/E/M). `requiredTypes` adds the races, and `nextSlot` only asks for other types when a board has room (`board-composition.ts:52-112`). Boards are 6/8/10 (`board_min_by_detail`), so a local board with 4 core + 2 races never shows an extra. The sim imports the same functions (`sim/core/world.ts:41-45`).
- **Places** (`seed-data/world-builder.ts`): the home ports are ceres (luna z0), hedus (sun garrison z2) and cair (explorers outpost z0). Open space is spur (frontier z2), echo (relay z3), veil (dead_zone z3), drift (scrap_field z3) and ziggy (empty z1). `TemplateRequirements` only knows originFactions, originTypes, destinationTypes, destinationIds and materialIds (`template.filler.ts:136`). A home port cannot be excluded by zone yet.
- **Enum value precedent:** `migrations/20261008120000_add_race_mission_type/migration.sql` contains one line, `ALTER TYPE "MissionType" ADD VALUE IF NOT EXISTS 'RACE';`. Local type lists to extend: `encounter-policy.ts:7`, `giver.picker.ts:97`, `entity-tuning.service.ts:19`, `entity-schemas.ts:134`, `sim/snapshot/types.ts:24`, contract `MissionTypeSchema` (`:775`), and web `KINDS`/`MISSION_KIND_ORDER` (`mission-kinds.tsx`).
- **Reports:** a line is `src/reports/templates/{en,pt-BR}/<type>.json` + `TEMPLATE_PLACEHOLDERS` + `MISSION_EVENT_TYPES` + `event.schema.ts` category. The report-template seed reads the files. The web has no per-type result code.

## Rulings (made here unless marked owner; each can be overturned)

1. Owner: the tool is the radar the store sells, and the pay follows the area scanned. Build order: explore, repair, fight.
2. The stat is `sensor` = `scanStrength(scanSensorsOf(parts))`, condition-weighted (read through `specialtyStat(stat, { sheet, parts }, rules)`; `parts` is required, never `sheet.sen`) (a new `SpecialtyStat` case in `specialtyStat`, NOT an 8th profile axis: the spider chart and `ship_profile.ref_*` stay as they are). The checklist row reads the verdict's `have`, so the verdict, checklist, dispatch, board and preview all use that one number. It counts only connected, non-dead SENSOR parts, each `sen × performance(condition)`, so a dead radar is refused even though `sheet.sen` still counts it.
3. Curve: a new `work` curve, neither `power` nor `trips`. `power` would stretch the flight, and `trips` would fly the route again. With `work`, the verdict gives `need`, `minimum` and `blocker`, and `factor = 1`. The work time is the type's own module. REPAIR reuses this curve.
4. "The area asked for" = `cargo.area`, a whole number of scan units drawn per offer from the template's `requirements.scanArea: [min, max]` (fallback `explore.area_min..area_max`). Need = area. Minimum = `area × specialty.explore.min_ratio` (0.05: area 80 needs sen ≥ 4, area 120 needs 6, so the common Radar takes the small scans).
5. The scan is deterministic, with no luck roll. `perTick = strength × explore.scan_k × sensorPowerShare`. Dispatch plans `ticks = min(explore.max_ticks, ceil(area / perTick))` at full power from the flight sheet and stores `scanTicks` on the last leg. The resolver scans those ticks with the in-flight power share. Wear on the way can lower the covered share; it never adds time.
6. An area larger than the radar covers inside `max_ticks` gives no second trip. It pays the share: `round(reward × covered / area)`, status `partial_failure`, and no core drop (like a short mining contract).
7. Reward = `rewardBase(…, 'explore')` + `area × explore.unit_pay`, in BOTH the filler and `missionReward` (accept re-prices by tier, D29). The resolver pays from the stored reward (`pay`), like a mining contract.
8. The scan burns `explore.fuel_per_tick` per tick it really runs (ships with `fuelUse > 0` only). Dispatch refuses when trip + scan fuel > fuel aboard (`FUEL_INSUFFICIENT`).
9. No deadline (`deadlineAt` stays null; only RESCUE sets one). The cap is `max_ticks × tick_seconds` (12 × 300 s = 1 h).
10. Places: new generic `requirements.originMinZone`. The templates are explorers (outposts/frontiers, zone ≥ 1: rennick, spur), sun (junction/relay/port: gate, echo, marsa) and luna (outpost/empty, zone ≥ 1: vesta, ziggy). All three scan at `destinationTypes: ['frontier','relay','dead_zone','scrap_field','empty']`. No home port posts explore. No pirate templates (TODO item 12).
11. The extras slot: `missions.board_extra_types` (default `['EXPLORE']`) and `missions.board_min_extras` (default 1). After the core types, a board that can post an extra type keeps at least that many offers of the extra types, and `boardTarget` grows by it. REPAIR and FIGHT join by being added to the list.
12. No giver offers EXPLORE yet: no seeded weights and no `offer.EXPLORE` lines. The slot posts it without a giver and shows the template's description. `giver.picker` accepts the type, so the Admin can add weights later.
13. Defaults are first guesses: `explore = { scan_k: 1.5, tick_seconds: 300, max_ticks: 12, fuel_per_tick: 25, unit_pay: 50, area_min: 40, area_max: 120 }`, `specialty.explore = { min_ratio: 0.05 }`, `economy.reward_type_bonus.explore = 1`.
14. Owner: no retro-compat. Old offers are untouched, and nothing is migrated except the enum value.

## Global Constraints

- `apps/api/src` must not import `@rustandspark/contract`. Use local types (`OfferInfo` in missions.service). Parse the responses in `test/integration/contract.int-spec.ts`.
- Code in English. Every player string is in en AND pt-BR. `apps/web/src/i18n/keys.spec.ts` needs literal `t('...')` keys, so a dynamic key like `transit.workingAt.${…}` is not acceptable for new strings.
- New config keys go in `game-rules.schema.ts`, `game-config.types.ts`, `game-config.defaults.ts` and `config-registry.ts` (description en + pt-BR). No migration for keys (DB wins). The only migration is the enum value.
- New error/blocker codes get en + pt-BR in `board.reasons`, `board.requirements` and the top-level `error` map.
- Commits only on `develop`: run `git branch --show-current` before each one. Never `release/*`, `main` or `master`.
- Run only the specs for the files touched, plus `pnpm typecheck` in each touched package. No browser or e2e tasks. Grep `apps/*/e2e` for board-size literals at the explore origins and fix them. Running e2e is the pre-push step, outside this plan.
- Rebuild the `worker` container before any manual check (missions resolve there).
- Sims run on Node 22 (`apps/api`, `set -a; . ../../.env; set +a`). Sim day = 2 game hours. Do not re-export the snapshot between Task 1 Step 0 and Task 8 Step 2.
- New parts: none. The EXPLORE board glyph is a placeholder SVG in `mission-kinds.tsx` (parts art deferred).
- The tank-cargo plan (in progress) may add its own migration and template rows. Rebase the migration timestamp if both land the same day.

## Review Focus

1. **A ship with no radar, or only a dead one** (sen 0, or condition ≤ `dead_at_or_below`): refused with `SENSOR_STRENGTH`, whose fix is the SENSOR store tab. No division by zero, and `planScan` stays finite (ticks = cap, covered 0). Tests: Task 2 `no radar / dead radar refused`, Task 7 `fixOf('SENSOR_STRENGTH')`.
2. **Area larger than the radar covers** (sen 4, area 80: the minimum is met, but perTick 6 × 12 ticks covers 72): dispatch plans 12 ticks, the payout is 90% of the reward, the status is `partial_failure`, there is no core drop, and the card shows "covers 90%" before accepting. A sen 4 radar on area 120 (minimum 6) is refused, not paid a share. Tests: Task 2 `capped plan`, Task 5 `short scan pays the share`.
3. **Scan time vs flight and fuel on a multi-leg route:** only the LAST leg scans. Duration = flight + ticks × 300 s, and a chemical ship's fuel needs trip + scan. Float trimming means an exact fit (area 60, perTick 6) covers 60, not 59. Tests: Task 5 `scans on the last leg only`, Task 2 `exact fit`, Task 6 int `dispatch adds scan time and fuel`.
4. **The radar sold or swapped between accept and dispatch:** dispatch re-checks and refuses with `MISSION_REQUIREMENTS_NOT_MET` (SENSOR_STRENGTH). A ship in flight cannot swap parts (`parts.service.ts:231`), and resolution reads the dispatch snapshot. Test: Task 6 int `dispatch re-checks the radar`.
5. **The board mix and starter/guest offers:** EXPLORE is never a core type and never a starter offer (starter types are DELIVERY only, `missions.service.ts:348`). It shows only at the explore origins, and a board there grows by one slot. Home ports never post it. Tests: Task 3 `home ports post no explore`, Task 4 `extras slot`.

---

### Task 1 [SHARED]: Sim baseline, enum value, type lists, knobs

**Files:**
- Create: `apps/api/prisma/migrations/20261126140000_add_explore_mission_type/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:198-211`, `src/resolution/encounter/encounter-policy.ts:7`, `src/missions/generator/giver.picker.ts:97`, `src/admin/tuning/entity-tuning.service.ts:19`, `src/admin/tuning/entity-schemas.ts:134`, `sim/snapshot/types.ts:24`, `src/missions/mission-specialty.ts` (`EXPLORE: null` placeholder row), config (schema, types, defaults, registry)
- Test: `apps/api/test/unit/config/config-registry.spec.ts`, `test/unit/config/game-rules.schema.spec.ts`, `test/unit/missions/mission-specialty.spec.ts:238`

**Interfaces:** Produces `MissionType.EXPLORE`, `rules.explore` (Ruling 13), `rules.specialty.explore: { min_ratio }`, `rules.missions.board_extra_types: string[]`, `rules.missions.board_min_extras: number`, and ConfigKeys `explore.scan_k|tick_seconds|max_ticks|fuel_per_tick|unit_pay|area_min|area_max`, `specialty.explore`, `missions.board_extra_types`, `missions.board_min_extras`, group `explore`.

- [ ] **Step 0: Sim baseline on the unchanged code** (record the SHA): `pnpm sim export`, then `sim/run-parallel.sh explore-base sim/edits/none.json --temperament balanced --runs 8 --missions 300 --seed 1`. Expected: `all builds finished: explore-base`.
- [ ] **Step 1: Failing tests.** In config-registry.spec: add the 10 keys to the sorted key list, plus `it('registers explore.* and specialty.explore with en and pt-BR')`, which asserts non-empty `description.en`/`['pt-BR']` and `factoryDefault` equal to Ruling 13. In game-rules.schema.spec: `it('rejects explore.max_ticks 0 and specialty.explore.min_ratio 0.01')`.
- [ ] **Step 2:** `pnpm test:unit -- config-registry game-rules.schema` → FAIL.
- [ ] **Step 3: Implement.** Add `EXPLORE` to the Prisma enum after `RACE`, with the comment "A scan of an open-space place with a radar; pays by the share of the area scanned". migration.sql = `ALTER TYPE "MissionType" ADD VALUE IF NOT EXISTS 'EXPLORE';`. Add `'EXPLORE'` to the six local lists. Bounds: scan_k 0.1-20, tick_seconds 30-3600, max_ticks 1-100 (int), fuel_per_tick 0-500, unit_pay 0-10000, area_min/max 1-10000 (int), min_ratio 0.05-1, board_min_extras 0-4 (int), board_extra_types as an array of MissionType names (unknown names ignored like `board_core_types`). Put `specialty.explore` in `JSON_KEY_SCHEMAS`. Add `explore: 1` to `reward_type_bonus`.
- [ ] **Step 4:** `pnpm prisma migrate dev` applies the migration and regenerates the client. Then `pnpm test:unit -- config-registry game-rules.schema mission-specialty` → PASS, and `pnpm typecheck` is clean.
- [ ] **Step 5: Commit** `feat(missions): the EXPLORE mission type and its admin knobs`.

### Task 2 [SHARED: `work` curve]: Specialty row, sensor stat, scan module, requirement

**Files:**
- Create: `apps/api/src/resolution/explore/explore-scan.ts`, `apps/api/test/unit/resolution/explore-scan.spec.ts`
- Modify: `src/missions/mission-specialty.ts`, `src/missions/requirements.checker.ts` (`RequirementReasonCode`, `RequirementUnit`, `offerRequirements`, checklist switch)
- Test: `test/unit/missions/mission-specialty.spec.ts`, `test/unit/missions/requirements.checker.spec.ts`

**Interfaces:**
- Produces in `explore-scan.ts` (pure, no I/O):
  - `interface ScanSensor { partClass: string; sen: number; condition: number; connected?: boolean }`
  - `scanStrength(sensors: readonly ScanSensor[], rules: GameRules): number`: Σ `sen × performance(condition)` over SENSOR parts with `connected !== false` and `!isDead(condition)`.
  - `scanPerTick(strength: number, powerShare: number, rules: GameRules): number` = `max(0, strength × explore.scan_k × clamp01(powerShare))`.
  - `interface ScanPlan { ticks: number; perTick: number; covered: number; share: number; seconds: number }`
  - `planScan(area: number, strength: number, rules: GameRules): ScanPlan`: full power. `ticks = perTick > 0 ? clamp(ceil(trim(area/perTick)), 1, max_ticks) : max_ticks`, then `scanCovered`, `share = area > 0 ? covered/area : 0`, `seconds = ticks × tick_seconds`.
  - `scanCovered(area: number, perTick: number, ticks: number): { covered: number; ticksRun: number }`: `covered = min(area, floor(trim(perTick × ticks)))`, and `ticksRun` is the first tick that reaches the area (else `ticks`). `trim = Number(x.toFixed(9))`, as in `specialtyMinimum`.
  - `scanFuel(ticksRun: number, fuelUse: number, rules: GameRules): number` = `fuelUse > 0 ? ticksRun × explore.fuel_per_tick : 0`.
  - `areaOf(cargo: unknown): number`: `cargo.area` when it is a positive integer, else 0.
- Produces in mission-specialty: `SpecialtyStat | 'sensor'`, `SpecialtyCurve | 'work'`, and the row `EXPLORE: { stat: 'sensor', curve: 'work', blocker: 'SENSOR_STRENGTH', wholeUnits: false, knobs: r => r.specialty.explore, needOf: offer => area > 0 ? area : 1 }`. `specialtyOf` for `work` returns `{ factor: 1, trips: null, … }`, so `specialtyStretch` = 1.
- Produces in the checker: code `'SENSOR_STRENGTH'` ("The ship's radar is too weak for this area."), unit `'sensor'`, `offerRequirements` → `{ …base, passengers, area: cargo.area }`, and `case 'EXPLORE': [numeric(SENSOR_STRENGTH, 'sensor', minimum, scanStrength(sensorsOf(parts), rules))]`.

- [ ] **Step 1: Failing tests** in explore-scan.spec, with defaults:
  - `planScan(60, 4)` → `{ ticks: 10, perTick: 6, covered: 60, share: 1, seconds: 3000 }` ("exact fit").
  - `planScan(80, 4)` → `{ ticks: 12, covered: 72, share: 0.9, seconds: 3600 }` ("capped plan").
  - `planScan(120, 4)` → `{ ticks: 12, covered: 72, share: 0.6 }` (the pure function does not gate).
  - `planScan(80, 0)` → `{ ticks: 12, covered: 0, share: 0 }`, all finite.
  - `scanStrength` of a sen 8 radar at condition 50 = 8 × 0.75 = 6; a dead radar (condition 1) = 0; a disconnected one = 0; a non-SENSOR part with sen = 0.
  - `scanCovered(60, 6, 12)` → `{ covered: 60, ticksRun: 10 }`.
  - `scanFuel(10, 0)` = 0, and `scanFuel(10, 3)` = 250.
  - `areaOf({ area: 2.5 })` = 0.
  
  In mission-specialty.spec: `specialtyOf('EXPLORE', {requirements:{area:80},peakDanger:0}, sheetWith({sen:4}))` → `{ stat:'sensor', need:80, minimum:4, factor:1, trips:null, met:true }`; sen 3 → `met:false, blocker:'SENSOR_STRENGTH'`; `specialtyStretch` = 1. In requirements.checker.spec: `no radar / dead radar refused` (row `SENSOR_STRENGTH`, `met:false`, `needed: 4`, `actual: 0`) and `a wide radar meets area 120`.
- [ ] **Step 2:** `pnpm test:unit -- explore-scan mission-specialty requirements.checker` → FAIL.
- [ ] **Step 3: Implement** the signatures above. Update the header comment of mission-specialty to list `work` ("the type's own rules time the work; the row sets the minimum and the blocker").
- [ ] **Step 4:** The same command → PASS. `pnpm typecheck` is clean.
- [ ] **Step 5: Commit** `feat(missions): explore follows the ship's radar (work curve, SENSOR_STRENGTH)`.

### Task 3: Templates, eligibility, offer cargo and reward

**Files:**
- Modify: `apps/api/prisma/seed-data/mission-templates.ts` (3 rows), `src/missions/generator/template.filler.ts` (`TemplateRequirements.originMinZone`, `requirementsOf`, `matchesOrigin`, the `cargo` and `reward` blocks at `:702-750`), `src/missions/mission.reward.ts`
- Test: `test/unit/missions/template.filler.spec.ts`, `test/unit/missions/mission.reward.spec.ts`, `test/integration/seed.int-spec.ts`

**Interfaces:**
- Consumes `areaOf`.
- Produces: `exploreAreaPay(area: number, rules: GameRules): number` = `area × explore.unit_pay` (in `mission.reward.ts`). An EXPLORE draft carries `cargo = { area }` and `reward = round(rewardBase(…'EXPLORE') + exploreAreaPay(area))`.
- Produces: `missionReward` for EXPLORE = `round(rewardBase(tier…) + exploreAreaPay(areaOf(cargo)))`.
- Produces: `requirements.originMinZone` (number) for any template (REPAIR/FIGHT reuse it). `scanArea: [min, max]` (ints, min ≤ max) is read by `exploreArea(rng, template, rules)`, which draws `rng.child('area').int(min, max)`; when the field is invalid it falls back to `explore.area_min..area_max`.

- [ ] **Step 1: Failing tests** (filler fixtures with the 3 templates, Ruling 10):
  - `it('home ports post no explore')`: `eligibleTypesAt` of ceres, hedus, cair has no EXPLORE. vesta, spur, rennick, gate, echo, marsa have it.
  - `it('an explore offer scans an open-space place and asks for an area in the template range')`: destination type ∈ the 5 types, `60 ≤ cargo.area ≤ 120` for explorers, `deadlineAt === null`.
  - `it('explore reward = base + area × unit_pay')`.
  - `it('a starter draft is never EXPLORE')`.
  - In mission.reward.spec: `missionReward` of an EXPLORE row, area 80, tier 2 = `round(rewardBase(tier 2) + 4000)`.
  - In seed.int-spec: the three `explore_*` rows exist, are active and of type EXPLORE.
- [ ] **Step 2:** `pnpm test:unit -- template.filler mission.reward` → FAIL.
- [ ] **Step 3: Implement.** `matchesOrigin` also requires `origin.zone >= (originMinZone ?? 0)`. Seed rows `explore_explorers`, `explore_sun`, `explore_luna`. Their requirements follow Ruling 10. Their `scanArea` values are explorers [60,120], sun [40,90], luna [40,80]. Their en / pt-BR names:
  - "Survey the Frontier" / "Levantamento da Fronteira"
  - "Alliance Patrol Scan" / "Varredura de Patrulha da Aliança"
  - "Corporate Survey" / "Levantamento Corporativo"

  All three use the description "Fly out to open space and sweep it with your radar. Pay follows the area you scan." / "Voe até o espaço aberto e varra a área com seu radar. O pagamento acompanha a área escaneada."
- [ ] **Step 4:** Unit PASS. On the int stack: `pnpm test:int -- seed -t explore` PASS. Run the dev DB seed (`pnpm prisma db seed`) so the rows exist (the seed only creates missing ids).
- [ ] **Step 5: Commit** `feat(missions): explore templates at the open-space places, paid by area`.

### Task 4 [SHARED]: The extras board slot

**Files:**
- Modify: `apps/api/src/missions/board-composition.ts`
- Test: `apps/api/test/unit/missions/board-composition.spec.ts`

**Interfaces:**
- Produces `extraTypes(reach: BoardReach, rules: GameRules): MissionType[]`: `board_extra_types` the place can post, excluding `NOT_BOARD_TYPES` and core types, in config order.
- Produces `boardTarget` = `max(baseSize, requiredTypes.length + min(board_min_extras, extraTypes.length > 0 ? board_min_extras : 0))`.
- Produces `nextSlot`: after the missing core/race step and BEFORE the length needs, when live offers of the extra types < `min(board_min_extras, …)` and some extra type is uncapped, it returns `{ types: new Set(uncapped extras) }`. Both `board.service.ts` and `sim/core/world.ts` already call these, so neither changes.

- [ ] **Step 1: Failing tests:**
  - `it('extras slot: a full core board that can post EXPLORE asks for it before any length need')`
  - `it('extras are not core: requiredTypes never lists EXPLORE')`
  - `it('boardTarget grows by board_min_extras only where an extra type is reachable')` (6 → 7, and 6 stays 6 without EXPLORE in reach)
  - `it('board_min_extras 0 restores today's slots exactly')` (deep-equal to the current outputs on the existing fixtures)
  - `it('a capped extra is not asked for')`
- [ ] **Step 2:** `pnpm test:unit -- board-composition` → FAIL.
- [ ] **Step 3: Implement.** Then grep `apps/*/e2e` and `test/integration/board.int-spec.ts` for board counts at vesta/spur/rennick/gate/echo/marsa/ziggy and update them.
- [ ] **Step 4:** `pnpm test:unit -- board-composition board-size` PASS. On the int stack: `pnpm test:int -- board` PASS.
- [ ] **Step 5: Commit** `feat(board): an extras slot so new mission types show on boards with room`.

### Task 5: Scan on the last leg, payout, report lines

**Files:**
- Modify: `src/resolution/leg/leg.resolver.ts` (`LegRoute.scanTicks?`, `LegMissionContext.scan`, `LegOutcome.scanned?`, a step 6 after mining), `src/resolution/mission/mission.resolver.ts` (`MissionInput.explore?`, `isLast` wiring, payment branch), `src/economy/reward.calculator.ts` (`sharePayout`), `src/missions/resolution-input.ts` (`ResolutionContext.explore`, `contextFromLive`, `buildResolveInput`), `src/resolution/events/mission-event.ts`, `src/reports/events/event.schema.ts`, `src/reports/templates/template.placeholders.ts`
- Create: `src/reports/templates/{en,pt-BR}/{explore_scanned,explore_paid,explore_partial_failure}.json` (3+ variants each)
- Test: `test/unit/resolution/mission.resolver.spec.ts`, `test/unit/missions/resolution-input.spec.ts`, `test/unit/reports/template.placeholders.spec.ts`, `test/unit/economy/reward.calculator.spec.ts`

**Interfaces:**
- Consumes `scanPerTick`, `scanCovered`, `scanFuel`, `scanStrength`, `areaOf`.
- Produces `sharePayout(base, done, asked): number`. `contractedMiningPayout` now delegates to it, with the same results.
- Produces `MissionInput.explore?: { area: number; pay?: number; scanner: { strength: number } }`. `resolution-input` sets `strength = scanStrength(snapshot.parts mapped to ScanSensor)`. `ResolutionContext.explore = { area, pay? }` comes from `cargo.area` and `reward > 0`.
- Produces the leg step: when `context.scan !== null`, `power = cruisePower === null ? 1 : successChance(cruisePower.byKind.sensor)`, `perTick = scanPerTick(strength, power)`, and `{covered, ticksRun} = scanCovered(area, perTick, max(1, route.scanTicks ?? 1))`. The step burns `scanFuel(ticksRun, sheet.fuelUse)` and emits `explore_scanned` (category `loot`, magnitude `covered`). It returns `scanned: covered`. No RNG is drawn, so other streams do not move.
- Produces the mission payment branch (`else if (input.mission.explore)`): `covered = Σ legs.scanned` and `payout = round(sharePayout(pay ?? base, covered, area))`. It emits `explore_paid` when `covered >= area`, else `explore_partial_failure`, and sets `status = 'partial_failure'`.
- Produces events/placeholders `explore_scanned: ['magnitude']`, `explore_paid: ['credits']`, `explore_partial_failure: ['credits']`, all category `payment` except `explore_scanned` (`loot`).

- [ ] **Step 1: Failing tests** (mission.resolver.spec, an EXPLORE input with 3 legs, area 60, strength 4, last leg `scanTicks: 10`, rules with `encounter chance 0`):
  - `scans on the last leg only`: exactly one `explore_scanned` event, `leg === 2`, magnitude 60.
  - `full scan pays the stored reward and rolls the mission core drops`: `explore_paid` credits = pay, and a zone-3 route has a `core_drop` event given a seed that rolls one.
  - `short scan pays the share`: area 80, strength 4, 12 ticks → `explore_partial_failure` credits = `round(pay × 0.9)`, status `partial_failure`, no `core_drop`.
  - `scan fuel is burned for ticks run, ion ships burn none`.
  - `the same seed with and without explore leaves the other events identical` (a DELIVERY baseline vs the same legs: the encounter/wear streams are unchanged).
  
  In resolution-input.spec: `explore context from cargo.area and reward; scanner strength skips a dead radar`. In template.placeholders.spec: every new type has en + pt-BR files and uses only its placeholders.
- [ ] **Step 2:** `pnpm test:unit -- mission.resolver resolution-input template.placeholders reward.calculator` → FAIL.
- [ ] **Step 3: Implement.** Sample en line for `explore_scanned`: "Your radar swept {magnitude} units of the area." The pt-BR version is "Seu radar varreu {magnitude} unidades da área."
- [ ] **Step 4:** Same command → PASS. Also `pnpm test:unit -- mining-yield mining.resolver core-drops` stays green (no mining behaviour change).
- [ ] **Step 5: Commit** `feat(resolution): explore scans on the last leg and pays by the area covered`.

### Task 6: Dispatch plan, offer card info, ship activity (API)

**Files:**
- Modify: `src/missions/dispatch.service.ts` (after `:485` and `:603`), `src/missions/missions.service.ts` (`OfferInfo`, the estimate near `:1035`), `src/ships/ships.service.ts:1037-1068`
- Test: `test/integration/dispatch.int-spec.ts`, `test/integration/missions.int-spec.ts`, `test/integration/contract.int-spec.ts`

**Interfaces:**
- Consumes `planScan`, `scanStrength`, `scanFuel`, `areaOf`.
- Produces in dispatch: for EXPLORE, `plan = planScan(area, scanStrength(flight parts))`. The last leg gets `scanTicks: plan.ticks` (legs stored like `contractedDig`). The fuel check is `fuelNeeded + scanFuel(plan.ticks, sheet.fuelUse)`. Then `durationSeconds += plan.seconds`, and `cargo.scanSeconds = plan.seconds` is stored.
- Produces in OfferInfo (local type): `explore: { area: number; perTick: number; ticks: number; capTicks: number; share: number; scanSeconds: number } | null` (viewer's ship, null without a viable ship or on other types). `estimate.scanSeconds?: number` sits next to `flightSeconds`, and the estimate adds the scan time and fuel like `digExtra`.
- Produces in activity: EXPLORE with `cargo.scanSeconds > 0` sets `flightUntil = arrivalAt − scanSeconds` and the new `flightThen: 'scanning'`. A mining contract gets `flightThen: 'mining'`.

- [ ] **Step 1: Failing int tests:**
  - `dispatch adds scan time and fuel`: sen 4, area 60 → `arrivalAt − now = planned flight + 3000 s` (the scan, like the dig, is added after `missionDuration`, so `time_scale` does not touch it), the last leg `scanTicks === 10`, `cargo.scanSeconds === 3000`. Too little fuel for trip + scan → 409 `FUEL_INSUFFICIENT`.
  - `dispatch re-checks the radar`: accept with a radar, uninstall it, dispatch → 409 `MISSION_REQUIREMENTS_NOT_MET` with `SENSOR_STRENGTH`.
  - `the board card shows the share the radar covers`: area 80 with sen 4 → `explore.share === 0.9`, `estimate.scanSeconds === 3600`.
  - `ship activity: flying then scanning`.
  - contract.int-spec parses the offer and ship responses after Task 7's schemas (add them in that task, then re-run here).
- [ ] **Step 2:** `pnpm test:int -- dispatch missions -t explore` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Same → PASS. `pnpm test:int -- dispatch -t mining` stays green.
- [ ] **Step 5: Commit** `feat(missions): dispatch plans the scan; the card and the ship show it`.

### Task 7 [SHARED: chip, fix, guide pattern]: Contract and web

**Files:**
- Modify: `packages/contract/src/index.ts` (`MissionTypeSchema` + `EXPLORE`, `RequirementCheckSchema.unit` + `'sensor'`, `specialty.stat` + `'sensor'`, `OfferInfoSchema.explore`, `estimate.scanSeconds`, `activity.flightThen: z.enum(['mining','scanning']).optional()`)
- Modify (web): `features/board/mission-kinds.tsx` (radar glyph, order after MINING), `features/board/requirement-fix.ts` (`SENSOR_STRENGTH: 'SENSOR'`), `features/board/requirement-number.ts` (`sensor` needed rounded up), `features/board/mission-card.tsx` + `contract-face.tsx` (explore line), `ui/ShipStage.tsx` (`StageMode` + `'scanning'`, reusing the mining scene layout with a radar-sweep placeholder), `features/ship/active-ship-stage.tsx` (`kind = digging ? (flightThen ?? 'mining') : …`, detail `stage.thenScanning`), `features/guide/guide-model.ts` (`missions: [..., 'explore']`), `i18n/en.json`, `i18n/pt-BR.json`
- Test: `requirement-fix.spec.ts`, `requirement-number.spec.ts`, `mission-kinds.spec.tsx`, `board.spec.tsx`, `active-ship-stage.spec.tsx`, `guide.spec.tsx`, `i18n/keys.spec.ts`

**Interfaces:** Consumes the Task 6 response fields. Produces the i18n keys below (en + pt-BR):
- `board.type.EXPLORE` "Explore" / "Exploração"
- `board.needs.EXPLORE` "a Radar strong enough for the area (Sensors in the store)."
- `board.reasons.SENSOR_STRENGTH` and `board.requirements.SENSOR_STRENGTH` "Radar strength for this area"
- `error.SENSOR_STRENGTH`
- `board.explore.line` "Scan {{area}} units · your radar covers {{pct}}% in {{time}}"
- `stage.mode.scanning` "Scanning the area"
- `stage.thenScanning`
- `guide.topics.missions.sections.explore.{title,text}`, plus "Explore" added to `sections.types.text` and to the keywords

- [ ] **Step 1: Failing tests:**
  - `fixOf('SENSOR_STRENGTH')` → `{ kind:'store', partClass:'SENSOR' }`, and `fixHref` → `/ship?store=SENSOR`.
  - `requirementNumber(4.2,'sensor',d,'needed')` = "5".
  - `missionKind('EXPLORE').labelKey === 'board.type.EXPLORE'`, and EXPLORE is in `MISSION_KIND_ORDER`.
  - board.spec: an EXPLORE offer with `explore.share 0.9` renders "covers 90%", and an unmet `SENSOR_STRENGTH` chip links to `/ship?store=SENSOR`.
  - active-ship-stage.spec: `flightThen:'scanning'` past `flightUntil` renders "Scanning the area".
  - guide.spec: the Missions topic lists the Explore section.
- [ ] **Step 2:** `npx vitest run src/features/board src/features/ship/active-ship-stage.spec.tsx src/features/guide src/i18n` → FAIL.
- [ ] **Step 3: Implement.** Rebuild the contract package. Then re-run the Task 6 contract.int-spec parse.
- [ ] **Step 4:** Same vitest command → PASS. `pnpm --filter web typecheck` and `pnpm --filter @rustandspark/contract build` are clean. `pnpm test:int -- contract` PASS.
- [ ] **Step 5: Commit** `feat(web): explore offers, the radar chip, the scanning stage and the guide`.

### Task 8 [SHARED: sim guard]: Sim mirror, regression gate, docs

**Files:**
- Modify: `apps/api/sim/actions/mission.ts` (legs `:259-266`, duration `:267-277`, fuel check where the sim checks fuel, the `contextFromLive` call)
- Create: `apps/api/sim/edits/explore-v1.json` (`{ "rules": { "explore": …, "specialty": { …current three, "explore": { "min_ratio": 0.05 } }, "missions": { "board_extra_types": ["EXPLORE"], "board_min_extras": 1 } } }`: the Step 0 snapshot predates the keys)
- Modify: `docs/TODO_v0.1.5.md` (5b: explore built, with the gate numbers), and `docs/superpowers/plans/2026-11-26-missions-follow-ship-specialty.md` ("Adding a type later" gains the `work` curve, `originMinZone` and `board_extra_types`)
- Test: `apps/api/test/unit/sim/mission.spec.ts`

**Interfaces:** Consumes `planScan`, `scanStrength`, `scanFuel`, `areaOf` (the same functions dispatch uses, so the sim plays EXPLORE exactly as the game does).

- [ ] **Step 1: Failing test:** `it('the sim plans an explore scan like dispatch')`. A bot with `sensor_radar` (sen 4) takes an area-60 offer: the last leg gets `scanTicks 10`, the duration = flight + 3000, and the outcome has `explore_paid`.
- [ ] **Step 2:** `pnpm test:unit -- sim/mission` → FAIL. Implement. → PASS. The sim typecheck is clean.
- [ ] **Step 3: Gate (same snapshot as Step 0).** Run `sim/run-parallel.sh explore-new sim/edits/explore-v1.json --temperament balanced --runs 8 --missions 300 --seed 1`. The Step 0 snapshot has no EXPLORE templates, so no explore offer exists. **Pass:** per build (chem, chem-shield, ion-shield, hybrid), `python3 sim/levels.py "base=explore-base-%-edit" "new=explore-new-%-edit"` and `python3 sim/compare.py base=explore-base-% new=explore-new-%` show the same medians (net credits/hour within 1%, L2day/L3day unchanged, no new stalls). A difference means the shared code changed an old path. Stop and report it.
- [ ] **Step 4: Informational run (not a gate).** `pnpm sim export` (the snapshot now has the templates), then `sim/run-parallel.sh explore-live sim/edits/none.json …` with the same flags. Report the EXPLORE takes per build and the net credits/hour vs a fresh `none` run on that snapshot. Write the numbers in TODO 5b. No tuning: balance is the owner's call.
- [ ] **Step 5: Commit** `feat(sim): the sim plays explore like the game; gate result in TODO 5b` (the sim files, the edit file and the docs only).

---

## Shared steps for REPAIR and FIGHT

- Task 1: the enum + migration recipe, the six local type lists, and a knob group per type.
- Task 2: the `work` curve.
- Task 3: `originMinZone` and the template row shape.
- Task 4: `board_extra_types` / `board_min_extras`.
- Task 7: the blocker chip → `requirement-fix` store class, the `board.needs.<TYPE>` / guide section pattern, and `flightThen`, which extends to `'repairing'` for work on the last leg.
- Task 8: the same-snapshot sim gate.

REPAIR adds its row (`work`, a new Repair Rig stat) and appends `'REPAIR'` to `board_extra_types`. FIGHT does the same.
