# Sim Alignment Plan — post-2026-11-16 game changes

> **For agentic workers:** implement task-by-task. This plan touches **only** `apps/api/sim/` and planning/docs files. Do NOT modify tutorial, web, API source, or config defaults — another agent owns the tutorial.

**Goal:** Bring the economy sim back into alignment with the live game after the recent balance and mining changes, so `sim-replay` passes again and the baseline experiments reflect the current rules.

**Status when this plan was written:**
- `apps/api/sim-data/snapshot.json` was stale (old `economy.reward_distance_divisor` and `economy.reward_by_bridge`). It was re-exported on 2026-11-19 and now matches the live DB.
- `sim-replay --limit 20` passes for delivery/scavenge but **fails on all mining rows** because the sim reports 0 fuel burned while the live game burns 50–200 units per mining job.
- The sim does not implement the first-repair fee waiver / minimum duration.
- Known, documented abstractions remain acceptable: no part-stored-fuel model, no escort model, no mining contracts (only free mining).

**Spec / context:**
- `docs/TODO.md` sim item (2026-10-27) calls for re-exporting the snapshot and re-running the four builds on the new defaults.
- `apps/api/sim/README.md` documents the sim's scope and assumptions.
- Live mining fuel rule: `mining.job_fuel_per_tick`, 5-minute ticks, chemical ships burn per tick, ion ships burn 0.
- Live first-repair rule: `economy.first_repair_fee_share` (0 today = workshop fee waived) and `economy.first_repair_min_seconds` (300 today).

---

## Global Constraints

- Touch **only** files under `apps/api/sim/`, `apps/api/test/validation/sim-replay.ts` (required for validation), and planning/docs files.
- No changes to `apps/api/src/`, `apps/web/`, tutorial flows, or config defaults.
- Determinism must be preserved; document any new RNG draw order in file headers.
- All new sim behavior must read from the snapshot's `rules` object (no hard-coded values).
- Unit tests live under `apps/api/test/unit/sim/`.
- Validation: `npx tsx test/validation/sim-replay.ts --limit 40` after re-export.

---

## Task 0: Snapshot refresh gate

**Files:**
- `apps/api/sim-data/snapshot.json` (gitignored, generated)

**Interfaces:**
- Confirms the exported snapshot matches the live DB rules.

- [x] **Step 1:** With the dev stack running, run `set -a; . ../../.env; set +a && pnpm sim export` from `apps/api`.
- [x] **Step 2:** Verify key values:
  - `rules.economy.reward_distance_divisor` == 4000
  - `rules.economy.reward_by_bridge` == `{"COMMON":1,"UNCOMMON":1,"RARE":1.25,"EPIC":1.8,"LEGENDARY":2.2}`
  - `rules.economy.start_credits` == 3000
  - `rules.parts.starter_condition` == 100
  - `rules.economy.first_repair_fee_share` == 0
  - `rules.economy.first_repair_min_seconds` == 300
  - `rules.mining.job_fuel_per_tick` == 50
- [x] **Step 3:** Confirmed snapshot matches live DB.

---

## Task 1: Mining fuel burn in the sim

**Files:**
- Modify: `apps/api/sim/actions/mining.ts`
- Modify: `apps/api/sim/actions/mission.ts` (pass `miningTicks` through to dispatch legs)
- Modify: `apps/api/test/validation/sim-replay.ts` (preserve `miningTicks` from log legs)
- Test: `apps/api/test/unit/sim/economy.spec.ts`

**Interfaces:**
- `miningOffer` builds a mining leg with `miningTicks` set to the number of ticks that fill the ore space (capped by `job_max_ticks`).
- `mine` / `takeMission` for `MINING` advance the clock and burn fuel the same way the live resolver does.
- Ion/chemical detection uses the resolver's own `ship.sheet.fuelUse > 0` check.

- [x] **Step 1:** Confirmed the live fuel formula: `ticksRun × mining.job_fuel_per_tick` when `sheet.fuelUse > 0`, otherwise 0.
- [x] **Step 2:** Updated `economy.spec.ts` mining test to expect a multi-tick job.
- [x] **Step 3:** Implemented in `sim/actions/mining.ts`:
  - Compute ticks as `min(job_max_ticks, ceil(oreSpace / findsPerTick))`.
  - Set `miningTicks` on the leg and scale distance to `ticks × job_duration_seconds`.
- [x] **Step 4:** Updated `sim/actions/mission.ts` to copy `miningTicks` from offer legs into dispatch legs.
- [x] **Step 5:** Updated `test/validation/sim-replay.ts` to preserve `miningTicks` from log legs.
- [x] **Step 6:** Unit tests PASS.
- [x] **Step 7:** Committed as part of `fix(sim): mining fuel burn and first-repair rules`.

---

## Task 2: First-repair waiver and minimum duration

**Files:**
- Modify: `apps/api/sim/actions/repair.ts`
- Test: `apps/api/test/unit/sim/policy.spec.ts`

**Interfaces:**
- `repairQuote` derives `firstRepair` from `state.repairActions === 0` and applies `economy.first_repair_fee_share` to the maintenance fee.
- `repairQuote` returns a duration of at least `economy.first_repair_min_seconds` when `firstRepair` is true.
- `repair` increments `state.repairActions` after the repair.

- [x] **Step 1:** Added/updated unit tests in `policy.spec.ts`:
  - First repair cost equals parts-only share (maintenance fee waived when `first_repair_fee_share` is 0).
  - Second repair uses normal fee and normal duration.
- [x] **Step 2:** Implemented in `sim/actions/repair.ts`:
  - Derive `firstRepair` from `state.repairActions === 0`.
  - Build effective rules with reduced `maintenance_per_tier` for the first repair.
  - Apply `max(points × secondsPerPoint, first_repair_min_seconds)`.
- [x] **Step 3:** Unit tests PASS.
- [x] **Step 4:** Committed as part of `fix(sim): mining fuel burn and first-repair rules`.

---

## Task 3: Validate against real play

**Files:**
- None (validation only)

- [x] **Step 1:** Re-exported the snapshot (`pnpm sim export`).
- [x] **Step 2:** Ran `npx tsx test/validation/sim-replay.ts --limit 40`.
- [x] **Step 3:** Mining rows now PASS (fuel exact, wear within tolerance). Four unrelated SCAVENGE rows still fail on status/wear; these are tracked separately in `docs/TODO.md`.
- [x] **Step 4:** `npx tsx test/validation/sanity-bots.ts` PASS.

---

## Task 4: Re-run the four-build baseline

**Files:**
- Generated output in `apps/api/sim-data/sim.db` (gitignored)

- [x] **Step 1:** Attempted the full parallel runner; it exceeded the session timeout.
- [x] **Step 2:** Ran a chem-only smoke (`2 runs × 10 missions × 10 cells`) successfully.
- [ ] **Step 3:** Full four-build baseline (`run-parallel.sh post-nov19-baseline sim/edits/none.json --runs 8 --missions 50`) still needs to be run on a longer-lived shell. Compare with previous baseline via:
  ```bash
  cd apps/api
  ./sim/compare.py "base=<previous label LIKE pattern>" "new=post-nov19-baseline-%"
  ```
- [ ] **Step 4:** Record the summary in `docs/TODO.md`.

---

## Task 5: Document remaining abstractions

**Files:**
- Modify: `apps/api/sim/README.md`
- Modify: `docs/TODO.md`
- Modify: this plan

- [x] **Step 1:** Updated `apps/api/sim/README.md` "Assumptions every number carries" to list:
  - Mining jobs are free-dig only; board mining contracts are not modeled.
  - Fuel in removed tanks is not modeled (part-stored-fuel abstraction).
  - Escort rescue is not modeled; the bot uses the paid rescue path.
  - First repair fee waiver and min duration are modeled.
  - Mining fuel per tick is modeled.
- [x] **Step 2:** Updated `docs/TODO.md` sim items:
  - Marked snapshot re-export as done.
  - Marked mining fuel burn and first-repair alignment as done.
  - Kept the ion-build reactor-wear investigation open.
  - Added a note about the unrelated scavenge replay drift.
- [x] **Step 3:** Updated this plan with completed steps and findings.
- [ ] **Step 4:** Commit: `docs(sim): document aligned rules and known abstractions`.

---

## Definition of done

- [ ] `pnpm sim export` produces a snapshot matching the live DB rules.
- [ ] `sim-replay --limit 40` reports **40/40 match**.
- [ ] `sanity-bots` passes.
- [ ] New or updated unit tests cover mining fuel burn and first-repair behavior.
- [ ] Four-build baseline has been run and summarized.
- [ ] `apps/api/sim/README.md` and `docs/TODO.md` are updated.
- [ ] No files outside `apps/api/sim/` or docs were modified.
