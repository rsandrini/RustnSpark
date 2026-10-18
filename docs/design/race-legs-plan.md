# Race: one rule for everyone, settled leg by leg (plan, not built)

Owner: "we need to have the same rule for all, so it should affect all players. We can also have
some players forcing their engines along the race. This will keep it more dynamic." And: calculate
between legs, for a more accurate grid and feedback for the player.

## 1. What exists today (facts, from the code)

- `resolveRace` (`apps/api/src/resolution/race/race.resolver.ts`) runs **once, at the end**, with the
  whole trip as one number: `finish = total distance / mobility x duration_k`.
- **The rivals** only get a drawn speed (`mobility`, frozen in `cargo.race.competitors` at offer time),
  a "form" on the day (+-10%), a luck factor (+-8%) and one 8% chance of "trouble" (+30% time). They
  ignore the route: terrain, danger and the number of legs mean nothing to them.
- **The player** has the same speed formula, but the *real flight* adds things the rivals never feel:
  the route's environments (fuel, speed), encounters and damage, and the engine tuning set on the
  bridge (`chemLevel` / `ionLevel`, one level for the whole run). Tuning raises thrust and, per leg,
  rolls a failure (`engine_tuning` / `engine_push` events in `leg.resolver.ts`). The race only
  counts those failures as a flat `+30% x failures` on the final time.
- The report shows one final table (`debrief-race`); the Ship screen shows the rival list once
  (`RaceRivals`); no one sees positions during the trip.
- The field follows the player's speed (`race.field_follow` 0.6), so a fast ship is never alone.

So the rules are not the same: the player runs a route, the rivals run a number.

## 2. Goal

1. **Same rules for every ship** in a race: the same route, the same terrain effects, the same engine
   tuning rule (more thrust, a chance of a failure that costs time and wear), the same luck.
2. **Settled leg by leg**: each leg gives every ship a time, so there is a standing after every leg,
   not only a final table.
3. **Dynamic**: rivals may push their engines on some legs (and pay for it); the player's own push is
   the same lever. Pace changes during the race, places swap.
4. **Feedback**: the report tells the story leg by leg; the Ship screen shows where you are while
   flying; the board explains the rules so the pilot can plan the push.

## 3. The model (one pure function, used for everyone)

For each ship `s` and each leg `i` (distance `d_i`, terrain from the route's environments):

```
speed(s,i)  = mobility(s) x form(s) x terrain_speed(i) x push_gain(level(s,i))
time(s,i)   = d_i / speed(s,i) x duration_k x luck(s,i)
            + (mishap(s,i) ? mishap_penalty x time_without_mishap : 0)
cumulative(s,i) = sum of time(s,1..i)
```

- `terrain_speed(i)` and `push_gain(level)` are the **existing** formulas (route environments, and the
  engine tuning in `applyEngineLevels`), not new ones: one source for the player and the rivals.
- `luck(s,i)` is drawn per leg (smaller spread than today, so the sum over the trip stays about the
  same).
- `mishap(s,i)`: for a pushing ship, the existing `mishapChance(group, level, condition, rules)`;
  for a ship at level 1, the small base chance (`race.mishap_chance`, per leg, divided over the legs).
- **Rival push policy** (the dynamic part). Each rival has a *temperament* frozen with the offer
  (`steady`, `bold`, `cautious`), and on each leg picks a level from the **standing so far**:
  trailing ships push harder (catch-up), leaders ease; a `bold` rival pushes more often. The choice
  is made with the seeded rng of the race, so it is deterministic and the report replays it.
  Rivals use the same `mishapChance` as the player at their level, with a nominal engine condition
  (they are not worn), so pushing really is a gamble for them too.
- **The player's real legs** stay the source of truth for the player: leg time from the flight
  (route, tuned thrust), a push failure on leg `i` costs time on leg `i` (not a flat share at the
  end). Encounters that delay the player (a fight) cost the same seconds on that leg.
- **Same rule for all** also covers the **route**: a rival crosses the same legs, so a slow
  environment slows everyone, and a long route with a rough leg changes who is ahead.

Output of the pure function:

```
RaceTimeline { legs: [{ index, standings: [{ name, you, legSeconds, totalSeconds, level, trouble? }] }],
               final: RaceResult }   // same RaceResult as today (place, prizeShare, standings)
```

`final` keeps today's shape, so the prize rules and the places stay as they are.

## 4. Decisions (recommendation first; "as recommended" approves all)

1. **Where do the rivals' temperaments come from?** Generated with the offer and frozen in
   `cargo.race.competitors` (a new `temperament` field). Old offers without it count as `steady`.
   *Recommended.* (The alternative, drawing it at resolve time, breaks the "what you saw on the board
   is the race you fly" promise.)
2. **Live position during the flight.** The worker resolves at the end of the trip, so during the
   flight the Ship screen shows a **projection**: the rivals' timeline is deterministic (computed from
   the frozen field and the route), the player is projected at their listed speed. It is labelled
   "projected". The report shows the exact result. *Recommended for v1.* (Exact live positions would
   need the mission to resolve leg by leg while flying, a much larger change to the job system.)
3. **Does a rival retire (DNF)?** No: a mishap costs time, like the player's. *Recommended*, keeps
   every race with a full standings table.
4. **Balance.** Prize shares (1.6 / 0.8 / 0.4) and `field_follow` stay; the per-leg spreads are set
   so the *total* spread matches today's (the check below). The sim gets a race scenario to confirm
   the win rate by speed and by push level.
5. **Player-side push stays per run** (bridge levels), not per leg: a per-leg player choice needs the
   interactive flight we do not have. The "dynamic" part for the player is the choice of level
   before the start and the fact that rivals now react.

## 5. Work, in order

**R1 - The rule, pure (API, no UI).** `race.resolver.ts`: `resolveRaceTimeline` as above, reusing the
engine-tuning and terrain formulas (move whatever is private into a shared module). Tests first: same
seed gives the same timeline; the final equals the sum of the legs; a faster ship wins more often
over many seeds; pushing is faster on average and fails sometimes; a rough leg slows everyone; old
offers (no temperament) still resolve; a one-leg race equals the old final within the spread.

**R2 - Wiring and storage.** `mission.resolver.ts`: build the player's per-leg times from the leg
events (including `engine_push` per leg and delays), call the timeline, store it in the
`race_result` event (`race.legs`). `generateCompetitors` adds `temperament`; `parseCompetitors`
defaults it. Contract: `race.legs` optional in the report event schema (old reports have none).
New admin-tunable rules under `race.*` (per-leg luck spread, push policy weights, temperament
shares), registered with the usual registry entries and a migration for the DB.

**R3 - Report.** The debrief shows the final table as today plus a **leg-by-leg strip**: after each
leg, who led and your place, and one line per notable event ("overtook X on the ice leg", "your push
failed on leg 3, -40 s", "Vega Dart pushed and held"). Falls back to the final table when `race.legs`
is missing. Bilingual (en + pt-BR), no hard-coded strings; keyboard and axe pass.

**R4 - Board and Ship.** The board card explains the rule in one line and shows the rivals'
temperaments ("bold" / "cautious") next to speed, so the pilot can choose a push level; the Ship
screen shows the projected standings strip while flying ("projected").

**R5 - Close.** Guide topic text and the Admin tuning screen for the new `race.*` keys; the race
e2e extended (the report shows the leg strip); sim race check; a short balance note in
`docs/TODO.md`; the dev DB takes the new rules by migration, the seed by defaults.

## 6. Risks and how we cover them

- **Old data**: reports and offers made before this have no `legs` / `temperament`; every reader
  treats them as optional, and a test covers each.
- **Determinism**: the report replays from the stored log, so every random draw uses a labelled
  child of the race rng (`rival-3|leg-2|luck`), never an order-dependent stream.
- **Balance drift**: the total spread is kept near today's; we compare win rate by speed before and
  after with the same seeds (R1 test, then the sim).
- **Race e2e needs a race offer**: it keeps running first on a fresh database (as CI does).

## 7. Not in this plan

Interactive per-leg decisions for the player, rivals that attack or block, DNF, and exact live
standings while flying (decision 2).
