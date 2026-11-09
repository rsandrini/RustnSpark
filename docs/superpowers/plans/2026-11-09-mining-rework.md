# Mining Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mining brings an ore mix weighted by rarity, the drill's value is the amount per 5 minutes, the ore space is 2x the cargo for the whole trip (the cheapest ore is dropped first), and board mining contracts become specialist jobs whose time and odds come from the ship's own drill.

**Architecture:** One new pure module (`resolution/mining/mining-yield.ts`) owns the rules (rate, luck, mix, drop-the-cheapest, odds); the leg resolver, the dispatch, the mining info endpoint, the board offer and the web all call it, so the numbers shown are the numbers rolled. Everything tunable is a `mining.*` config key (admin-owned, DB wins). A free job and a contract share one dig loop; a contract adds a target, a tick cap and an early stop.

**Tech Stack:** NestJS + Prisma + jest (`apps/api`), React + vitest + MSW + i18n en/pt-BR (`apps/web`), Python/Node sim (`apps/api/sim`, Node 22).

**Spec:** `docs/TODO_v0.1.3.md` item 8 (owner decisions, 2026-11-09). Sim table in that item.

## Global Constraints

- Code in English; every player-facing string in `en.json` AND `pt-BR.json`; no hard-coded strings (language policy).
- All tunables live in the config registry with an en + pt-BR description; the DB value wins over the TS default (tuning policy). New keys: `mining.yield_k`, `mining.mix_weights`, `mining.tier_bias`, `mining.space_factor`, `mining.contract_max_ticks`, `mining.contract_confidence`, `mining.contract_rarity_weights`, `mining.contract_quantity_min`, `mining.contract_quantity_max`, `mining.contract_unit_pay`.
- API `src` must not import the contract package (local types; parse in int-spec). New error codes need en + pt-BR.
- Determinism: a resolution is a pure function of seed + snapshot + rules; document the rng draw order in the new module's header; never reorder it later.
- Run only the specs for touched files; int specs need the test stack (postgres-test 5433, redis-test 6380); sims need Node 22 (`PATH=~/.nvm/versions/node/v22.23.2/bin`). Before the push run `test:e2e` and grep old literals (rule: default changes break e2e).
- Rules agreed (verbatim): ore space = 2 x cargo, one trip whatever the time; over the limit drop the cheapest (rarity, then price), keep the best; contract: full pay for 100% delivered, partial in proportion, nothing for zero; the contracted ore is delivered (does not stay), other ores and any surplus stay; the mission ends early when N is reached; NO block for a weak drill, show the odds; more common contracts for common ships; the required quantities go up.

## Review Focus

- A place with a single ore (deep fields): the mix is that ore at 100%; no division by zero in the weights.
- A contract bigger than the ore space (N > 2 x cargo): accepted, the card says "needs more cargo", the odds are computed against the space, pay is partial.
- The cap must never drop the contract's own ore while other ore stays: reserve space for the required units first (my call), then fill the rest by value.
- Ties in value when dropping: same rarity -> lower base price dropped first -> ore id order (deterministic).
- A worn or power-starved drill: the rate falls, and the odds on the card use the drill's current condition and rig power.
- A job that finds nothing: the report says it found nothing; the contract pays 0 and the mission is a partial failure.
- Old MissionLogs and the admin replay: stored contexts without the new fields must still resolve (defaults), and a replay uses the run's own rules snapshot.
- Ion-only ship: a dig burns no fuel; a contract's fuel check uses the capped tick count only for chemical ships.

---

### Task 0: Calibration gate (sim, no product code)

**Files:**
- Create: `apps/api/sim/mining_calibration.py`
- Modify: `docs/TODO_v0.1.3.md` (item 8: the chosen values)

**Interfaces:**
- Produces: the starting values for the config keys of Task 1 (`yield_k` about 8.3, `mix_weights` 60/30/10, `tier_bias` COMMON 0 / UNCOMMON 0.15 / RARE 0.3 / EPIC 0.45 / LEGENDARY 0.6 as `weight x (1 + bias x rank)` with rank common 0, uncommon 1, rare 2, `space_factor` 2, `contract_max_ticks` 12, `contract_confidence` 0.9, plus `contract_quantity_min`/`_max` per rarity and `contract_unit_pay` per rarity).

- [ ] **Step 1:** Write the script: Poisson-luck finds per 5 min `E = min x perf x richness x yield_k`; for each drill (small 1x2 and heavy 2x2, tiers common/rare/legendary) x place (debris 0.6, open 0.2) x contract (common/uncommon/rare, quantities from a table) print minutes for the confidence and the chance inside the cap. Also print contract pay per hour (`unit_pay x N / minutes`) next to the prod pay per hour per mission type from `backups/prod-2026-11-09/` (13-43k early game, 100-400k late).
- [ ] **Step 2:** Run it; choose `contract_quantity` (min, max per rarity; larger than today's 1-3, the common ones achievable by a small common drill in about 20-30 min in debris, rare ones needing a better drill) and `contract_unit_pay` so mining pays at or below the early-game pay per hour of other mission types. Record the table and the chosen values in item 8.
- [ ] **Step 3:** Commit: `git add apps/api/sim/mining_calibration.py docs/TODO_v0.1.3.md && git commit -m "docs(sim): mining calibration - drill, ore mix and contract sizes"`.

### Task 1: Config keys

**Files:**
- Modify: `apps/api/src/config/game-config.types.ts`, `game-config.defaults.ts`, `game-rules.schema.ts`, `config-registry.ts` (group `mining`)
- Test: the existing config registry/schema specs (`apps/api/test/unit/config`)

**Interfaces:**
- Produces: `rules.mining` gains `yield_k: number`, `mix_weights: Record<'common'|'uncommon'|'rare', number>`, `tier_bias: Record<RarityEnum, number>`, `space_factor: number`, `contract_max_ticks: number`, `contract_confidence: number`, `contract_rarity_weights: Record<'common'|'uncommon'|'rare', number>`, `contract_quantity_min` and `contract_quantity_max: Record<'common'|'uncommon'|'rare', number>` (flat: the registry validates records of numbers), `contract_unit_pay: Record<'common'|'uncommon'|'rare', number>`. `mining.rarity` and `mining.attempts_per_stop` are KEPT as legacy keys (the approved Appendix E fixtures and old stored rule sets pin them): the registry text says they are no longer read by mining. New schema keys carry `.default(...)` so a stored old rule set still validates.

- [ ] **Step 1:** Failing test: the registry lists every new key with en + pt-BR description and the default equals the Task 0 value; the schema rejects a negative weight and `space_factor < 1`.
- [ ] **Step 2:** Run it, expect FAIL.
- [ ] **Step 3:** Add types, defaults, schema, registry entries.
- [ ] **Step 4:** Run the config specs, expect PASS; `grep -rn "attempts_per_stop\|mining.rarity" apps` and fix every reader (the old resolver, the filler's quantity clamp, the info endpoint, sim exports).
- [ ] **Step 5:** Commit `feat(config): mining yield, mix, space and contract keys`.

### Task 2: The pure mining module

**Files:**
- Create: `apps/api/src/resolution/mining/mining-yield.ts`
- Test: `apps/api/test/unit/resolution/mining-yield.spec.ts`
- Modify: `apps/api/src/resolution/mining/mining.resolver.ts` (keep `performance` use; `miningChance` and `resolveMining` are replaced by the module below, remove them and their tests)

**Interfaces:**
- Produces (all exported, pure, rules passed in):
  - `findsPerTick(miner: {min:number;condition:number;rigPower?:number}, richness: number, rules: GameRules): number` = expected finds per 5 min.
  - `rollFinds(expected: number, rng: Rng): number` (Poisson luck: Knuth below 30, normal approximation above, clamped at 0; draw order documented in the header).
  - `oreMix(ores: readonly {id:string;rarity:string}[], drillRarity: string, rules: GameRules): ReadonlyMap<string, number>` (shares sum to 1; one ore -> 1).
  - `rollOre(mix: ReadonlyMap<string, number>, rng: Rng): string`.
  - `keepBest(found: ReadonlyMap<string, number>, limit: number, value: (id: string) => {rarityRank:number;price:number}, reserved?: {id:string;units:number}): {kept: Map<string, number>; dropped: Map<string, number>}`.
  - `oreSpace(cargo: number, rules: GameRules): number` = `floor(cargo x space_factor)`.
  - `chanceToReach(required: number, expectedPerTick: number, ticks: number, shareOfTarget: number): number` (Poisson tail) and `ticksFor(required, expectedPerTick, shareOfTarget, confidence, maxTicks): number | null`.
  - `MinerRig` (in `mining.resolver.ts`) gains `rarity: string` (drill rarity, from the catalog).

- [ ] **Step 1:** Failing tests (names and assertions): `keepBest` with found {common 20, uncommon 5, rare 1}, limit 20 -> kept {rare 1, uncommon 5, common 14}, dropped {common 6}; reserved contract ore is never dropped before other ore; ties break by price then id; `oreMix` with weights 60/30/10 and tier RARE bias gives rare share above 0.10 and shares sum to 1, one ore -> 1; `rollFinds` mean over 4000 seeded draws within 3% of expected; `findsPerTick` for min 2, condition 100, debris, K from rules = `2 x 0.6 x K`; `chanceToReach(10, 1.5, 2, 1)` small, `ticksFor` returns null past the cap and monotone in drill strength; space: cargo 16 -> 32.
- [ ] **Step 2:** Run `jest --selectProjects unit mining-yield`, expect FAIL (module missing).
- [ ] **Step 3:** Implement the signatures above; the Poisson tail by summing the pmf.
- [ ] **Step 4:** Run, expect PASS. Remove the old `miningChance`/`resolveMining` tests.
- [ ] **Step 5:** Commit `feat(mining): pure yield, mix, space and odds rules`.

### Task 3: The dig loop in the leg resolver

**Files:**
- Modify: `apps/api/src/resolution/leg/leg.resolver.ts` (mining block, about 975-1050), `resolution/events/mission-event.ts` (new event `mining_dropped`; `mining_cargo_full` retired), `reports/events/event.schema.ts`, `reports/templates/template.placeholders.ts`, `reports/templates/en/*`, `reports/templates/pt-BR/*`
- Modify: `apps/api/src/missions/resolution-input.ts` (`miner` gets `rarity`; the context carries the minable `ores` list with rarity and price so a replay sees the run's own world; old contexts default to the single `materialId`)
- Test: `apps/api/test/unit/resolution/mission.resolver.spec.ts`

**Interfaces:**
- Consumes: Task 2 functions.
- Produces: `LegInput.route.miningTicks` (free job: ticks asked) and new `LegInput.route.digTarget?: {materialId:string; required:number; maxTicks:number}` (contract). Output keeps `loot` (kept ore only), `miningTicksRun`, and events `mining` (one per kept ore), `mining_dropped` (one per dropped ore, magnitude = units), no event when nothing found plus a `mining_empty` event.

- [ ] **Step 1:** Failing tests: a 20-min job (4 ticks) never keeps more than `oreSpace`; found 26 vs limit 20 drops the cheapest and logs `mining_dropped`; a contract stops at the tick the target is reached (`miningTicksRun` < `maxTicks`); a contract keeps its reserved units even when the cheaper ore is the contract ore; a single-ore place yields only that ore; same seed -> same result twice; a zero-cargo ship is refused upstream (unchanged).
- [ ] **Step 2:** Run those specs, expect FAIL.
- [ ] **Step 3:** Replace the dig block: per tick `rollFinds(findsPerTick(...))`, each find `rollOre(mix)`; pile all ticks; after the last tick `keepBest(pile, oreSpace(crg), ..., reserved)`; contract: stop at the first tick where the contract ore in the pile >= required. Rig power and condition feed `findsPerTick` as today.
- [ ] **Step 4:** Add the event type, schema entry, placeholders (`material`, `quantity`) and en + pt-BR templates; run the reports specs.
- [ ] **Step 5:** Run the resolver + reports specs, expect PASS; commit `feat(mining): one-trip ore space, rarity mix and drop-the-cheapest in the dig`.

### Task 4: Contract settlement, partial pay, delivery

**Files:**
- Modify: `apps/api/src/economy/reward.calculator.ts` (`contractedMiningPayout(base, delivered, required)` = `base x min(1, delivered/required)`, 0 when none), `apps/api/src/resolution/mission/mission.resolver.ts` (about 325-345: take the delivered units out of `loot`, pay in proportion, event `mining_paid` when 100% else `mining_partial_failure` with the paid amount, status `partial_failure` below 100%), `apps/api/src/missions/resolve.service.ts` (deposit only the loot left after the delivery)
- Test: `apps/api/test/unit/resolution/mission.resolver.spec.ts`, `apps/api/test/unit/economy/reward.calculator.spec.ts`, `apps/api/test/integration/mining-job.int-spec.ts` (or the economy-loop spec)

**Interfaces:**
- Produces: `contractedMiningPayout(base: number, delivered: number, required: number): number` (replaces the boolean form; remove `settleContractedMining` if nothing else uses it).

- [ ] **Step 1:** Failing tests: 10 of 10 -> full pay and loot loses 10 contract ore; 4 of 10 -> 40% of pay, status `partial_failure`; 0 -> 0 pay; 14 found of 10 -> pay full, 4 surplus stay in the pilot's goods; other ores stay; the wallet credit and goods match in the int test.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `feat(mining): contracts pay in proportion and deliver the contracted ore`.

### Task 5: Dispatch and the mining info endpoint

**Files:**
- Modify: `apps/api/src/missions/dispatch.service.ts` (a contract's last leg gets `digTarget` from the mission cargo; the dry run `miningTicksRun` gives the real ticks, so duration = travel + ticks x `job_duration_seconds`; fuel for chemical ships = ticks x `job_fuel_per_tick` against the capped worst case), `apps/api/src/missions/mining-job.service.ts` (`MiningJobInfo` gains `spaceUnits`, `fillSeconds` (expected time to fill the space), `ores` keeps `id/displayName/rarity`; drop `chancePerMin`, `pickShare`, `attemptsPerTick`; `start` rolls no ore any more: the job digs the mix)
- Modify: `apps/api/src/missions/missions.controller.ts` only if the response type is declared there
- Test: `apps/api/test/integration/mining-job.int-spec.ts`

**Interfaces:**
- Produces: `GET /v1/locations/:id/mine/info` -> `{ minable, tickSeconds, maxTicks, fuelPerTick, spaceUnits: number | null, fillSeconds: number | null, ores: {id; displayName; rarity}[] }` (`spaceUnits` and `fillSeconds` null without a ship/rig).

- [ ] **Step 1:** Failing int tests: info returns `spaceUnits` = 2 x cargo and only ore names/rarity; a 5 min and a 20 min job both stay under the space; a contract dispatch sets the duration from the dry run and ends early in the log; ion-only contract burns no fuel.
- [ ] **Step 2:** Run (test stack up), expect FAIL. **Step 3:** Implement. **Step 4:** Run `pnpm test:int -- mining-job`, expect PASS.
- [ ] **Step 5:** Commit `feat(mining): dispatch the dig by ship, info with ore space`.

### Task 6: Board generator and pay

**Files:**
- Modify: `apps/api/src/missions/generator/template.filler.ts` (`miningCargo`: draw the ore rarity by `contract_rarity_weights`, then an ore of that rarity minable at the origin (fall back to any minable one), quantity in `contract_quantity[rarity]`; the reward = `contract_unit_pay[rarity] x quantity` instead of the distance formula; remove `MAX_CONTRACT_QUANTITY` and the old comment)
- Test: `apps/api/test/unit/missions/template.filler.spec.ts` (or the existing generator spec)

**Interfaces:**
- Consumes: Task 1 keys. Produces: a contracted mining offer with `cargo: {materialId, contracted: true, quantity}` and `reward` set from the unit pay.

- [ ] **Step 1:** Failing tests: over 500 seeded offers, common contracts outnumber rare in line with the weights; quantities stay inside the range for the rarity; the ore is always minable at the origin (pinned fields included); `reward = unit_pay x quantity`; deterministic per seed.
- [ ] **Step 2-4:** Run FAIL, implement, run PASS. **Step 5:** Commit `feat(missions): mining contracts by ore rarity with larger quantities`.

### Task 7: Offer info (odds, time, cargo warning)

**Files:**
- Modify: `apps/api/src/missions/missions.service.ts` (`offerInfo` and `OfferInfo`: new `mining: {required; materialId; expectedSeconds; capSeconds; successChance; spaceUnits} | null` for the viewing ship; add the requirement row "needs more cargo" as a warning, never an eligibility block; no block for a weak drill)
- Test: `apps/api/test/integration/missions-board.int-spec.ts` (or the existing offer-info spec)

**Interfaces:**
- Consumes: `ticksFor`, `chanceToReach`, `findsPerTick`, `oreMix`, `oreSpace`. Produces `info.mining` above (null for non-mining or a viewer without a ship/rig).

- [ ] **Step 1:** Failing tests: a small common drill and a heavy rare drill see different `expectedSeconds` and `successChance` for the same offer; neither is ineligible; N > space adds the cargo warning and caps the chance below 1.
- [ ] **Step 2-4:** Run FAIL, implement, run PASS. **Step 5:** Commit `feat(missions): mining offer shows time and odds for the viewing ship`.

### Task 8: Web (picker, card, report, i18n)

**Files:**
- Modify: `apps/web/src/features/port/port.page.tsx` (mining tab about 1688: tiles "Ore space" and "Fills in about N min", one clear line before the job: "Ore space is twice your cargo. If you find more, the cheapest ore is dropped first." with the example kept in the help text; replace "Load per 5 min"/"Most ore"), `apps/web/src/features/board/mission-card.tsx` (contract line: quantity + ore, "about X min, Y% chance" from `info.mining`, cargo warning), the report view that renders mining events (find it with `grep -rn "mining" apps/web/src/features/report`) to show found / kept / dropped per ore, `apps/web/src/features/transit/transit.page.tsx` (the dig card shows the ore space), `apps/web/src/test/msw/handlers.ts` (new info shape), `apps/web/src/i18n/en.json` + `pt-BR.json` (`port.mining*`, `board.mining.*`, `report.*mining*`)
- Test: `port.spec.tsx`, `board` mission-card spec, report spec

**Interfaces:**
- Consumes: Task 5 info shape and Task 7 `info.mining`; the map card already lists only ore names (done).

- [ ] **Step 1:** Failing tests: the picker shows "Ore space: 32" for cargo 16 and the drop rule text; the contract card shows the odds and time and the cargo warning when N > space; the report lists dropped ore ("Dropped: 6 common ore (no room)"); both locales have every new key.
- [ ] **Step 2-4:** Run FAIL, implement, `npx vitest run src/features/port src/features/board src/features/report src/features/map`, expect PASS; `tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(web): ore space, odds and dropped ore in the mining screens`.

### Task 9: Regression, docs, owner test

**Files:**
- Modify: `apps/api/test/e2e/*` literals (grep `attempts_per_stop`, old mining quantities), `docs/TODO_v0.1.3.md` (item 8 -> built, waiting for the owner's test), `docs/GLOSSARY`/guide text that describes mining (`en.json` guide section "Scavenging and mining" line about "pays only if you bring the full amount" -> partial pay)
- Test: `pnpm test:e2e` on the touched mining flows, `pnpm test:int -- mining`, the sim export still runs (`pnpm sim export`) with the new keys

- [ ] **Step 1:** `grep -rn "attempts_per_stop\|mining.rarity\|pickShare\|chancePerMin" apps` returns nothing outside history. **Step 2:** Run the e2e and int specs for mining; fix literals. **Step 3:** Rebuild the dev stack (`docker compose --profile dev up -d --build`, the worker too) and hand over for the owner's test: a 5 and a 20 min dig, a contract with a small and a heavy drill, the report with dropped ore. **Step 4:** Commit `test: mining rework regression and docs`.
