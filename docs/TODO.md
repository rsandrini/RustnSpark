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
  every run, and promote it to required once it has stayed green for a week (**the smoke was red on every run from 2026-10-23 (`b2eeea6`) to the head**: two dialogue specs were stale after the welcome-skip change, fixed 2026-10-27, full run 66/66 green on a fresh stack; **flip `continue-on-error` after seven days of green runs counted from the first push with the fix**, owner decision 2026-10-17) (see the comment in
  `.github/workflows/ci.yml`); (2) rapid pushes cancel each other (`cancel-in-progress`), so confirm
  one full run on the head before calling anything done; (3) a CI-only failure is reproduced with a
  full local `test:cov` (cross-suite state), after checking for a stray jest process; the soak
  test prints the rejection reasons when it fails; (4) never edit `baselines.json` by hand
  (regenerate it with `tools/oracle/gen_fixtures.py`).

## Next (owner playtest, 2026-10-22)
- [ ] Upgrades (the upgrade tab, materials, costs): to be discussed with the owner after balance round 6 is playtested.
- [ ] Balance round 6 is applied (wear -30%, pirates by bridge x1.35/x1.7, Epic x1.5 / Legendary x2 prices): retest in the sim; Epic still comes at ~50 h (target 90-130 h) (the Common/Uncommon start is in owner playtest, 2026-10-26).

## Open

- [ ] Late game (parked): the fusion torch engine and the fusion reactor family above nuclear, and a
  pre-warning before a bridge is destroyed. Needs the early and mid economy to hold first.
- [ ] Playtest the new start (updated 2026-10-26): a new pilot gets 3000 credits (was 750, then 7500 after the x10 prices) and a
  starter kit with a weapon and a solar reactor; a basic shield and a small battery are always on the shelf and the market tip
  recommends them. Checked 2026-10-27 at Ceres on a fresh pilot (3000 credits, tank at a quarter): a new battery_small costs 1380,
  a new shield_basic 3679 (more than the start), a used shield_basic (52%) 1913, so the pilot can buy the battery plus a
  used shield only if short by about 300 and not at all with a refuel; "the money for one" in the tip is right. Still to
  do by hand: whether the first fights feel fair; then decide on the bigger-bridge test.
- [ ] Sim (re-checked 2026-10-26, the sim is aligned with the live game and `sim-replay` matches 40/40): the late-money pile-up is gone,
  the opposite holds now: with round 6 every build stalls at Epic (repair is 72-84% of income, nobody reaches Legendary in 800 missions).
  The `r8-*` runs (wear 0.5 / 0.6 against the current) decide round 6. Open after that: the ion build spends 79-94% on repair under every
  wear edit (needs its own lever, not the wear scale).

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

