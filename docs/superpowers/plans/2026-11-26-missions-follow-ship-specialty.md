# Missions Follow the Ship's Specialty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mission's time and its minimum come from the ship's stat that matters for its type, so a prepared ship does the job faster, a weak one slower, and one below the minimum cannot take it. This is driven by one table that future types extend with a row.

**Architecture:** A typed table (`apps/api/src/missions/mission-specialty.ts`) maps each mission type to its stat (a ship profile axis or a stat derived from axes), how the offer states its need, a time curve, a minimum ratio and a blocker code. Pure functions turn (type, offer, sheet, rules) into a verdict: need, have, factor, met. `missionDuration` gets an optional `stretch` (the factor). The checklist uses the verdict's minimum. Every place that quotes or plans a mission passes both. The web reads a new `info.specialty` block. The sim imports the same functions.

**Tech Stack:** NestJS + Prisma (`apps/api`), Jest unit/int, React + Vitest (`apps/web`), zod contract (`packages/contract`), sim (`apps/api/sim`, Node 22).

**Spec:** `docs/TODO_v0.1.5.md` item 1, plus the owner's 2026-11-26 agreement to build it as a general mechanism and the Rulings below.

## Gap analysis (read 2026-11-26 on develop @ 94d7a155)

Time today is `missionDuration` (`duration.calculator.ts`): `round(distance / sheet.mob × duration_k)`, then the short-trip floor, then `× time_scale`. It is called by `dispatch.service.ts:505` (planned) and `:640` (quoted card, audit drift), `engine-preview.service.ts:198`, `missions.service.ts:944` (offer estimate), `travel.service.ts:293`, `template.filler.ts:310` (`referenceSeconds`, board reference ship), and in the sim by `actions/mission.ts:240` and `bots/temperament.ts:50`. Requirements come from `missionRequirementChecklist` / `checkMissionRequirements` (`requirements.checker.ts`), with hints from `offerRequirements(template, cargo)`. They are checked at board draft (`missions.service.ts:340`), accept (`:645`), board view (`:867`, `:1044`), dispatch (`dispatch.service.ts:418`) and in the sim (`actions/mission.ts:91`, `core/world.ts:364`). Rewards (`reward.calculator.ts`) follow distance and `reward_type_bonus`, not time, so a slower ship earns less per hour by itself.

| Type | Follows the ship today | Gap |
|---|---|---|
| DELIVERY | Time ∝ 1/mobility. Hard minimum: hold `crg >= cargo` (`CARGO_TYPE`). Modes min/fixed/open (`cargo-mode.ts`), always one trip | None for item 1 (mobility, "already so") |
| RACE | Mobility vs rivals (`race.resolver.ts`), minimum `RACE_SPEED` | None ("already so") |
| MINING | Dig time from sheet MIN (`mining-odds.ts contractOdds.expectedSeconds`, added to the trip), minimum `MINER` | None: this is the pattern |
| TRANSPORT | Needs a cabin + life support, `pax >= group`, `lifeCap >= group` (group 1-6 in `cargo.passengers`). Time is mobility only, and a group above the seats is refused | Seats never change the time. No "several trips" |
| ESCORT | Needs a weapon and mobility >= 2. Time is mobility only. Combat odds already use pdf/esc/bli (`combat.resolver.ts`), and the encounter chance is ×1.5 on escort legs | Firepower/defense never change the time or the minimum |

The parts swap is already blocked while `ON_MISSION` (`parts.service.ts:231`, `scrap-part.service.ts:82`, `ships.service.ts:644`). Between accept and dispatch the ship can change, but dispatch re-checks (`:418`) and re-plans from the flight sheet.

## Rulings (owner 2026-11-26 unless marked "made here"; each can be overturned)

1. A weak ship takes LONGER: time scales with stat/need, down to a minimum ratio. Below it the mission is REFUSED with a blocker chip.
2. The minimum ratio, the exponent, the fastest factor and the per-type reference are ADMIN knobs (registry en + pt-BR; DB wins). New keys need no migration.
3. Made here: one json key per type (`specialty.escort`, `specialty.transport`), not one shared record. A new type is then a new key and needs no migration, while changing a shared key's default would need SQL.
4. Made here: TRANSPORT's stat is the passengers axis (`min(pax, lifeCap)`, as in `deriveShipProfileDetail`). A group above it is flown in trips: `factor = 2·ceil(group/have) − 1` (each extra trip goes there and back). Trips stretch TIME only: fuel, encounters and wear stay one trip.
5. Made here: ESCORT's stat is `combat = (profile.firepower + profile.defense) / 2` (0..1). Need = `reference + per_danger × peakDanger` (route danger 0..10). `factor = clamp((need/have)^exponent, fastest, ∞)`. Combat odds stay as they are, because they already follow the ship.
6. DELIVERY, RACE, RESCUE (mobility) and MINING (dig) are `built-in` rows: they are declared in the table and their behaviour does not change.
7. Defaults are first guesses for the sim to judge: `specialty.transport = { min_ratio: 0.5 }`, `specialty.escort = { min_ratio: 0.5, exponent: 0.5, fastest: 0.85, reference: 0.05, per_danger: 0.02 }`.
8. No retro-compat: the factor is computed per viewer and never stored on an offer, so there is nothing to migrate. A dispatched mission keeps its planned duration.
9. A failing sim gate is REPORTED with numbers in `docs/TODO_v0.1.5.md` item 1. No silent tuning; balance is the owner's call.

## Global Constraints

- `apps/api/src` must not import `@rustandspark/contract`. Use local types (missions.service `OfferInfo`). Parse in int-specs.
- Code in English. Every player string is in en AND pt-BR. `apps/web/src/i18n/keys.spec.ts` needs literal `t('...')` keys.
- New config keys: `game-rules.schema.ts` + `game-config.types.ts` + `game-config.defaults.ts` + `config-registry.ts` (description en + pt-BR). No migration for new keys.
- Commits only on `develop` (`git branch --show-current` before each one). Never `release/*`, `main` or `master`.
- Sims run on Node 22 (`apps/api`, `set -a; . ../../.env; set +a`). Sim day = 2 game hours. Do not re-export the snapshot after Task 1 Step 0.
- Run only the specs for the files touched. Rebuild the `worker` container before any browser check (missions resolve there).

## Review Focus

1. **Ship with 0 of the stat** (no weapon/shield, no seats): the mission is refused with the blocker, and there is no division by zero or Infinity duration. The ratio's floor is `min_ratio` (schema `min >= 0.05`). Test: Task 2 `zero stat is refused, factor finite`.
2. **Huge ship**: escort factor is clamped at `fastest`. Transport factor is 1 (never < 1). Test: Task 2 `huge ship`.
3. **Passengers + seats edge** (group 5, have 3, min 0.5): 2 trips, factor 3, met. Group 6, have 2: minimum 3, refused `PASSENGER_SEATS`. Life support short while seats are fine: refused `LIFE_SUPPORT_CAPACITY`. Test: Task 3.
4. **Ship changed between accept and dispatch**: dispatch recomputes the verdict from the flight sheet and refuses with `ESCORT_STRENGTH`. The audit `quotedSeconds` uses the card sheet's factor. Test: Task 4 int `dispatch re-checks the specialty`.
5. **time_scale and the short-trip floor / test pad**: stretch applies after the floor and before `time_scale` (`round(max(flown, floor) × stretch) × time_scale`). Starter private DELIVERY to the test pad and `referenceSeconds` stay at stretch 1. Test: Task 3 duration cases, Task 4 starter int still green.

---

### Task 1: Sim baseline, then the admin knobs

**Files:**
- Modify: `apps/api/src/config/game-rules.schema.ts` (new `specialtySchema`, key `specialty` next to `escort: escortSchema` ~444)
- Modify: `apps/api/src/config/game-config.types.ts` (`specialty` in `GameRules`, keys `'specialty.escort' | 'specialty.transport'` in the key union)
- Modify: `apps/api/src/config/game-config.defaults.ts` (block after `escort` ~453, with the Ruling 7 values)
- Modify: `apps/api/src/config/config-registry.ts` (two `type: 'json'` entries, group `specialty`)
- Test: `apps/api/test/unit/config/config-registry.spec.ts`, `game-config.service.spec.ts`

**Interfaces:**
- Produces: `rules.specialty.transport: { min_ratio: number }` and `rules.specialty.escort: { min_ratio: number; exponent: number; fastest: number; reference: number; per_danger: number }`.

- [ ] **Step 0: Sim baseline on the unchanged code** (record the commit SHA): `pnpm sim export`, then `sim/run-parallel.sh spec1-base sim/edits/none.json --temperament balanced --runs 8 --missions 300 --seed 1`. Expected: `all builds finished: spec1-base`.
- [ ] **Step 1: Failing tests.** In the registry spec: `registers specialty.escort and specialty.transport with en and pt-BR` (both keys exist, `type === 'json'`, both descriptions non-empty). In the service spec: `rejects a specialty min_ratio below 0.05 or above 1` and `rejects escort fastest above 1` (schema parse fails), plus `a DB without specialty keys falls back to the defaults` (`rules.specialty.escort.reference === 0.05`).
- [ ] **Step 2:** Run `pnpm test:unit -- config-registry game-config.service`. Expect FAIL.
- [ ] **Step 3:** Implement the schema: `min_ratio` 0.05..1, `exponent` 0..3, `fastest` 0.3..1, `reference` 0.01..1, `per_danger` 0..0.2. Add the defaults and the registry entries. Descriptions say in plain words what each knob does: "below this share of the need the ship cannot take the job", "how strongly the time follows the ship", "the fastest a strong ship can make it", "the combat strength an escort needs on a safe route", "extra strength needed per danger level".
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit `feat(config): specialty knobs for transport and escort`.

### Task 2: The table and its pure functions

**Files:**
- Create: `apps/api/src/missions/mission-specialty.ts`
- Test: `apps/api/test/unit/missions/mission-specialty.spec.ts`

**Interfaces:**
- Consumes: `deriveShipProfile`, `deriveShipProfileDetail` (`ships/ship-profile.ts`), `headCountOf` (`economy/reward.calculator.ts`), Task 1 rules.
- Produces:

```ts
export type SpecialtyStat = 'passengers' | 'combat' | 'mobility' | 'mining';
export type SpecialtyCurve = 'power' | 'trips' | 'built-in';
export interface SpecialtyRow {
  readonly stat: SpecialtyStat;
  readonly curve: SpecialtyCurve;
  readonly blocker: RequirementReasonCode | null;          // type-only import from requirements.checker
  readonly knobs: ((rules: GameRules) => SpecialtyKnobs) | null;
  readonly needOf: ((offer: SpecialtyOffer, knobs: SpecialtyKnobs) => number) | null;
}
export interface SpecialtyKnobs { readonly min_ratio: number; readonly exponent?: number; readonly fastest?: number;
  readonly reference?: number; readonly per_danger?: number }
export interface SpecialtyOffer { readonly requirements: unknown; readonly peakDanger: number } // requirements = offerRequirements(...) output
export interface SpecialtyVerdict { readonly stat: SpecialtyStat; readonly need: number; readonly have: number;
  readonly minimum: number; readonly factor: number; readonly trips: number | null; readonly met: boolean;
  readonly blocker: RequirementReasonCode }
export const SPECIALTY_TABLE: Readonly<Record<MissionType, SpecialtyRow | null>>;
export function specialtyStat(stat: SpecialtyStat, sheet: ShipSheet, rules: GameRules): number;
export function specialtyOf(type: MissionType, offer: SpecialtyOffer, sheet: ShipSheet, rules: GameRules): SpecialtyVerdict | null;
export function specialtyStretch(type: MissionType, offer: SpecialtyOffer, sheet: ShipSheet, rules: GameRules): number;
```

Rows: TRANSPORT `{passengers, trips, PASSENGER_SEATS}` with need = `headCountOf(requirements.passengers)`. ESCORT `{combat, power, ESCORT_STRENGTH}` with need = `reference + per_danger × peakDanger`. DELIVERY/RACE/RESCUE are `{mobility, built-in, null}`, MINING is `{mining, built-in, null}`, TRAVEL/SCAVENGE are `null`. `specialtyOf` returns null for `null` and `built-in` rows. `minimum = need × min_ratio` (TRANSPORT: `ceil(group × min_ratio)`). `met = have >= minimum`. Factor: `power` → `max(fastest, (need / max(have, minimum))^exponent)`. `trips` → `trips = ceil(need / max(have, minimum))`, `factor = 2·trips − 1`, and trips is null for `power`. `specialtyStretch` = the factor when met, else 1 (a refused mission is never planned).

- [ ] **Step 1: Failing tests** (build sheets with a `sheetWith({ pdf, esc, bli, pax, lifeCap })` helper over `DEFAULT_RULES`):
  - `transport: group 3 in 3 seats is one trip` → `{ factor: 1, trips: 1, met: true }`
  - `transport: group 5 in 3 seats is two trips` → `{ factor: 3, trips: 2, minimum: 3, met: true }`
  - `transport: group 6 in 2 seats is refused` → `{ met: false, minimum: 3, blocker: 'PASSENGER_SEATS' }`
  - `transport: seats without air count as the life support` → `pax 6, lifeCap 2, group 4` → `have === 2`, `trips === 2`
  - `escort: need grows with danger` → `need(10) − need(0) === 0.2` (default knobs), `toBeCloseTo`
  - `escort: weaker than the need is slower, by the exponent` → have = need/4, min_ratio overridden to 0.1 → `factor === 2`
  - `escort: huge ship is clamped at fastest` → `factor === 0.85`
  - `zero stat is refused, factor finite` (escort with pdf=esc=bli=0, and transport with pax 0) → `met false`, `Number.isFinite(factor)`
  - `built-in and trip types have no verdict` → `specialtyOf('DELIVERY'|'RACE'|'MINING'|'TRAVEL', …) === null`, `specialtyStretch(...) === 1`
  - `every MissionType has a table entry` → `Object.keys(SPECIALTY_TABLE).sort()` equals Prisma's `MissionType` values sorted
- [ ] **Step 2:** `pnpm test:unit -- mission-specialty` → FAIL (module missing).
- [ ] **Step 3:** Implement `mission-specialty.ts`, with a header comment that says how to add a type: one row, plus a knob key when it uses a curve.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(missions): the specialty table (which ship stat drives each mission type)`.

### Task 3: Duration stretch and the checklist minimum

**Files:**
- Modify: `apps/api/src/missions/duration.calculator.ts` (`MissionDurationInput.stretch?: number`)
- Modify: `apps/api/src/missions/requirements.checker.ts` (new code `ESCORT_STRENGTH`, unit `'combat'`, input `peakDanger`)
- Test: `apps/api/test/unit/missions/duration.calculator.spec.ts`, `requirements.checker.spec.ts`

**Interfaces:**
- Consumes: `specialtyOf` (Task 2).
- Produces: `missionDuration({ ..., stretch?: number })`, where `durationSeconds = round(max(flown, floor) × (stretch ?? 1)) × timeScale` and the class is computed on the result. `MissionRequirementInput.peakDanger: number` (required, so the compiler finds every caller). `RequirementReasonCode` gains `'ESCORT_STRENGTH'` (message `'The ship is too weak to protect this client.'`). `RequirementUnit` gains `'combat'`.

- [ ] **Step 1: Failing tests.**
  - Duration: `stretch multiplies after the short-trip floor and before time_scale` (distance under `short_trip_below`, stretch 3, timeScale 0.5 → `durationSeconds === shortTripMinSeconds × 3 × 0.5`). `stretch 1 or absent leaves the value unchanged` (same input, with and without it). `stretch changes the class` (600 s × 3 → `'long'` with cutoffs `{fast:600, medium:1800}`).
  - Checker: `transport needs only the minimum seats` (group 5, pax 3, lifeCap 3 → PASSENGER_SEATS `{ met: true, needed: 3 }`). `transport short on life support names it` (group 6, pax 6, lifeCap 2 → only LIFE_SUPPORT_CAPACITY unmet). `escort lists ESCORT_STRENGTH with combat units` (row `{ code: 'ESCORT_STRENGTH', unit: 'combat', needed: minimum }`, after WEAPONS and MIN_MOBILITY). `an escort with a weapon but too weak is ineligible` (`reasons` contains `ESCORT_STRENGTH`).
- [ ] **Step 2:** `pnpm test:unit -- duration.calculator requirements.checker` → FAIL.
- [ ] **Step 3:** Implement. TRANSPORT's PASSENGER_SEATS and LIFE_SUPPORT_CAPACITY `needed` both become the verdict's `minimum`. ESCORT appends `numeric(ESCORT_STRENGTH, 'combat', minimum, have)`. Fix the existing spec inputs for the new required `peakDanger` (0).
- [ ] **Step 4:** Same command → PASS. `pnpm --filter api exec tsc --noEmit` then lists every caller left without `peakDanger` (Task 4 / Task 6 fix them).
- [ ] **Step 5:** Commit `feat(missions): duration stretch and the specialty minimum in the checklist`.

### Task 4: Server wiring (offer, accept, dispatch, preview)

**Files:**
- Modify: `apps/api/src/missions/missions.service.ts` (`:340`, `:645`, `:867`, `offerInfo` `:944` estimate and `:1044` checklist; local `OfferInfo` gains `specialty`)
- Modify: `apps/api/src/missions/dispatch.service.ts` (`:418` check, `:505` planned, `:640` quoted; payload `specialtyFactor`)
- Modify: `apps/api/src/missions/engine-preview.service.ts` (`tripOf` `:198`)
- Test: `apps/api/test/integration/missions.int-spec.ts`, `dispatch.int-spec.ts`

**Interfaces:**
- Consumes: `specialtyOf`, `specialtyStretch` (Task 2), `missionDuration({stretch})`, `peakDanger` input (Task 3).
- Produces: board row `info.specialty: { stat, need, have, minimum, factor, trips, met } | null` (null for built-in types or without a ship). `info.estimate.durationSeconds` includes the factor. Engine-preview `trip.durationSeconds` and `baseline.durationSeconds` include it. The dispatch event payload carries `specialtyFactor`.

`peakDanger` = `max(leg.danger ?? 0)` over the offer's legs (offerInfo already computes it). The offer passed to specialty is `{ requirements: offerRequirements(template, cargo), peakDanger }`, built once per row.

- [ ] **Step 1: Failing int tests.**
  - missions: `a transport above the seats shows trips and a longer estimate` (seed a TRANSPORT offer with `cargo.passengers = 4` and a ship with 2 seats + 2 lifeCap → `info.specialty.trips === 2`, `info.estimate.durationSeconds` within `time_scale` seconds of 3 × the same offer's estimate for a 4-seat ship (the stretch rounds once), and `eligibility.eligible === true`).
  - missions: `a weak escort is refused with ESCORT_STRENGTH` (ship with one weapon and no shield on a danger-10 route → `eligibility.reasons` contains `ESCORT_STRENGTH`, and the accept POST answers 409 with that reason).
  - dispatch: `dispatch plans the stretched time` (accepted transport as above → `mission.dispatch` event `plannedSeconds === quotedSeconds`, `specialtyFactor === 3`).
  - dispatch: `dispatch re-checks the specialty` (accept an escort with a strong ship, unequip its shield in port, dispatch → 409 `ESCORT_STRENGTH`).
  - Parse every response with the contract schema inside the spec (int-specs may import the contract).
- [ ] **Step 2:** Bring up the int-test stack (memory `feedback_targeted_tests.md`), then `pnpm test:int -- missions dispatch` → FAIL.
- [ ] **Step 3:** Wire the calls. Every `missionDuration` call for a mission gets `stretch: specialtyStretch(...)`. `travel.service.ts` and `referenceSeconds` stay unstretched (comment: "no specialty: a trip / the reference ship meets every need").
- [ ] **Step 4:** Same command → PASS. Also run `pnpm test:int -- starter-mission board` (the starter test-pad DELIVERY and the private takeable draft must stay unchanged).
- [ ] **Step 5:** Commit `feat(missions): offers, accept, dispatch and engine preview follow the ship's specialty`.

### Task 5: Contract and web

**Files:**
- Modify: `packages/contract/src/index.ts` (`RequirementCheckSchema.unit` + `'combat'`, `OfferInfoSchema.specialty` optional nullable)
- Modify: `apps/web/src/features/board/contract-face.tsx` (`number()` ~59, meta row ~148), `mission-card.tsx` (`requirementNumber` ~61, duration block ~349), `requirement-fix.ts` (`ESCORT_STRENGTH: 'WEAPON'`)
- Modify: `apps/web/src/i18n/en.json`, `pt-BR.json` (every block that lists `PASSENGER_SEATS`: `board.reasons`, `board.requirements` and the third list ~2681; new `board.specialty.*`)
- Modify: `apps/web/src/test/msw/handlers.ts` (one transport row with `specialty`)
- Test: `apps/web/src/features/board/contract-face.spec.tsx`, `requirement-fix.spec.ts`

**Interfaces:**
- Consumes: Task 4 `info.specialty`.
- Produces: keys `board.specialty.slower` ("{{pct}}% slower for your ship" / "{{pct}}% mais lenta para a sua nave"), `board.specialty.faster` ("{{pct}}% faster for your ship" / "{{pct}}% mais rápida para a sua nave"), `board.specialty.trips_one` / `_other` ("{{count}} trip" / "{{count}} trips"; "{{count}} viagem" / "{{count}} viagens"), and `ESCORT_STRENGTH` labels ("Combat strength (weapons and shields) for this escort" / "Força de combate (armas e escudos) para esta escolta"). The 'combat' unit shows as a percent: `Math.round(value × 100)%`.

Line rule: no line when `specialty` is null or `factor === 1`. With `trips > 1`, show the trips label. Otherwise `pct = round(|factor − 1| × 100)`, slower when `factor > 1`, faster when < 1.

- [ ] **Step 1: Failing tests.** contract-face: `shows the trips line for a transport above the seats` (factor 3, trips 2 → text "2 trips"). `shows faster for a strong escort` (factor 0.85 → "15% faster for your ship"). `shows nothing when the ship meets the need exactly` (factor 1 → no `board.specialty` text). `ESCORT_STRENGTH renders as a blocker chip with percent numbers` (needed 0.125, actual 0.06 → "6%" and "13%"). requirement-fix: `ESCORT_STRENGTH is fixed at the weapon store` → `{ kind: 'store', partClass: 'WEAPON' }`.
- [ ] **Step 2:** `pnpm --filter web test -- contract-face requirement-fix` → FAIL.
- [ ] **Step 3:** Implement. Use literal keys (`t('board.specialty.trips', { count })`, `t('board.specialty.slower', { pct })`, `t('board.specialty.faster', { pct })`) so `keys.spec.ts` sees them.
- [ ] **Step 4:** `pnpm --filter web test -- contract-face requirement-fix keys` → PASS. `pnpm --filter @rustandspark/contract build` passes.
- [ ] **Step 5:** Browser check at 1280 and 390 px (memory `reference_browser_smoke_local.md`, worker rebuilt): a transport with trips and a weak escort's red chip, in en and pt-BR, with no horizontal scroll. Grep the e2e for changed literals (`grep -rn "PASSENGER_SEATS\|Mobility above the escort" apps/web/e2e`) and run `pnpm --filter web test:e2e`.
- [ ] **Step 6:** Commit `feat(web): mission cards say how the ship's specialty changes the time, and why it cannot take the job`.

### Task 6: Sim mirror, the gate, docs

**Files:**
- Modify: `apps/api/sim/actions/mission.ts` (`:91` `peakDanger`, `:240` `stretch`), `sim/bots/temperament.ts` (`:50` `stretch`), `sim/core/world.ts` (`:364` `peakDanger`)
- Create: `apps/api/sim/edits/specialty-v1.json` (`{ "rules": { "specialty": <the Ruling 7 defaults> } }`: the Step 0 snapshot predates the keys)
- Modify: `docs/TODO_v0.1.5.md` (item 1 status), `docs/superpowers/plans/2026-11-23-v0.1.5-roadmap.md` (if it lists item 1)

**Interfaces:**
- Consumes: `specialtyOf`, `specialtyStretch`, `missionDuration({stretch})`, `MissionRequirementInput.peakDanger`.

- [ ] **Step 1:** Wire the sim calls the same way as Task 4 (`peakDanger` = max leg danger of `offer.legs`). `pnpm --filter api exec tsc -p sim --noEmit` (or the sim's own typecheck script) is clean.
- [ ] **Step 2:** `sim/run-parallel.sh spec1-new sim/edits/specialty-v1.json --temperament balanced --runs 8 --missions 300 --seed 1`.
- [ ] **Step 3: Compare.** Run `python3 sim/compare.py base=spec1-base-% new=spec1-new-%` and `python3 sim/levels.py "base=spec1-base-%-edit" "new=spec1-new-%-edit"`. Net credits per game hour per build: `select cell, 3600.0*avg(reward+fuel+repair)/avg(total_seconds) from runs where experiment_id in (<ids>) group by cell` on `sim-data/sim.db`. Also count TRANSPORT and ESCORT taken per build, base vs new (the shift this slice causes). **Pass:** for every build (chem, chem-shield, ion-shield, hybrid), net credits/hour >= 95% of `spec1-base`, L2day/L3day no more than 10% later than `spec1-base`, and no new stalls. ion-shield (~11-13% late) and chem (borderline) are judged against this fresh baseline, not the pre-2.1 one.
- [ ] **Step 4: Report, never tune.** Write the measured table into item 1's status: per build credits/h base→new (%), L2/L3 day delta, stalls, transport/escort counts, and the experiment labels. On a fail, mark it "gate fails: owner's call" and name the knob most likely to move it (e.g. `specialty.escort.reference`). Do not change any default.
- [ ] **Step 5:** Commit `feat(sim): the sim follows the ship's specialty; gate result for item 1` (only the sim files, the edit file and the docs).

---

**Adding a type later** (fuel/tank transport, explore, repair, fight): add one row to `SPECIALTY_TABLE`, a `specialty.<type>` registry key if it uses `power` or `trips`, the blocker code's en/pt-BR labels and its `requirement-fix` target, and a new `SpecialtyStat` case in `specialtyStat` only when the axis is new. No caller changes.
