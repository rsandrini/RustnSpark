# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## Next (owner playtest, 2026-10-22)
- [ ] Upgrades (the upgrade tab, materials, costs): to be discussed with the owner after balance round 6 is playtested.
- [ ] Balance round 6b (applied 2026-10-27 in the defaults and the seed, no migration; the dev DB is reset to take it): wear 0.5/0.85 and hull_to_condition 0.15, Epic/Legendary pay x2.5/x3.25, Legendary parts x8. In the sim (r9/r14) the chem builds reach Legendary at ~150 h; Epic comes at ~70 h (target 90-130 h). Retest after the reset, then tune.

## Open

- [ ] Make the browser smoke a required CI job (remove `continue-on-error` in `.github/workflows/ci.yml`) after seven days of green
  runs counted from the first push with the 2026-10-27 e2e fix (owner decision 2026-10-17). The standing CI rules are in `docs/operations.md` section 9.
- [ ] Late game (parked): the fusion torch engine and the fusion reactor family above nuclear, and a
  pre-warning before a bridge is destroyed. Needs the early and mid economy to hold first.
- [ ] Sim (2026-10-27: aligned with the live game, `sim-replay` 40/40, wear and repair money recorded per part in `part_wear`):
  after the reset re-export the snapshot (`pnpm sim export`) and rerun the four builds on the new defaults. Open: the ion build
  (fixed kit: micro + small ion drives and a nuclear plant) still spends ~80% of its income on repair, 20% of it on the reactor,
  and its reactor wear (~900 points a run) is unexplained; Legendary stays out of reach for it.
- [ ] **Ship-structure damage** (owner idea, 2026-10-27, *needs design*): hull damage today spreads over every part alike, so a
  bridge or a reactor wears like a weapon and the dearest parts drive the repair bill (passive parts are ~30% of it, ~44% on
  ion). The idea: spread damage by the layers of the build, outer parts take more and inner ones (bridge, reactors) less, so the
  layout decides the ship's integrity. The resolver sees no positions, so the dispatch snapshot would carry an exposure per
  part; the sim has no layout model yet. The owner is thinking it over.


## Online mechanics (owner, 2026-10-26) - *needs design*

The game has no player-to-player layer yet. Raise questions before starting any of these; they touch the
board, missions, the worker and the web.

- [ ] **Presence at the port:** show how many pilots are in a port right now (and perhaps who, with a privacy switch).
- [ ] **Scheduled player races:** a race that starts at a fixed time; pilots apply and wait, then compete against each
  other (today a race is against generated rivals, `resolution/race`). Needs an apply window, a start job and a result.
- [ ] **Missions together:** invite other pilots to a convoy, a defense or a transport done together (shared reward,
  roles, what happens if one leaves or is lost).
- [ ] **Profile stats:** details per pilot in the profile: distance traveled, fuel consumed, damage taken and given,
  and so on (needs the numbers recorded as they happen; `MissionLog` has part of it).
- [ ] **Global ranking:** a leaderboard over a few good stats (fastest ship, most powerful, ...); decide the stats, how
  often it refreshes and how to keep it fair against exploits.

## Planned / follow-ups (owner, 2026-10-20)
- [ ] **Balance, round 5**: the game was too easy and money was quick to farm (owner, 2026-10-20). Sim check
  `docs/design/sim-report-2026-10-22.md`, plan `docs/design/balance-round-5-plan.md`. **Applied 2026-10-22** (reward at
  the top flatter, pirates above parity in zones 2-3, Epic parts x2 and Legendary x3 dearer; migration
  `20261022000000_balance_round_5`). Retest in the sim on the new numbers and tune; Rare must stay comfortable.
- Done 2026-10-20: every credit amount x10 (a fresh database is needed: the seed fills prices only when empty); the pad's
  way back pays a tenth (`missions.short_trip_reward_factor`).

