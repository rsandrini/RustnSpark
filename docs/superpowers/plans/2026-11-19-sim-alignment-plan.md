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

- Touch **only** files under `apps/api/sim/` and this plan / `docs/TODO.md` / `apps/api/sim/README.md`.
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

- [ ] **Step 1:** With the dev stack running, run `set -a; . ../../.env; set +a && pnpm sim export` from `apps/api`.
- [ ] **Step 2:** Verify key values:
  - `rules.economy.reward_distance_divisor` == 4000
  - `rules.economy.reward_by_bridge` == `{"COMMON":1,"UNCOMMON":1,"RARE":1.25,"EPIC":1.8,"LEGENDARY":2.2}`
  - `rules.economy.start_credits` == 3000
  - `rules.parts.starter_condition` == 100
  - `rules.economy.first_repair_fee_share` == 0
  - `rules.economy.first_repair_min_seconds` == 300
  - `rules.mining.job_fuel_per_tick` exists and is > 0
- [ ] **Step 3:** If any value differs from the live DB, stop and confirm the dev stack has the latest migration before proceeding.

---

## Task 1: Mining fuel burn in the sim

**Files:**
- Modify: `apps/api/sim/actions/mining.ts`
- Modify: `apps/api/sim/actions/mission.ts` (fuel accounting for mining legs)
- Test: `apps/api/test/unit/sim/mining.spec.ts` (new or existing)

**Interfaces:**
- `miningOffer` builds a mining leg whose fuel multiplier reflects per-tick fuel burn for the ship's engine type.
- `mine` / `takeMission` for `MINING` advances the clock and burns fuel the same way the live resolver does.
- Ion/chemical detection uses the same rule the game uses (engine energy draw or `fuelUse` per tick).

- [ ] **Step 1:** Read the live mining resolver / `mining-job.service.ts` to confirm the exact fuel formula: ticks × `mining.job_fuel_per_tick` for chemical engines, 0 for ion-only engines.
- [ ] **Step 2:** Add a failing unit test: a chemical starter ship doing a 4-tick mining job burns `4 × rules.mining.job_fuel_per_tick` fuel; an ion ship burns 0.
- [ ] **Step 3:** Implement the change in `sim/actions/mining.ts`:
  - Compute expected ticks from `job_duration_seconds` and the ship's mobility (already done for the leg distance).
  - Set the leg's `env.fuelMult` so the resolver burns the per-tick amount instead of 0.
  - For ion-only ships, keep fuel burn at 0.
- [ ] **Step 4:** Ensure `takeMission` records the fuel burn correctly in the ledger and ship state.
- [ ] **Step 5:** Run unit tests; expect PASS.
- [ ] **Step 6:** Commit: `fix(sim): mining jobs burn fuel per tick like the live game`.

---

## Task 2: First-repair waiver and minimum duration

**Files:**
- Modify: `apps/api/sim/actions/repair.ts`
- Test: `apps/api/test/unit/sim/repair.spec.ts` (new or existing)

**Interfaces:**
- `repairQuote` accepts a `firstRepair` flag and applies `economy.first_repair_fee_share` to the maintenance fee.
- `repairQuote` returns a duration of at least `economy.first_repair_min_seconds` when `firstRepair` is true.
- `repair` tracks `state.repairActions` and passes `firstRepair = state.repairActions === 0`.

- [ ] **Step 1:** Add a failing unit test:
  - First repair cost equals parts-only share (maintenance fee waived when `first_repair_fee_share` is 0).
  - First repair duration is `max(points × secondsPerPoint, first_repair_min_seconds)`.
  - Second repair uses normal fee and normal duration.
- [ ] **Step 2:** Implement in `sim/actions/repair.ts`:
  - Add `firstRepair` parameter to `repairQuote` (default false).
  - When `firstRepair` is true, reduce `rules.economy.maintenance_per_tier` by `first_repair_fee_share` before calling `repairCost`.
  - Apply the minimum duration rule.
  - Update `repair` to pass `state.repairActions === 0` and increment `repairActions` after the repair.
- [ ] **Step 3:** Run unit tests; expect PASS.
- [ ] **Step 4:** Commit: `fix(sim): first repair waives fee and respects min duration`.

---

## Task 3: Validate against real play

**Files:**
- None (validation only)

- [ ] **Step 1:** Re-export the snapshot (`pnpm sim export`) to capture any rule changes from Tasks 1–2 did not touch.
- [ ] **Step 2:** Run `set -a; . ./.env; set +a && npx tsx test/validation/sim-replay.ts --limit 40` from `apps/api`.
- [ ] **Step 3:** Acceptance: 40/40 missions match (status exact, fuel and wear within 10%). If mining rows still fail, diagnose whether the fuel formula or tick count is wrong.
- [ ] **Step 4:** Run `npx tsx test/validation/sanity-bots.ts` and confirm it still passes.

---

## Task 4: Re-run the four-build baseline

**Files:**
- Generated output in `apps/api/sim-data/sim.db` (gitignored)

- [ ] **Step 1:** Run the baseline with the parallel runner:
  ```bash
  cd apps/api
  ./sim/run-parallel.sh post-nov16-baseline sim/edits/none.json --runs 8 --missions 50
  ```
- [ ] **Step 2:** Compare with the previous baseline (stored in `sim.db`) using:
  ```bash
  ./sim/compare.py "base=<previous label LIKE pattern>" "new=post-nov16-baseline-%"
  ```
- [ ] **Step 3:** Check whether the money-progression changes moved the ion/chem builds into the target band and whether the mining fuel fix changes mining-bot outcomes.
- [ ] **Step 4:** Record the summary in `docs/TODO.md` under the sim item.

---

## Task 5: Document remaining abstractions

**Files:**
- Modify: `apps/api/sim/README.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1:** Update `apps/api/sim/README.md` "Assumptions every number carries" to list:
  - Mining jobs are free-dig only; board mining contracts are not modeled.
  - Fuel in removed tanks is not modeled (part-stored-fuel abstraction).
  - Escort rescue is not modeled; the bot uses the paid rescue path.
  - First repair fee waiver and min duration are modeled (after Task 2).
  - Mining fuel per tick is modeled (after Task 1).
- [ ] **Step 2:** Update `docs/TODO.md` sim item:
  - Mark snapshot re-export as done.
  - Note that mining fuel burn and first-repair rules are now aligned.
  - Keep the ion-build reactor-wear investigation as open (it is a separate balance question, not a sim drift).
- [ ] **Step 3:** Commit: `docs(sim): document aligned rules and known abstractions`.

---

## Definition of done

- [ ] `pnpm sim export` produces a snapshot matching the live DB rules.
- [ ] `sim-replay --limit 40` reports **40/40 match**.
- [ ] `sanity-bots` passes.
- [ ] New or updated unit tests cover mining fuel burn and first-repair behavior.
- [ ] Four-build baseline has been run and summarized.
- [ ] `apps/api/sim/README.md` and `docs/TODO.md` are updated.
- [ ] No files outside `apps/api/sim/` or docs were modified.
