# Tank Cargo Missions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new mission type `TANK` carries water, chemicals or fuel. Each kind needs a cargo tank of that kind: a new part family (3 kinds x 3 sizes x 5 tiers). A load above the tanks' capacity flies in trips. Fuel carried as cargo is never burnt by the ship.

**Architecture:** Cargo tanks are `CARGO`-class parts with `specialProp.tankKind` + `specialProp.tankCap`, read like `pax`/`lifeCap`. The ship sheet gets three flat capacities (`tankWater`, `tankChemicals`, `tankFuel`). `TANK` is one new `SPECIALTY_TABLE` row (stat `tank`, curve `trips`, blocker `TANK_KIND`, knob `specialty.tank`). An offer draws its kind and volume into `cargo.tank`. The pay is `rewardBase` plus `volume x missions.tank_unit_pay[kind]`, carried through the dispatch snapshot into the resolver's existing `cargoExtra`, so a failed or lost run pays zero.

**Tech Stack:** NestJS + Prisma (`apps/api`), Jest unit/int, React + Vitest (`apps/web`), zod contract (`packages/contract`), sim (`apps/api/sim`, Node 22).

**Spec:** `docs/TODO_v0.1.5.md` item 5b ("Tank cargo", owner 2026-11-23). The owner's 2026-11-26 "Go ahead and propose those" (kinds and sizes) means the Rulings below are proposals. The mechanism is the "Adding a type later" section of `docs/superpowers/plans/2026-11-26-missions-follow-ship-specialty.md`.

## Gap analysis (read 2026-11-26 on develop @ 23f081c2)

- **Catalog** (`prisma/seed-data/parts.ts`): `FAMILIES` with five tiers each. A tier is `base` + rarity suffix (the upgrade follows that naming). Fuel tanks are `TANK` class: `tank_small` 1x1 (fuelCap 300/375/450/525/600, price 2000/3200/5100/8200/13000), `tank_medium` 2x1 (600..1200, 4000/6400/10000/16500/26000), `tank_large` 3x1 (900..1800, 6000/9600/15500/24500/39500) and `tank_huge` 2x2. Each has energyCont -1 and scrapValue = price/40. Cargo holds are `cargo` 1x1 (crg 5..13, 800..12000), `cargo_large` 1x2 and `cargo_bay` 2x2. The cabin is a `CARGO`-class part whose stats live in `specialProp` (`pax`), read by `pickCatalogStats` (`parts/parts.service.ts:77`).
- **Seeding:** `seedParts` and `seedMissionTemplates` insert every MISSING row by id (not only into empty tables). The `migrate` image runs `prisma migrate deploy && prisma db seed` on every deploy (`docker/api.Dockerfile:36`), so new parts and templates arrive through the seed. `seedQuestGivers` never touches an existing giver, so giver weights need SQL. A new enum value needs `ALTER TYPE ... ADD VALUE`, which cannot be used in the same transaction (see `0023_mission_type_travel`).
- **Fuel:** ship fuel is `sheet.fuelCap` (sum of live parts' `fuelCap`), refuel and `storedFuel` (`ships.service.ts:779`) read `partCatalog.fuelCap`, and burn reads `fuelUse`. A part with `fuelCap` 0 is never filled, never burnt and never stores fuel.
- **Hold** (`ships/hold.ts`): spare parts take one slot each (`ship.spare_part_slots`). Only mission cargo and ore use `crg`. Parts are locked while `ON_MISSION` (`parts.service.ts:231`). Dispatch re-checks requirements on the current sheet (`dispatch.service.ts:419`).
- **Generator:** `fillMission` (`generator/template.filler.ts:542`) picks templates by origin faction/type. `cargo` is per type (passengers, race, mining). `rewardBase` follows distance/danger/`reward_type_bonus[type]` (falls back to 1). `missionReward` is the board/accept figure. The resolver re-derives the base and adds `cargoExtra` before integrity, only on success (`mission.resolver.ts:318-342`).
- **Board:** a type that is not in `missions.board_core_types` is an extra that is drawn only when a template matches. With a giver, only types the giver weighs (`giver.picker.ts:25`) are drawn, and `giverShapeOf` drops types missing from `MISSION_TYPES` (`:97`).
- **Web:** `missionKind` glyphs are `Record<MissionType>` (`board/mission-kinds.tsx`). `fixOf` maps blocker to store class (`requirement-fix.ts`). Part art is the `PartArt` placeholder keyed by `partKindOf` prefix (`parts/part-kind.ts`). `holdFigureOf` drives the hold view (`hangar/hold-load.ts`).

## Rulings (proposed here for the owner; each can be overturned)

1. **Kinds:** `WATER`, `CHEMICALS`, `FUEL`. A part holds ONE kind (separate families per kind).
2. **Sizes:** the fuel tank's 1x1 / 2x1 / 3x1 (`small` / `medium` / `large`), no 2x2. All five tiers, COMMON..LEGENDARY. Family bases: `cargo_tank_<kind>_<size>`, for example `cargo_tank_water_small_rare`.
3. **Capacity** (units, the same for every kind) = the fuel tank's `fuelCap / 30`, rounded: small 10/13/15/18/20, medium 20/25/30/35/40, large 30/38/45/53/60.
4. **Stats and prices:** mass, structureCost, partHp and energyCont are copied from the fuel tank of the same size and tier. Price = the fuel tank price x a kind factor: water 0.8, fuel 1.0, chemicals 1.2. So the small COMMON tank costs 1600 / 2000 / 2400, the large LEGENDARY 31600 / 39500 / 47400. scrapValue = round(price / 40), as fuel tanks. `fuelCap` 0, `crg` 0.
5. **Slot:** the part is `CARGO` class (like the passenger cabin). No new `PartClass`, no new store tab and no new icon tab. Its load does NOT take cargo space (`crg`), and a loose tank takes one spare slot like any part. The load lives on the mission, never on the part: selling or scrapping an empty tank loses nothing, and between missions there is nothing in it.
6. **Mission variant:** a new `MissionType` `TANK`, not `cargo.tankKind` on DELIVERY. The specialty table, the board filters, the givers' weights and `reward_type_bonus` are all keyed by type. A DELIVERY branch would split one row in two and touch every cargo-mode caller.
7. **Need and curve:** need = `cargo.tank.volume`, stat = the ship's live capacity of that kind, curve `trips` (time only). Below `specialty.tank.min_ratio` (default 0.25, as delivery) the job is refused with `TANK_KIND`.
8. **Pay:** `rewardBase` (type bonus `tank`, falls back to 1: no change to the stored record) + `volume x missions.tank_unit_pay[kind]`. The default is `{ water: 60, fuel: 100, chemicals: 150 }`. Per cell this matches today's open cargo (200/crg x 5 crg = 1000 per 1x1 hold; a small fuel tank, 10 x 100 = 1000), with water cheaper and chemicals dearer like their parts. The extra rides `cargoExtra`, so integrity, the short-trip factor and "a lost fight pays zero" apply as for DELIVERY. Trips do not change pay.
9. **Who posts:** one template per kind, volume drawn per offer: WATER from Explorers (`outpost`, `frontier`, `relay`; 15-40), CHEMICALS from Luna (`port`, `shipyard`; 8-24), FUEL from Sun (`garrison`, `port`, `junction`; 20-50). The givers `luna_clerk_anselm`, `sun_fixer_zara` and `explorers_scout_pip` get `TANK: 10`. Encounter policy `missionForcesFlee` (a hauler), and `objectCarried` true.
10. **Board:** TANK is NOT a core type. It is an extra that appears when the place has a template and a giver weighs it.
11. **Fuel as cargo:** it never feeds the ship. An ion ship with no fuel tank can carry it, and a chemical ship whose only tank is a cargo FUEL tank still gets `NO_FUEL_CAPACITY`. The cargo mass is ignored (as for crg cargo today).
12. **Art:** the placeholder `PartArt`, with a new kind `cargoTank` that reuses the tank glyph. Real art is the last task and never blocks.

## Global Constraints

- `apps/api/src` must not import `@rustandspark/contract`. Use local types, and parse responses in int-specs.
- Code in English. Every player string is in en AND pt-BR. `apps/web/src/i18n/keys.spec.ts` needs literal `t('...')` keys.
- No mission retro-compat: old offers expire, with no legacy branches or tests.
- Admin owns every tunable. New keys go in `game-rules.schema.ts` + `game-config.types.ts` + `game-config.defaults.ts` + `config-registry.ts` (en + pt-BR descriptions). DB wins, and new keys need no migration.
- Commits only on `develop`. Run `git branch --show-current` before each one. Never `release/*`, `main` or `master`.
- Run only the specs for the touched files (`pnpm test:unit -- <names>`, int stack per memory). Rebuild api AND worker before any browser check.
- Sims on Node 22 in `apps/api` (`set -a; . ../../.env; set +a`).

## Review Focus

1. **Two tanks of different kinds** (water 20 + chemicals 13): a WATER offer sees 20, never 33. Test: Task 2 `sums capacity per kind`, Task 3 `a chemicals tank does not count for water`.
2. **Load above or below the capacity** (volume 25, water 10): 3 trips, factor 5, met. Volume 50, water 10 (minimum 12.5): refused `TANK_KIND`. A dead tank counts 0. Test: Task 2 and Task 3.
3. **Partly used hold / ion ship:** a TANK mission adds nothing to `crg` use (`hold.used` 0). An ion ship (fuelUse 0, no fuel tank) with a FUEL cargo tank dispatches without `FUEL_EMPTY`. Test: Task 5 int `tank load takes no cargo space; ion ship carries fuel`.
4. **Tank swapped or sold after accept:** dispatch refuses with `MISSION_REQUIREMENTS_NOT_MET` / `TANK_KIND`, and a sold or scrapped empty tank has `storedFuel` 0. Test: Task 5 int `dispatch re-checks the tank`.
5. **Lost cargo:** a failed or lost-fight TANK run pays 0 (no `cargoExtra`). Test: Task 5 `a failed tank run pays nothing`. **Board mix:** core types are still posted when TANK templates exist. Test: Task 4 `tank stays an extra`.

---

### Task 1: Sim baseline, then the knobs

**Files:**
- Modify: `apps/api/src/config/game-rules.schema.ts` (`specialtyTankSchema` next to `specialtyDeliverySchema:319`; `tank_unit_pay` in the missions schema), `game-config.types.ts` (keys `'specialty.tank'`, `'missions.tank_unit_pay'`), `game-config.defaults.ts` (`specialty.tank: { min_ratio: 0.25 }`, `missions.tank_unit_pay: { water: 60, chemicals: 150, fuel: 100 }`), `config-registry.ts` (2 entries)
- Test: `apps/api/test/unit/config/config-registry.spec.ts`, `game-config.service.spec.ts`

**Interfaces:** Produces `rules.specialty.tank: { min_ratio: number }` and `rules.missions.tank_unit_pay: Readonly<Record<string, number>>` (lower-case kind keys).

- [ ] **Step 0: Baseline on the unchanged code** (record the SHA): `pnpm sim export && cp sim-data/snapshot.json sim-data/snapshot-tank-base.json`, then `sim/run-parallel.sh tank-base sim/edits/none.json --temperament balanced --runs 8 --missions 300 --seed 1`. Expected: `all builds finished: tank-base`.
- [ ] **Step 1: Failing tests.** `registers specialty.tank and missions.tank_unit_pay with en and pt-BR` (json type, non-empty descriptions). `rejects a tank min_ratio below 0.05` and `rejects a negative tank unit pay`. `a DB without the keys falls back to the defaults` (`rules.missions.tank_unit_pay.fuel === 100`).
- [ ] **Step 2:** `pnpm test:unit -- config-registry game-config.service` → FAIL.
- [ ] **Step 3:** Implement. `min_ratio` 0.05..1, unit pay a record of numbers >= 0. Descriptions: "Tank cargo jobs. min_ratio: below this share of the volume the ship's tanks of that kind cannot take the job; a volume above them is flown in trips (time only)" and "Credits per unit of tank cargo delivered, by kind (water, chemicals, fuel)", with pt-BR equivalents.
- [ ] **Step 4:** Run the same command → PASS. **Step 5:** Commit `feat(config): knobs for tank cargo jobs`.

### Task 2: Cargo-tank parts and the ship's tank capacity

**Files:**
- Create: `apps/api/src/parts/tank-kind.ts`
- Modify: `apps/api/src/parts/part.types.ts` (`tankKind: TankKind | null`, `tankCap: number`), `parts/parts.service.ts:77` (`pickCatalogStats`), `ships/sheet.types.ts` + `ships/sheet.deriver.ts` (three sheet fields), `prisma/seed-data/parts.ts` (`SeedPart.specialProp.tankKind/tankCap`, families generated from the fuel tanks), `admin/tuning/entity-schemas.ts:353` (specialProp description en + pt-BR adds `tankKind`, `tankCap`)
- Fix: every `ShipSheet` literal the compiler flags (add the three fields as 0)
- Test: `test/unit/parts/tank-kind.spec.ts`, `test/unit/ships/sheet.deriver.spec.ts`, create `test/unit/parts/cargo-tank-catalog.spec.ts`; `part-descriptions.spec.ts` and `tier-footprint.spec.ts` must stay green

**Interfaces:**
- Produces: `type TankKind = 'WATER' | 'CHEMICALS' | 'FUEL'`, `TANK_KINDS: readonly TankKind[]`, `tankKindOf(value: unknown): TankKind | null`, `tankCapacityOf(sheet: ShipSheet, kind: TankKind | null): number`. `ShipSheet.tankWater/tankChemicals/tankFuel: number` (live parts only).

- [ ] **Step 1: Failing tests.** `tankKindOf` gives `'WATER'` for `'WATER'` and null for `'water'`, `'OIL'`, 3 and undefined. `sums capacity per kind` (water 10 + water 20 + chemicals 13 gives tankWater 30, tankChemicals 13, tankFuel 0). `a dead tank holds nothing`. `a cargo fuel tank adds no fuelCap` (fuelCap 0, autonomy unchanged). Seed: `cargo tank families: 3 kinds x 3 sizes x 5 tiers` (45 rows, partClass CARGO, `cargo_tank_fuel_large_legendary` has tankCap 60, price 39500, scrapValue 988; `cargo_tank_water_small` 1x1 price 1600 tankCap 10; `cargo_tank_chemicals_medium` 2x1 price 4800). `every cargo tank copies its fuel tank's mass, structure and hp`.
- [ ] **Step 2:** `pnpm test:unit -- tank-kind sheet.deriver cargo-tank-catalog part-descriptions tier-footprint` → FAIL.
- [ ] **Step 3:** Implement. `pickCatalogStats` reads `tankKind` with `tankKindOf(specialProp.tankKind)` and `tankCap` with `readNumber`, and gives 0 when the kind is null. In the seed, `cargoTankFamily(kind: TankKind, fuel: Family, priceFactor: number, size: 'small'|'medium'|'large'): Family` maps each tier as Rulings 2-4 state, and `FAMILIES` gets the 9 generated families. Names: en "Small Water Tank" / "Small Chemical Tank" / "Small Fuel Cargo Tank" (Medium/Large), pt-BR "Tanque de Água Pequeno" / "Tanque Químico Pequeno" / "Tanque de Carga de Combustível Pequeno" (Médio/Grande). Descriptions say "carries water for tank jobs; it never feeds the ship" (pt-BR too). The fuel kind says "fuel carried as cargo is never burnt by the ship".
- [ ] **Step 4:** Same command → PASS. Then `pnpm --filter api exec tsc --noEmit`, clean.
- [ ] **Step 5:** Commit `feat(parts): cargo tanks for water, chemicals and fuel`.

### Task 3: The TANK type and its specialty row

**Files:**
- Create: `apps/api/prisma/migrations/20261126120000_tank_cargo_missions/migration.sql`
- Modify: `prisma/schema.prisma:198` (`TANK` in `MissionType`), `missions/mission-specialty.ts` (stat `'tank'`, row `TANK`, `specialtyStat(stat, sheet, rules, offer?)`), `missions/requirements.checker.ts` (`'TANK_KIND'` code + reason, `case 'TANK'`, unit `'tank'`, `offerRequirements` passes `cargo.tank`), `generator/giver.picker.ts:97`, `admin/tuning/entity-tuning.service.ts:21`, `admin/tuning/entity-schemas.ts:136`, `resolution/encounter/encounter-policy.ts:7` (add `'TANK'`), `missions/resolution-input.ts:27` (`OBJECT_CARRIED_TYPES` adds `'TANK'`)
- Test: `test/unit/missions/mission-specialty.spec.ts`, `requirements.checker.spec.ts`, `test/integration/tank-cargo-migration.int-spec.ts`

**Interfaces:**
- Consumes: `tankKindOf`, `tankCapacityOf` (Task 2), `rules.specialty.tank` (Task 1).
- Produces: `SPECIALTY_TABLE.TANK = { stat: 'tank', curve: 'trips', blocker: 'TANK_KIND', wholeUnits: false, knobs: r => r.specialty.tank, needOf: volume of requirements.tank }`. `offerRequirements(t, cargo)` returns `{ ...t, passengers, tank? }`, with `tank` only when `cargo.tank` is an object. `RequirementUnit` adds `'tank'`.

- [ ] **Step 1: Failing tests.** Specialty: `tank: 25 water in 10 is three trips` (trips 3, factor 5, met). `tank: 50 water in 10 is refused with TANK_KIND` (minimum 12.5). `a chemicals tank does not count for water` (have 0). `a tank offer with no kind has a zero stat` (have 0, factor finite). Checklist: `TANK lists TANK_KIND with unit tank, needed = minimum, actual = capacity of that kind`. `offerRequirements keeps cargo.tank` and `adds no tank key without one` (the existing toEqual cases still pass). Int (migration): `the migration adds TANK and weighs it for the three givers` and `running it twice changes nothing`. The weight an admin already set is kept.
- [ ] **Step 2:** `pnpm test:unit -- mission-specialty requirements.checker` → FAIL.
- [ ] **Step 3:** Migration, idempotent: `ALTER TYPE "MissionType" ADD VALUE IF NOT EXISTS 'TANK';` then for `luna_clerk_anselm`, `sun_fixer_zara`, `explorers_scout_pip`: `UPDATE "QuestGiver" SET "personality" = jsonb_set("personality", '{types,TANK}', '10') WHERE "id" = ... AND NOT ("personality"->'types' ? 'TANK');`. The header comment says parts and templates come from the insert-only seed. Then `pnpm prisma migrate dev` (dev DB) and the code above. `TANK_KIND` message: "The ship has no tank of this kind, or too small a one."
- [ ] **Step 4:** Unit command → PASS; `pnpm test:int -- tank-cargo-migration` → PASS.
- [ ] **Step 5:** Commit `feat(missions): the TANK type follows the ship's tanks of its kind`.

### Task 4: Templates and offers

**Files:**
- Create: `apps/api/src/missions/tank-cargo.ts`
- Modify: `generator/template.filler.ts:703` (cargo for TANK), `prisma/seed-data/mission-templates.ts` (3 templates; `encounterPolicy` flee for `TANK` too), `prisma/seed-data/quest-givers.ts` (`TANK: 10` on the three givers, to match the migration)
- Test: `test/unit/missions/tank-cargo.spec.ts`, `template.filler.spec.ts`, `board-composition.spec.ts`

**Interfaces:**
- Produces: `interface TankLoad { kind: TankKind; volume: number }`, `drawTankLoad(requirements: unknown, rng: Rng): TankLoad | null` (kind from `tankKind`, integer volume in `[volumeMin, volumeMax]`, null on a bad kind or range), `tankLoadOf(cargo: unknown): TankLoad | null`, `tankPay(load: TankLoad | null, rules: GameRules): number` (= `volume x tank_unit_pay[kind.toLowerCase()] ?? 0`).
- Template requirements shape: `{ originFactions, originTypes, tankKind, volumeMin, volumeMax }`. Offer cargo: `{ tank: { kind, volume } }`.

- [ ] **Step 1: Failing tests.** `drawTankLoad` is deterministic for a seed, stays within `[15, 40]`, and gives null for `tankKind: 'OIL'` or `volumeMin > volumeMax`. `tankPay` of 20 FUEL at the defaults is 2000, and of an unknown kind 0. Filler: `a TANK template at an Explorers outpost posts cargo.tank WATER`. `a TANK template with a bad kind is never posted` (skip it, not throw: filter out in `eligibleTemplates`). Board: `tank stays an extra` (`requiredTypes` with TANK in reach gives the 4 core + races, no TANK).
- [ ] **Step 2:** `pnpm test:unit -- tank-cargo template.filler board-composition` → FAIL.
- [ ] **Step 3:** Implement. The seed ids are `tank_explorers_water`, `tank_luna_chemicals` and `tank_sun_fuel` (Ruling 9 values), with en + pt-BR names and descriptions such as "Haul water to a dry outpost" / "Leve água a um posto seco".
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(missions): water, chemicals and fuel tank offers`.

### Task 5: Pay, dispatch and resolution

**Files:**
- Modify: `missions/mission.reward.ts` (adds `tankPay(tankLoadOf(cargo)) x shortTripFactor`), `missions/dispatch.service.ts:58/550` (`DispatchSnapshot.tank?: { kind; volume; unitPay }`), `missions/resolution-input.ts:378` (`cargoExtra = volume x unitPay` from `snapshot.tank`)
- Test: `test/unit/missions/mission.reward.spec.ts`, `test/unit/resolution/mission.resolver.spec.ts`, `test/integration/dispatch.int-spec.ts`

**Interfaces:**
- Consumes: `tankLoadOf`, `tankPay` (Task 4).
- Produces: the snapshot's `tank` block (kept for replays). The board figure equals the success payout at integrity 100.

- [ ] **Step 1: Failing tests.** `the board figure of a TANK offer adds volume x unit pay` (base + 2000 for 20 FUEL). `a successful tank run pays base + extra x integrity`. `a failed tank run pays nothing` (status failure → no `mission_payout`, credits 0). Int: `tank load takes no cargo space; ion ship carries fuel` (hold.used 0, an ion ship with only `cargo_tank_fuel_small` dispatches a FUEL job of 10). `dispatch re-checks the tank` (accept with a water tank, uninstall it, dispatch → 400 `MISSION_REQUIREMENTS_NOT_MET` with `TANK_KIND`; the tank's `storedFuel` stays 0). `a chem ship with only a cargo fuel tank is NO_FUEL_CAPACITY`.
- [ ] **Step 2:** `pnpm test:unit -- mission.reward mission.resolver` and `pnpm test:int -- dispatch` → FAIL.
- [ ] **Step 3:** Implement. `unitPay` is frozen at dispatch from the rules. Trips never scale the pay.
- [ ] **Step 4:** Same commands → PASS.
- [ ] **Step 5:** Commit `feat(missions): tank jobs pay by the unit delivered; a lost run pays nothing`.

### Task 6: The contract and the offer info

**Files:**
- Modify: `packages/contract/src/index.ts` (`MissionTypeSchema` adds `'TANK'`; `TankKindSchema`; `PartCatalogStatsSchema.tankKind: TankKindSchema.nullable().default(null)`, `tankCap: z.number().default(0)`; `ShipSheetSchema.tankWater/tankChemicals/tankFuel: z.number().default(0)`; `RequirementCheckSchema.unit` adds `'tank'`; `OfferInfo.specialty.stat` adds `'tank'`; `OfferInfo.tank: z.object({ kind: TankKindSchema, volume: z.number(), unitPay: z.number() }).nullable().optional()`), `apps/api/src/missions/missions.service.ts:90/1169` (local `OfferInfo.tank`)
- Test: `test/integration/contract.int-spec.ts`, `board.int-spec.ts`

- [ ] **Step 1: Failing tests.** `a TANK offer parses with info.tank and specialty stat tank`. `a catalog cargo tank parses with tankKind and tankCap`. `the ship sheet carries the tank capacities`.
- [ ] **Step 2:** `pnpm test:int -- contract board` → FAIL.
- [ ] **Step 3:** Implement. `info.tank` is null on every other type.
- [ ] **Step 4:** Same command → PASS, and `pnpm --filter @rustandspark/contract typecheck` is clean.
- [ ] **Step 5:** Commit `feat(contract): tank offers, cargo tank parts and the ship's tanks`.

### Task 7: Web (card, chip, hold view, store, part placeholder)

**Files:**
- Create: `apps/web/src/features/board/tank-kind-label.ts` (`tankKindLabel(kind, t)`: a switch of literal keys `board.tank.water|chemicals|fuel`)
- Modify: `board/mission-kinds.tsx` (`TANK` glyph: a droplet, `MISSION_KIND_ORDER` after DELIVERY), `board/mission-card.tsx:165` (line `board.tank.load`), `board/requirement-fix.ts` (`TANK_KIND: 'CARGO'`), `board/requirement-number.ts` (unit `tank` needed rounded up like cargo), `hangar/hold-load.ts` (`HoldFigure` adds `{ kind: 'tank'; tankKind; volume; capacity }`), `hangar/hold-panel.tsx` (`hangar.holdView.usageTank`), `parts/part-kind.ts` (kind `cargoTank`, prefix `cargo_tank_` BEFORE `cargo`), `parts/part-kind-icon.tsx` (`cargoTank` reuses the tank glyph), `parts/part-detail.tsx:434` (flag `parts.flag.tankWater|tankChemicals|tankFuel`), `hangar/ship-sheet-panel.tsx` (rows `tankWater`, `tankChemicals`, `tankFuel`, group cargo, shown when > 0), `i18n/en.json` + `pt-BR.json` (`board.type.TANK`, `board.reasons.TANK_KIND`, `board.requirements.TANK_KIND`, `error.TANK_KIND`, `board.tank.*`, `hangar.holdView.usageTank`, `hangar.partKinds.cargoTank`, `hangar.stats.tank*`, `parts.flag.tank*`)
- Test: `mission-kinds.spec.tsx`, `contract-face.spec.tsx`, `requirement-fix.spec.ts`, `hold-load.spec.ts`, `part-kind.spec.ts`, `i18n/keys.spec.ts`

- [ ] **Step 1: Failing tests.** `missionKind('TANK')` has `board.type.TANK`. `the card says 25 units of water at 60 per unit`. `TANK_KIND fixes in the CARGO store tab`. `holdFigureOf a TANK mission is the tank figure, cargo used 0`. `partKindOf cargo_tank_water_small is cargoTank` and `cargo_large is still cargo`. keys.spec stays green in both locales.
- [ ] **Step 2:** `pnpm --filter web test -- mission-kinds contract-face requirement-fix hold-load part-kind keys` → FAIL.
- [ ] **Step 3:** Implement with literal keys. Copy, en: "Carries {{volume}} units of {{kind}} · {{pay}} per unit"; "Needs a {{kind}} tank (at least {{needed}})". pt-BR: "Leva {{volume}} unidades de {{kind}} · {{pay}} por unidade"; "Precisa de um tanque de {{kind}} (pelo menos {{needed}})".
- [ ] **Step 4:** Same command → PASS. Browser check at 1280 and 390 px, en and pt-BR (memory `reference_browser_smoke_local.md`, api + worker rebuilt, `migrate` run): a water offer, its red chip on a ship without a tank, the chip after buying `cargo_tank_water_small`, trips on the card, and the hold view in flight. No horizontal scroll. Grep the e2e for changed literals (`grep -rn "board.type\|MISSION_KIND_ORDER" apps/web/e2e`), then run `pnpm --filter web e2e`.
- [ ] **Step 5:** Commit `feat(web): tank jobs on the board, the hold view and the store`.

### Task 8: Sim mirror, gate, docs

**Files:**
- Modify: `apps/api/sim/snapshot/types.ts:24` (`'TANK'`), `sim/bots/playstyle.ts:24` (`HAULER_TYPES` adds `'TANK'`), `docs/TODO_v0.1.5.md` (item 5b status), `GLOSSARY.md` (Cargo tank, Tank job)

- [ ] **Step 1:** `pnpm --filter api exec tsc -p sim --noEmit` is clean. The sim already reuses `fillMission`, `offerRequirements`, `specialtyStretch`, `missionReward` and `buildResolveInput`, so it needs no math of its own.
- [ ] **Step 2:** After `migrate` + seed on the dev DB, run `pnpm sim export`. Copy `takenAt` from `sim-data/snapshot-tank-base.json` into the new snapshot (market shelves follow the date). Run `sim/run-parallel.sh tank-new sim/edits/none.json --temperament balanced --runs 8 --missions 300 --seed 1`.
- [ ] **Step 3: Compare** with `python3 sim/compare.py base=tank-base-% new=tank-new-%` and `python3 sim/levels.py "base=tank-base-%-edit" "new=tank-new-%-edit"`. Also count the TANK offers seen and taken per build in `sim-data/sim.db`. **Pass:** for every build (chem, chem-shield, ion-shield, hybrid), net credits/h >= 95% of base, L2/L3 day no more than 10% later, no new stalls. The bots' kits have no cargo tank, so expect 0 TANK taken (as TRANSPORT for seatless kits): the gate guards against regressions, chiefly TANK offers taking board slots from jobs the bots can do.
- [ ] **Step 4: Report, never tune.** Write the table (credits/h %, L2/L3 delta, stalls, TANK seen/taken, labels) into item 5b. On a fail, write "gate fails: owner's call" and name the likely knob (giver `TANK` weight, `tank_unit_pay`).
- [ ] **Step 5:** Commit `feat(sim): the sim knows tank jobs; gate result for item 5b`. Deploy note in item 5b: run migration `20261126120000_tank_cargo_missions` (migrate also seeds the parts and templates), rebuild api AND worker, re-export the sim snapshot.

### Task 9: Part art (last, never blocks)

- [ ] Add 9 cargo-tank pictures (one per kind and size, tinted by rarity like the others) through the slice 1.9 art pipeline. Until then the `cargoTank` placeholder ships. Commit `feat(art): cargo tank pictures`.
