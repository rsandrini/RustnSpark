# Simulation check after the October changes (2026-10-20)

Why: since the last balance round (round 4, 2026-10-16) the game changed a lot: the reward by bridge rarity, the
5-minute floor for short trips, 29 places (6 local service stops, 4 far places, 3 test pads), the market
tip and 750 start credits, a quarter-full starting tank, the race rule, the first mission to a test pad. This
checks that the economy is still good.

Method: snapshot re-exported from the dev DB (fresh seed, all current defaults), then the same experiment as in the
balance rounds: 4 builds (chem, chem-shield, ion-shield, hybrid), balanced temperament, generalist, 8 runs x 300
missions each, seed 1, game-clock hours (`sim/run-parallel.sh`). Three runs: `oct20-base` (the game as it is),
`oct20-revert` (the same snapshot with the start credits, the starting tank and the short-trip floor put back to
their old values, to measure what today's changes did) and `oct20-final` (after the pad fix below). Round-4 (`epic-v1`)
and the reward-by-bridge round (`p3base`) are the earlier references; they come from older snapshots, so they are
read as orders of magnitude, not to the hour.

## 1. Pace to each level (median game hours, runs that got there)
| build | L2 | L3 | L4 (Epic) | L5 (Legendary) | repair share | fuel share |
|---|---|---|---|---|---|---|
| chem, now (final) | 13 h | 24 h | 44 h | 60 h | 24% | 9% |
| chem-shield | 16 | 29 | 47 | 71 | 25% | 8% |
| hybrid | 16 | 33 | 50 | 97 | 26% | 7% |
| ion-shield | 22 | 39 | 61 | 134 | 54% | 0% |
| round 4 (chem / hybrid / ion) | 17 / 16 / 57 | 31 / 34 / 70 | 56 / 56 / 91 | 107 / 107 / 191 | 49-62% | 12% |
| reward-by-bridge round (p3) | 16 / 16 / 19 | 37 / 32 / 30 | 53 / 50 / 70 | 106 / 105 / 164 | 37-64% | 13% |

Everyone reaches Legendary in the 300 missions (round 4: 17 of 32 runs did not, and 3 stalled). Stalls: 0 in the final
run, 1 of 32 in the first one (a chem run at mission 26 that could not pay the fuel), within the 0-3 of 32 of earlier
rounds. Epic comes at 44-61 h (the owner's target was a fast v1 to Epic), Legendary at 60-134 h.

## 2. What today's own changes did: nothing measurable
`oct20-revert` against `oct20-base` (same snapshot): Legendary 73 / 62 / 78 / 140 h against 71 / 66 / 97 / 139 h,
Epic 50 / 47 / 50 / 54 against 49 / 50 / 49 / 59. The 750 start credits, the quarter-full tank and the 5-minute floor
move the first hours by a few hours at most. The faster pace against round 4 comes from the reward by bridge
rarity (the repair share fell from 49-62% to 22-26%, as that round predicted), not from this week's work.

## 3. Findings
1. **Money piles up late.** The wallet when a run reaches Legendary: chem 57k, chem-shield 134k, hybrid 340k, ion 71k
   (round 4: 36-96k; p3: 39-117k). Money is no longer a limit near the top (the owner's wish was "money is useful up to
   L5"). The ion build still spends 54% of its income on repair, the one real sink. Not a bug; a balance decision
   for you: a sink at the top (a price curve on Epic / Legendary upgrades or on bridge expansion), or fewer credits
   per mission at Legendary (the `reward_by_bridge` top entry).
2. **Test pads were a small loophole, now partly closed.** A pad board offered generic missions (mining, escort) as
   well as its way back (found in the first run); fixed: a pad offers only `pad_return_*` (`template.filler.ts`, with
   a test). What is left: the way back pays about 550 for a 27-second trip (about 68k credits an hour against 22k for
   an ordinary mission). In the sim the bots take about 7 of them per run (7% of missions, under 1% of income), so it
   does not move the economy, but a real player could repeat it as the board refreshes. Suggested fix, not done: the
   reward of a trip shorter than `short_trip_exempt_below` scales down with its distance (30 of 60 = half, or a flat
   token amount).
3. **The new local stops are used, and pay about the same.** 45% of the missions start or end at one of the six
   stops; their length is the same as the rest (1134 against 1179 distance) and they pay about 16% more per hour
   (the short trips). No exploit; the far places (thule, nadir, cinder, lantern) are 2.6% of missions, as intended
   (they need big tanks).
4. **The sim now starts like the game**: the ship begins with `onboarding.start_fuel_fraction` of its tank (it was
   full). The never-spends check of `sanity-bots.ts` allows the fuel it now has to buy; every other sanity check passes.
5. **Not checked**: `test/validation/sim-replay.ts` (it replays real missions from the database, which was just reset);
   the greedy and safe temperaments (only balanced was run); the race rule's balance (races pay about the same as other
   missions: 4.7k against 4.2-5.2k, 12% of the missions).

## 4. Verdict
The economy is still good: faster than round 4 and no stalls to speak of, with Epic early and Legendary reachable in
every build. The one thing to decide is the late money (finding 1); the pad reward (finding 2) is cheap to fix when you
want it. The experiments are stored in `sim-data/sim.db` (`oct20-base`, `oct20-revert`, `oct20-final`).
