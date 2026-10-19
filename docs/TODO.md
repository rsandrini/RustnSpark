# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## P1 — CI/CD

- [ ] **Keep the CI/CD green.** Every push to `develop` must end with the aggregate `CI` job
  green: quality, unit, web, integration (`test:cov` with the coverage thresholds and the Prisma
  migration diff), compose-check, docker-lifecycle, security and oracle-fixtures-fresh. State on
  2026-10-18: green on the head (`cac994f`), all jobs including the browser smoke. *Standing rules:* (1) the **browser smoke does not
  gate the aggregate** (`continue-on-error`), so a red smoke is a real regression that goes
  unnoticed (the far fields broke the map count and the race board for eight commits): read it on
  every run, and promote it to required once it has stayed green for a week (the last 30 runs are all green, since 2026-10-16; **flip `continue-on-error` on or after 2026-10-24 if it is still green**, owner decision 2026-10-17) (see the comment in
  `.github/workflows/ci.yml`); (2) rapid pushes cancel each other (`cancel-in-progress`), so confirm
  one full run on the head before calling anything done; (3) a CI-only failure is reproduced with a
  full local `test:cov` (cross-suite state), after checking for a stray jest process; the soak
  test prints the rejection reasons when it fails; (4) never edit `baselines.json` by hand
  (regenerate it with `tools/oracle/gen_fixtures.py`).

## Open

- [ ] Late game (parked): the fusion torch engine and the fusion reactor family above nuclear, and a
  pre-warning before a bridge is destroyed. Needs the early and mid economy to hold first.
- [ ] Playtest the new start (2026-10-18): a new pilot gets 750 credits (the old 200 + a basic shield + a small battery),
  both parts are always on the shelf, and the market tip recommends them. Check on a fresh account whether
  players take them and whether the first fights feel fair; then decide on the bigger-bridge test.
- [ ] Sim: chem and hybrid builds still stall now and then on an empty wallet; the ion build's repair
  share is 40-68% of reward at the top; `sim/` could model utility parts outside the ship level. The sim
  also exports from the dev DB, so re-run it on the new map (short and far places, the 5-minute floor).
- [ ] Watch: the race e2e needs a race offer on the board (run it first on a fresh database, as CI does).

## Issues to solve later (owner, 2026-10-19)

- [ ] **A mission that needs more fuel than the ship can ever carry must show a WARNING, not "requirements match".**
  Today a ship with 300 fuel capacity can accept a mission that needs 800 fuel: the card reads as if the
  requirements are met. The board already knows both numbers (`info.estimate.fuelNeeded` and the ship's
  `fuelCap`, used by the "refuelling is not enough" line in `features/board/mission-card.tsx`), so: show a clear
  warning on the card and in the requirements list, say that refuelling will not be enough (more tank capacity
  or a shorter route), and decide whether accepting should be blocked or only warned. Check the server side too:
  `FUEL_INSUFFICIENT` is raised at dispatch, but the eligibility / accept step may not use the tank capacity.
  Add a test for a trip longer than the tank.

