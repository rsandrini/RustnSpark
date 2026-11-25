# Ship identity (types by main point, spider chart) and people-transport capacity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Commit on `develop`, one commit per task.

**Goal:** (a) the ship's type names what it is MAINLY good at, with Racer added and Multirole renamed Balanced, shown with a 7-axis spider chart; (b) passenger transport has real limits: a cabin gives seats (`pax`), a life-support module keeps a number of people alive (`lifeCap`), and a passenger mission carries a head count.

**Owner scope note (2026-11-24):** no browser/e2e/screenshot task; the owner reviews visually later. Unit/int specs and the final whole-slice review still run.

**Decisions (owner, 2026-11-24):** add Racer (mobility); rename Multirole to Balanced; 7 axes: cargo, passengers, firepower, defense, mobility, range, mining (NO sensors axis); add the `pax` passenger-capacity stat; people transport gets seats + life-support capacity + a head count per mission (TODO items 6 and 8). Types: Hauler, Transport, Warship, Miner, Racer, Balanced.

**Spec:** `docs/TODO_v0.1.5.md` items 6 and 8; this plan's "What the code does today".

## What the code does today (checked 2026-11-24)

- `apps/api/src/ships/ship-class.ts` `deriveShipClass(parts, rules)`: classes `HAULER | TRANSPORT | WARSHIP | MINER | MULTIROLE`. Shares of STRUCTURE COST (everything but the bridge), first match wins: cargo >= 0.30 -> Hauler; pressurized >= 0.20 -> Transport; weapon+defense >= 0.45 -> Warship; ANY part with `min > 0` -> Miner; else Multirole. Config `ship_class.{cargo_share, pressurized_share, combat_share}` (0.3 / 0.2 / 0.45), admin-tunable (`game-config.defaults.ts` ~453, `game-rules.schema.ts` ~300, `game-config.types.ts` ~221 and ~614, `config-registry.ts`). The class is display-only (nothing in missions or rules reads it); shown in the ship sheet panel (`hangar.classes.*`), the pilot card, the sim playstyle (`apps/api/sim/bots/playstyle.ts`), the prologue sandbox (`sandbox-ship.ts`, fixed `TRANSPORT`).
- Parts: table `Part` (Prisma model keyed by `partType`) with stat columns (`pot pdf bli esc sen crg min energyCont ... fuelCap fuelUse bat*`) and a JSON column `specialProp` that holds `pressurized`, `lifeSupport`, `shieldRegen`, `idlePower`, `armorPiercing` (`apps/api/src/parts/parts.service.ts` ~100 maps them into `PartCatalog`; seed in `apps/api/prisma/seed-data/parts.ts`, family tables of 5 rarity tiers; admin edits via `admin/tuning/entity-schemas.ts` ~349). The seed only fills empty tables: a data change for existing parts needs a SQL MIGRATION (`apps/api/prisma/migrations/<timestamp>_name/migration.sql`).
- The contract already carries the flags: `PartCatalogStatsSchema` (`packages/contract/src/index.ts` ~114) has `pressurized` and `lifeSupport` as booleans, and the web's `api/generated.ts` re-exports the contract. (An earlier note that the web lacks them was wrong: `partKindOf` can use the flags; no work needed there.)
- Sheet: `deriveSheet(parts, rules)` (`apps/api/src/ships/sheet.deriver.ts`) sums stats into `ShipSheet` (`ships/sheet.types.ts`; contract `ShipSheetSchema` ~188 has pot pdf bli esc sen crg min hp mass energy* bat* fuelCap fuelUse structureUsed structureBudget autonomy mob condition). The resolution oracles pin some sheet values: adding fields must not change existing ones.
- Transport mission today: `missionRequirementChecklist` (`apps/api/src/missions/requirements.checker.ts`) for `TRANSPORT` returns ONE yes/no check `PRESSURIZED_LIFE_SUPPORT` = a pressurized part AND a life-support part installed. No head count, no seats, no life-support capacity: the smallest of each moves any group. Offer `requirements` JSON carries hints parsed by `parseHints` (`cargo`, `speed`, `minMobility`); the generator is `missions/generator/` (`template.filler.ts` reads template requirements). Viability (`ships/viability.ts` ~177-183) also needs a life-support part when a pressurized part is aboard.

## Global Constraints

- Work on `develop`, one commit per task. `git branch --show-current` before every commit; never `release/*`, `main`, `master`. Pushing `develop` is allowed; the owner promotes.
- Code in English; every player-facing string in en AND pt-BR, no hard-coded text; new error/reason codes need en + pt-BR (`apps/api/src` must NOT import the contract package: the Docker api build has none; use local types, parse in int-spec).
- Admin owns every tunable number: the DB wins over TS defaults, changes take effect at once; new knobs go in the config registry (`config-registry.ts`) with en + pt-BR labels.
- Missions resolve in the `worker` container: rebuild api AND worker after an engine/requirements change (a note for the owner; no docker run in this plan).
- No retro-compatibility for missions (owner, 2026-11-24): old offers and accepted missions expire and are replaced by the new rules; code does NOT carry legacy branches or tests for them. If an old offer cannot satisfy the new rule it is simply not accepted.
- The seed fills data only when empty: any part/config change needs a MIGRATION for prod.
- Sims need Node 22. Run only the specs of touched files (api: the unit/int specs for touched modules; web: touched specs); the api int-test stack recipe is in memory `feedback_targeted_tests.md`.
- The prologue sandbox (`apps/web/src/features/prologue/sandbox`) and the admin screens follow every new field/kind.

## Review Focus

- A ship with no parts but the bridge, and one with a single non-zero axis: the radar draws, the type is Balanced, no divide by zero.
- An axis far above its reference: clamped to the rim, the type stays stable.
- Config edited in the admin while pilots are online: type and chart change at once (no stale cache).
- The class/profile are DERIVED, never stored (check the `Ship` model has no class column): nothing to migrate for ships.
- A ship with a cabin and a life-support module but not enough seats/capacity for the group: the offer is blocked with a reason naming which one is short (seats vs life support), the fix chip points to the right store tab (cabin = CARGO class, life support = UTILITY class).
- The oracles for resolution/sheet values still pass unchanged (adding `pax`/`lifeCap` to the sheet changes no existing field).
- pt-BR axis labels short enough for a 390px radar.

## File Structure

- Server: `apps/api/prisma/migrations/<ts>_part_pax_and_life_capacity/migration.sql`, `prisma/seed-data/parts.ts`, `src/parts/part.types.ts`, `src/parts/parts.service.ts`, `src/ships/sheet.types.ts`, `sheet.deriver.ts`, new `src/ships/ship-profile.ts`, `ship-class.ts`, `src/missions/requirements.checker.ts`, `src/missions/generator/*`, `src/config/*`, `src/admin/tuning/entity-schemas.ts`, `apps/api/sim/bots/playstyle.ts`.
- Contract: `packages/contract/src/index.ts`.
- Web: `apps/web/src/ui/kit/ShipRadar.tsx` (+ spec), `features/hangar/ship-sheet-panel.tsx`, `features/profile/pilot-card.tsx`, `features/board/requirement-fix.ts`, `features/prologue/sandbox/*`, `styles/kit.css`, both locale files.

---

### Task 1: the `pax` and `lifeCap` stats on parts and on the sheet

**Files:** migration SQL, `parts.ts` seed, `part.types.ts`, `parts.service.ts`, `sheet.types.ts`, `sheet.deriver.ts`, `packages/contract/src/index.ts` (`PartCatalogStatsSchema` + `ShipSheetSchema`), `entity-schemas.ts` (admin part editor shows them), the prologue sandbox sheet (`sandbox-ship.ts`), en/pt-BR labels; specs for the deriver and the parts service.

**Interfaces:**
- Produces: `PartCatalog.pax: number` and `PartCatalog.lifeCap: number` (0 when absent), read with the existing `readNumber(row.specialProp, 'pax' | 'lifeCap')`; `ShipSheet.pax` = sum of `pax` over installed parts, `ShipSheet.lifeCap` = sum of `lifeCap`; contract `ShipSheetSchema` gets `pax: z.number()` and `lifeCap: z.number()` (with `.default(0)` so an older payload still parses), `PartCatalogStatsSchema` gets `pax` and `lifeCap` (`z.number().default(0)`).
- Values (defaults, tunable in the admin part editor; "owner/sim to tune"): the `passenger_cabin` family tiers (COMMON..LEGENDARY) seat 2, 3, 4, 6, 8; the `life_support` family tiers keep alive 3, 4, 6, 8, 10. Check the family tables in `parts.ts` for the real tier structure/sizes and keep the ratio "life support covers a bit more than one cabin" per tier.

- [ ] **Step 1: Failing tests.** deriver spec: a ship with a cabin (pax 4) and a life-support (lifeCap 6) has `sheet.pax = 4`, `sheet.lifeCap = 6`; two cabins sum; no cabin -> 0; dead parts (worn to nothing, `isDead`) contribute nothing (mirror how `fuelCap` ignores dead tanks); existing sheet fields unchanged for a fixed fixture (guard the oracles). Parts-service spec: a part row with `specialProp {pax: 4}` maps to `catalog.pax = 4`, missing -> 0. Seed check: the cabin and life-support tiers carry the values above.
- [ ] **Step 2: Run** (api unit specs of those files): FAIL.
- [ ] **Step 3: Implement.** Migration SQL: `UPDATE "Part" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('pax', <n>) WHERE "partType" LIKE 'passenger_cabin%'` per rarity suffix (`''`, `_uncommon`, `_rare`, `_epic`, `_legendary`; verify the suffixes in `parts.ts` ~93) and the same for `life_support%` with `lifeCap`; idempotent; admin-edited parts keep their own value if already present (`AND NOT (COALESCE("specialProp",'{}'::jsonb) ? 'pax')`). Seed: add `specialProp.pax`/`lifeCap` to the tier definitions. The admin part editor exposes the two numbers (read how `specialProp` is edited at `entity-schemas.ts` ~349 and add the fields in the same style, en + pt-BR labels).
- [ ] **Step 4: Run** the specs; also the API contract test that checks responses against the contract schemas; the web specs that build a `ShipSheet` fixture (`profile-fixtures.ts`, sandbox sheets, msw handlers) get `pax: 0, lifeCap: 0` added where TypeScript requires it.
- [ ] **Step 5: Commit** `feat: passenger seats (pax) and life-support capacity (lifeCap) on parts and on the ship sheet`.

---

### Task 2: passenger missions carry a head count and need seats and life-support capacity

**Files:** `requirements.checker.ts` (+ spec), the generator code that builds `requirements` for an offer (`missions/generator/template.filler.ts` and its callers) (+ spec), config (`config-registry.ts`, `game-config.defaults.ts`, `game-rules.schema.ts`, `game-config.types.ts`: new knobs `missions.transport_passengers_min`, `missions.transport_passengers_max`, `missions.transport_pay_per_extra_passenger`), `apps/web/src/features/board/requirement-fix.ts` (+ spec), en/pt-BR reason texts, the prologue sandbox offers (`sandbox-offers.ts`, the transport job), `apps/api/sim` if it builds transport offers.

**Interfaces:**
- Offer `requirements.passengers?: number` (head count; absent = 1). `parseHints` returns `passengers`.
- `missionRequirementChecklist` for `TRANSPORT` returns THREE checks: `PRESSURIZED_LIFE_SUPPORT` (unchanged), `PASSENGER_SEATS` (`numeric`, unit new `'passengers'`: needed = head count, actual = `sheet.pax`) and `LIFE_SUPPORT_CAPACITY` (needed = head count, actual = `sheet.lifeCap`). New `RequirementReasonCode`s `PASSENGER_SEATS` and `LIFE_SUPPORT_CAPACITY` with English messages in the checker and texts under `board.requirements.<CODE>` / `error.*` in BOTH web locales (read how the existing codes are translated and match it); `RequirementUnit` gains `'passengers'` (the web number formatter in `mission-row`/`contract-face`/`mission-card` shows it as a plain count: check `requirementNumber`).
- The generator sets `requirements.passengers` for TRANSPORT offers: a random integer in `[transport_passengers_min, transport_passengers_max]` (defaults 1 and 6), following the cargo pattern if the generator already scales cargo; the reward grows by `transport_pay_per_extra_passenger` (default 10% of the base per extra passenger above 1) through the existing reward formula (read the `reward` computation first; keep the economy sim in mind: a note, not a rebalance here).
- Web fix map (`requirement-fix.ts`): `PASSENGER_SEATS` -> store CARGO (cabins are CARGO class), `LIFE_SUPPORT_CAPACITY` -> store UTILITY; add to its spec.

- [ ] **Step 1: Failing tests.** checker spec: a group of 4 with a cabin of 4 seats and a life-support of 6 -> eligible; seats 2 -> `PASSENGER_SEATS` unmet with needed 4 actual 2; lifeCap 3 -> `LIFE_SUPPORT_CAPACITY` unmet; cabin without life support -> `PRESSURIZED_LIFE_SUPPORT` unmet; the dispatch-time check uses the same checklist (an accepted TRANSPORT whose ship lost seats is refused with the reason: a spec near the slice-0.1 dispatch spec). Generator spec: a TRANSPORT offer's `requirements.passengers` is within the configured range and the reward grows with it; other types get no `passengers`. Web `requirement-fix.spec`: the two new codes map as above.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** the api specs of the checker, generator, dispatch (int) and the web specs (requirement-fix, contract-face if it renders `unit`), the board i18n spec.
- [ ] **Step 5: Commit** `feat: passenger missions carry a head count; seats and life-support capacity gate them`.

---

### Task 3: the ship profile and the types by main point

**Files:** create `apps/api/src/ships/ship-profile.ts` (+ spec); modify `ship-class.ts` (+ spec), `ships.service.ts` (return `profile` next to `shipClass` in the three places that return the sheet: ~382, ~444, ~978), `game-config.defaults.ts` / `game-rules.schema.ts` / `game-config.types.ts` / `config-registry.ts` (new `ship_profile.*` knobs, remove `ship_class.*`), a migration that deletes the stored `ship_class.*` config override rows (find where DB overrides are stored and follow how an earlier migration removed a config key), `apps/api/sim/bots/playstyle.ts`, `packages/contract/src/index.ts` (the class enum gains `RACER` and `BALANCED`, loses `MULTIROLE`; a `profile` object on the ship/preview/profile responses: `{ cargo, passengers, firepower, defense, mobility, range, mining }` each 0..1, plus an optional `modifier` axis key), `apps/web/src/i18n/*` (`hangar.classes.RACER`, `hangar.classes.BALANCED`; remove `MULTIROLE` once nothing uses it), the web fixtures and the prologue sandbox (`sandbox-ship.ts`: profile and class).

**Interfaces:**
- `type ShipProfile = { cargo: number; passengers: number; firepower: number; defense: number; mobility: number; range: number; mining: number }` (0..1) and `deriveShipProfile(sheet: ShipSheet, rules: GameRules): ShipProfile`: each axis = `min(1, value / ref)`; values: cargo = `sheet.crg`, passengers = `min(sheet.pax, sheet.lifeCap)` (seats without air do not count), firepower = `sheet.pot`, defense = `sheet.esc + sheet.bli * <armor pool factor>` (find the server-side config key the web's `display.armorPoolFactor` mirrors), mobility = the raw mobility (`rawMobility`), range = `sheet.autonomy`, mining = `sheet.min`. References from config `ship_profile.ref_cargo`, `ref_passengers`, `ref_firepower`, `ref_defense`, `ref_mobility`, `ref_range`, `ref_mining` ("the value that counts as a full axis"). Choose the defaults from the strongest builds the seed and the sim support (read `apps/api/sim` builds and the top-tier parts; a good mid-game ship should fill about 60 to 70% of its main axis) and write the chosen numbers and how they were derived in a note `docs/balance/ship-profile-references.md`.
- `deriveShipClass(profile: ShipProfile, rules)`: the type = the top axis (cargo -> HAULER, passengers -> TRANSPORT, `max(firepower, defense)` -> WARSHIP, mining -> MINER, mobility -> RACER; range has no type of its own: a long-range ship takes the next axis). BALANCED only when the top score is below `ship_profile.min_main` (default 0.25) OR its lead over the second is below `ship_profile.lead_margin` (default 0.1). `ship_profile.second_min` (default 0.5): a second axis at or above it is returned as `modifier` (shown by the web as "Hauler, armed"). Ties break in a fixed axis order (documented in the code).
- Config removal: delete `ship_class.*` from defaults, schema, types, registry and the DB (migration deleting the override rows); nothing may read them afterwards (grep).
- Compatibility: nothing reads the class except display and the sim playstyle (update its mapping).

- [ ] **Step 1: Failing tests.** ship-profile spec: a pure-cargo sheet -> cargo near 1 and the rest 0; every axis clamped to 1 for a huge value; zeros -> all 0 (no NaN); passengers = `min(pax, lifeCap)` scaled; defense includes the armor pool factor. ship-class spec: pure cargo -> HAULER; a gun-heavy hull with a big shield -> WARSHIP; ONE tiny mining part on a cargo ship -> HAULER not MINER; a fast light hull -> RACER; two equal axes -> BALANCED (lead margin); a weak ship (all under min_main) -> BALANCED; a strong second axis -> `modifier`; config changes take effect at once (use the config test helpers). `ships.service` spec: the three responses carry `profile` and the new class names. A guard: grep that no `MULTIROLE` remains in `apps/api/src` and `apps/web/src` (historic migrations excepted).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** the api specs of ships/config plus the contract test; the web specs that build ship fixtures or show the class (`ship-sheet-panel.spec`, `pilot-card`, profile specs, the prologue sandbox specs).
- [ ] **Step 5: Commit** `feat: the ship's type names its main point (Racer, Balanced) from a 7-axis profile`.

---

### Task 4: the spider chart component

**Files:** create `apps/web/src/ui/kit/ShipRadar.tsx`, `ShipRadar.spec.tsx`, CSS in `styles/kit.css`, locale keys `hangar.profile.axis.<key>` (en + pt-BR) for the 7 axes.

**Interfaces:** `ShipRadar({ values: ShipProfile; ghost?: ShipProfile; size?: number; label: string })`: an inline SVG heptagon radar: rings at 25/50/75/100%, 7 spokes with an icon + short label at the rim (reuse `PartKindIcon` kinds where they fit: cargo, cabin (passengers), weapon (firepower), shield (defense), engine (mobility), tank (range), mining; labels short: "Cargo, Pax, Fire, Def, Speed, Range, Mining" and pt-BR equivalents), the filled polygon in the brass accent, the optional `ghost` as a dashed outline, `role="img"` with `aria-label={label}` plus a visually hidden `<table>` listing each axis and its percent. Values outside 0..1 are clamped; NaN -> 0.

- [ ] **Step 1: Failing tests:** 7 axes draw a 7-vertex polygon; 0 collapses to the centre and 1 touches the rim (assert the vertex radius); the ghost draws a second dashed polygon; values above 1 clamp, negative and NaN -> 0; the hidden table lists 7 rows with percents; every axis key has a label in en and pt-BR (parity spec); `size` scales the viewBox correctly.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(ui): the ship spider chart (7 axes, with an optional ghost)`.

---

### Task 5: show the profile on the ship sheet and the pilot card

**Files:** modify `features/hangar/ship-sheet-panel.tsx` (+ spec), `features/hangar/hangar.page.tsx` (pass `profile` and the preview's `profile` as the ghost while a part is considered), `features/profile/pilot-card.tsx` (+ spec), `features/prologue/sandbox/sandbox-ship.ts` (the fixed sandbox ship gets a profile), `styles/ship.css`, locale files.

**Behaviour:** the sheet's "Class" row shows the type plus the modifier ("Hauler, armed" via `hangar.classes.<TYPE>` and `hangar.classModifier.<axis>`), the radar sits beside the headline tiles on desktop and above them on phone (one column under 700px), the preview ghost comes from `preview?.profile` (Task 3 added `profile` to the preview response); the pilot card shows a small radar (size 96); the opening shows the radar only if it shows the sheet (default hidden in the opening: `usePrologueMode().active`).

- [ ] **Step 1: Failing tests:** the sheet renders the class label with its modifier and a radar with the profile's values; a preview profile draws the ghost; no profile (older payload) renders no radar and no crash; the opening hides the radar; the pilot card renders the small radar and the new class names; pt-BR labels exist.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `ship-sheet-panel.spec`, `hangar.spec`, pilot-card/profile specs, prologue specs, i18n specs.
- [ ] **Step 5: Commit** `feat(ui): the ship sheet and the pilot card show the ship's type and its spider chart`.

---

### Task 6: status

- [ ] **Step 1:** api unit specs of touched modules + the web suite once, lint + prettier on touched files, web build, `tsc` for api and web.
- [ ] **Step 2:** update `docs/TODO_v0.1.5.md` (items 6 and 8: built and unit-tested, NOT browser-checked; the prod deploy needs the migrations `part_pax_and_life_capacity` and the config-key cleanup, and a rebuild of api AND worker) and make sure `docs/balance/ship-profile-references.md` exists with the chosen reference values and how they were derived.
- [ ] **Step 3: Commit** `docs: ship identity and passenger capacity built (status and balance note)`.

---

## Self-review

- Coverage: types by main point incl. Racer/Balanced (T3), 7-axis spider chart (T4, T5), `pax` (T1), people-transport capacity (T1, T2), life-support capacity (T1, T2).
- Names across tasks: `PartCatalog.pax/lifeCap`, `ShipSheet.pax/lifeCap` (T1) feed T2 and T3; `ShipProfile`, `deriveShipProfile`, class enum with RACER/BALANCED (T3) feed T4/T5; `ShipRadar` (T4) feeds T5.
- Not in this plan: sim re-tuning of mission pay (a note only), a Sensors axis (decided out), the spider chart in the store compare popup (a follow-up), item 1 (specialty).
- Open (defaults chosen, change by saying so): cabin seats 2/3/4/6/8 and life-support capacity 3/4/6/8/10 per tier; transport head count 1 to 6; pay +10% per extra passenger; type margins 0.25 / 0.1 / second axis at 0.5; reference values derived from the sim.
