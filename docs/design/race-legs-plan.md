# Race: one rule for everyone, settled leg by leg (built, 2026-10-18)

Status: built, including the projected standings on the Ship screen while flying (R1-R5). Earlier note: R1-R3 and the board / Ship rival levels were built (resolver, storage, report leg strip, rivals' engine
level on the board and the Ship screen, `race.rival_push_chance` replaces `race.form_spread`). The
*projected* standings now show on the Ship screen while flying: `info.race.projection` is computed with the
mission's own seed (exact unless a pushed engine fails), and the screen shows the order after the last finished
leg. Terrain does not change speed in this
game (duration is distance / mobility), so the model has no terrain term.

Owner: "we need to have the same rule for all, so it should affect all players. We can also have
some players forcing their engines along the race. This will keep it more dynamic." And: calculate
between legs, for a more accurate grid and feedback for the player.

## 1. What existed before this change (facts, from the code)

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
3. **Dynamic but fair**: a rival may run pushed engines for the whole race (and pay for it, like the
   player); within a race, places swap leg by leg because of the per-leg luck and mishaps.
4. **Feedback**: the report tells the story leg by leg; the Ship screen shows where you are while
   flying; the board explains the rules so the pilot can plan the push.

## 3. The model (one pure function, used for everyone)

**Nobody changes behavior during the race.** The player sets the engine levels before the start and
cannot touch them on the way, so a rival is the same: its **speed and its engine level are fixed
when the offer is made, frozen in `cargo.race.competitors`, shown on the board, and used to the
end.** The race is then decided by exactly two rolls, the same for every ship, and nothing else.

For ship `s` on leg `i` (distance `d_i`):

```
base(s,i) = d_i / speed(s) x duration_k          speed = mobility x terrain_speed(i) x push_gain(level(s))
time(s,i) = base(s,i) x luck(s,i)                luck(s,i) = 1 + uniform(-leg_luck, +leg_luck)
          + mishap(s,i) ? base(s,i) x mishap_penalty : 0        mishap(s,i) = random < mishap_chance(level(s))
total(s)  = sum over legs
```

- **We never roll the distance.** Distance is the route's; what is rolled is the *time* each ship
  takes on each leg (`luck`) and whether an engine fails on that leg (`mishap`).
- `terrain_speed(i)`, `push_gain(level)` and `mishap_chance(level)` are the **existing** formulas
  (route environments; `applyEngineLevels`; `mishapChance` in the leg resolver). One source for the
  player and the rivals. A rival uses a nominal engine condition (not worn).
- The old hidden "form" roll at the end is **dropped**: a rival's speed is what the board shows, so
  what you see is what races. (Its randomness moves into the per-leg `luck`.)
- A rival's `level` is drawn at the offer (mostly 1, sometimes a push), by the offer's seed: the board
  shows "speed 3.1, pushing 1.3". A pushing rival is faster on average and fails more often, exactly
  like the player's own choice.
- The player's real legs stay the source of truth for the player (route, tuned thrust, delays from
  fights); a push failure on leg `i` costs `mishap_penalty` of leg `i`, not a flat share at the end.

### What decides a race when everyone has the same speed

Same speed, same level, same route: `base` is identical, so only the two rolls differ.
- **Luck.** Each ship's total is the sum of its leg times, each stretched or shrunk by an independent
  draw within +-`leg_luck` (8% by default). The order is a coin toss weighted by the draws; with more
  legs the draws average out (the spread of the total shrinks roughly by the square root of the
  number of legs), so a long multi-leg race is *less* random than a one-leg sprint.
- **Mishaps.** Each leg is a small chance of a failure that adds 30% to that leg. At level 1 the chance
  is the base rate; pushing raises it. So equal ships are separated by luck and by who got hit.
- **Ties** go to the rival (as today). The player's place is the rank of the totals.
- **Faster ships win more often, not always.** A ship 10% faster beats an equal-luck field most of the
  time, and a bad leg can still cost it a place. That is the dial: raise `leg_luck` for more upsets
  and more position swaps between legs; lower it for a race decided by speed.

Output of the pure function:

```
RaceTimeline { legs: [{ index, standings: [{ name, you, legSeconds, totalSeconds, mishap }] }],
               final: RaceResult }   // same RaceResult as today (place, prizeShare, standings)
```

## 4. Decisions (recommendation first; "as recommended" approves all)

1. **Rivals' behavior is fixed for the whole race** (owner): speed and engine level drawn at the offer,
   frozen, shown on the board. No reaction to the standings. *Decided.* Old offers without a level
   count as level 1.
2. **Live position during the flight.** The worker resolves at the end of the trip, so during the
   flight the Ship screen shows a **projection** (rivals' timeline from the frozen field and the route,
   the player at their listed speed), labelled "projected". The report shows the exact result.
   *Recommended for v1.* (Exact live positions need the mission to resolve leg by leg while flying.)
3. **Does a rival retire (DNF)?** No: a mishap costs time, like the player's. *Recommended.*
4. **Balance.** Prize shares (1.6 / 0.8 / 0.4) and `field_follow` stay; `leg_luck` is set so the
   *total* spread over a typical route matches today's; the sim confirms the win rate by speed and
   by push level. `leg_luck` is Admin-tunable.
5. **Player push stays per run** (bridge levels): same as the rivals, fixed before the start.

## 5. Work, in order

**R1 - The rule, pure (API, no UI).** `race.resolver.ts`: `resolveRaceTimeline` as above, reusing the
engine-tuning and terrain formulas (move whatever is private into a shared module). Tests first: same
seed gives the same timeline; the final equals the sum of the legs; a faster ship wins more often
over many seeds; pushing is faster on average and fails sometimes; a rough leg slows everyone; old
offers (no engine level) still resolve; a one-leg race equals the old final within the spread.

**R2 - Wiring and storage.** `mission.resolver.ts`: build the player's per-leg times from the leg
events (including `engine_push` per leg and delays), call the timeline, store it in the
`race_result` event (`race.legs`). `generateCompetitors` adds a fixed engine `level`; `parseCompetitors`
defaults it to 1. Contract: `race.legs` optional in the report event schema (old reports have none).
New admin-tunable rules under `race.*` (per-leg luck spread, the share of rivals that push and their level range
shares), registered with the usual registry entries and a migration for the DB.

**R3 - Report.** The debrief shows the final table as today plus a **leg-by-leg strip**: after each
leg, who led and your place, and one line per notable event ("overtook X on the ice leg", "your push
failed on leg 3, -40 s", "Vega Dart pushed and held"). Falls back to the final table when `race.legs`
is missing. Bilingual (en + pt-BR), no hard-coded strings; keyboard and axe pass.

**R4 - Board and Ship.** The board card explains the rule in one line and shows the rivals'
each rival's engine level ("pushing 1.3") next to speed, so the pilot can choose a push level; the Ship
screen shows the projected standings strip while flying ("projected").

**R5 - Close.** Guide topic text and the Admin tuning screen for the new `race.*` keys; the race
e2e extended (the report shows the leg strip); sim race check; a short balance note in
`docs/TODO.md`; the dev DB takes the new rules by migration, the seed by defaults.

## 6. Risks and how we cover them

- **Old data**: reports and offers made before this have no `legs` / `level`; every reader
  treats them as optional, and a test covers each.
- **Determinism**: the report replays from the stored log, so every random draw uses a labelled
  child of the race rng (`rival-3|leg-2|luck`), never an order-dependent stream.
- **Balance drift**: the total spread is kept near today's; we compare win rate by speed before and
  after with the same seeds (R1 test, then the sim).
- **Race e2e needs a race offer**: it keeps running first on a fresh database (as CI does).

## 7. Not in this plan

Interactive per-leg decisions for the player, rivals that attack or block, DNF, and exact live
standings while flying (decision 2).
