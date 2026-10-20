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
- [ ] Sim (checked 2026-10-20, see `docs/design/sim-report-2026-10-20.md`): the economy is still good. Open: late money piles up
  (wallet 57-340k at Legendary; decide on a sink or a lower top reward), the ion build still spends 54% on repair, and the greedy / safe temperaments
  and `sim-replay` were not run.
- [ ] Watch: the race e2e needs a race offer on the board (run it first on a fresh database, as CI does).

## Planned (owner, 2026-10-20; plans written, not built)
- [ ] **Fuel on the mission card**: show what you have and what the trip needs in one sentence, three clear states
  (enough, refuel first, too far for this tank), marks on the bar, a chip on the mission rows. Plan:
  `docs/design/mission-fuel-display-plan.md`.
- [ ] **More varied boards**: 8 offers on big ports, 4 on small places, every eligible type once before any repeats,
  and more mission templates. Plan: `docs/design/board-diversity-plan.md`.
- [ ] **Balance, round 5**: the game feels too easy and money is quick to farm (owner, 2026-10-20); wait for the owner's
  tests, then use the sim (`docs/design/sim-report-2026-10-20.md`: late money 57-340k at Legendary).
- Done 2026-10-20: every credit amount x10 (a fresh database is needed: the seed fills prices only when empty); the pad's
  way back pays a tenth (`missions.short_trip_reward_factor`).

