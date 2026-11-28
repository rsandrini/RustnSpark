# To do - v0.1.6

Delete an item when it ships.

v0.1.5 was released on 2026-11-27 (tag `v0.1.5`). Everything it did not finish is here; the history stays in `TODO_v0.1.5.md`.

## 1. Ship-structure damage (owner idea, 2026-10-27; moved from v0.2 to v0.1.5, then to v0.1.6 on 2026-11-23)

- [ ] Hull damage today spreads over every part alike, so a bridge or a reactor wears like a weapon and the dearest parts drive the
  repair bill (passive parts are ~30% of it, ~44% on ion). The idea: spread damage by the layers of the build, outer parts take more and
  inner ones (bridge, reactors) less, so the layout decides the ship's integrity. The resolver sees no positions, so the dispatch
  snapshot would carry an exposure per part; the sim has no layout model yet. *Needs design.*

## 2. Bugs found testing in prod (owner, 2026-11-27)

- [ ] **False "your ship cannot fly" on Scavenging.** `port.scav.handicap` ("Sua nave não pode voar agora…") shows when the ship
  cannot fly **or has any warning** (`port.page.tsx`, `shipHandicapped`; the server halves the find chance on the same test,
  `dispatch.service.ts` / `scavenge-job.service.ts`). Seen in prod with only `SHIELD_ENERGY_LOW`. When the ship can fly, say it flies
  with warnings, name them, and say the search finds less. **Decide:** should a warning halve the finds at all?
- [ ] **A place that cannot be mined hides the Mining tab with no explanation.** Seen at `echo` (a Sun relay: no active MINING
  template covers `relay`; `mining_sun_quarry` covers garrison, port, junction and `mining_claim_sun` the claims). Say "no mining
  here" instead. Content choice (owner, no code): add `relay` to a template's `originTypes` in Admin.
- [ ] The earlier prod report "ship not viable" on mining: the message now lists the server's reasons (v0.1.5). If it returns, note them.
- [ ] Mining, travel and dispatch also refuse too many loose spare parts (limit `ship.spare_part_slots`), and mining checks engine and
  weapon direction strictly; the Ship screen checks neither, so a ship can look fine and be refused. Show the same problems there.
- [ ] A laser (or any weapon) without enough combat energy never fires and nothing says so (40 rounds, 0 shots, in a lost rescue).
  Add a fight-report line and a mission-card / dispatch warning. **Decide:** should reactor power count in combat, or only batteries?
- [ ] `ships.service.ts` never passes `missionCargo` to `computeHold` (only dispatch does), so the ship response's
  `hold.used`/`missionCargo` are always 0; the web re-derives the load in `hold-load.ts` and may drift: fill them in the server.
- [ ] A partly used hold blocks delivery trips in fixed/open modes (`cargoLoadFor` caps units at the whole hold, not the free room:
  refused with `SHIP_NOT_VIABLE`).

## 3. New mission types (from v0.1.5 item 5b)

Owner decisions: take the recommendations of `docs/superpowers/plans/2026-11-26-new-mission-types-options.md`; build order explore
(shipped), repair, fight.

- [ ] **Tank cargo** (water, chemicals, fuel). Plan ready, 9 tasks: `docs/superpowers/plans/2026-11-26-tank-cargo-missions.md`
  (proposed kinds, sizes, prices and pay; the owner has not confirmed them).
- [ ] **Repair something:** a new Repair Rig part, built on the explore shared steps. Needs its plan.
- [ ] **Fight in a zone:** waves on site, a score, a share of the pay below the target. Needs its plan, with item 7 and the sim.
  **Open:** does the lost-fight fee apply to a fight contract?
- [ ] Others of the same kind (each asks for the part that fits it).

## 4. Explore leftovers (shipped in v0.1.5 without these)

Plan: `docs/superpowers/plans/2026-11-26-explore-missions.md`.

- [ ] Task 8, skipped by the owner: the sim mirror (the scan time and fuel are not in the sim; check that the bots' `HAULER_TYPES` in
  `sim/bots/playstyle.ts` should include EXPLORE) and the balance gate.
- [ ] No whole-feature review, and the web part (Task 7) had no review of its own.
- [ ] A refused explore offer's time estimate still includes the scan time.
- [ ] Independent mining jobs still log a false dispatch time-drift warning (server log only). One mining-job int test ("refuses a dig
  the tank cannot pay for") failed once and passed on 4 reruns.

## 5. Hard mode: start with no flag, no money, no ship (owner, 2026-11-24) - plan ready

- [ ] A pilot can start WITHOUT a faction to fight for. This is the hard mode. It starts with no money and no kit: everything is
      collected from scrap (scavenging), and the pilot picks the start point among "safe" places. Once enough is collected to mount a
      ship, it was built without any help, and the pilot pays the price as a neutral, not as a friend of a faction.
- Written as "0.1.4" in the request; v0.1.4 already shipped, so it is filed on the open list and flagged _needs plan_. Consider
  v0.2: it touches onboarding, the economy and the factions at once.
- What exists today (checked 2026-11-24): onboarding picks a faction and creates the pilot with `start_credits` and the starter kit
  (`onboarding.service.ts`: `starter_parts`, start fuel); a `free` faction already exists (the mentor NPCs belong to it); prices
  apply the player's faction relation to the place's faction (`pricing.service.ts`, `relationOf(...)`), so "neutral" can be a
  relation of its own; scavenging exists (scrap, drops) and scrap sells at a fixed price everywhere.
- To plan: how a pilot with no ship and no money moves and earns (scavenge on foot? from a start station?); the list of "safe"
  start places and how the pilot picks one; how much scrap buys the first ship (a minimum viable ship by the part catalog) and
  whether a cheap used hull is sold; the neutral price relation (worse prices and what else); whether the pilot can join a faction
  later and how; the guide and the opening for this mode; ranking (a separate board or the same); the sim to tune the scrap economy.
- Open question for the owner: is "start with nothing" a choice on the faction screen (a fourth card) or a separate "hard mode" switch?
- **Decisions (owner, 2026-11-26): use the defaults, except the prices.** Entry = a fourth card on the faction screen ("Independent"); start place = the ports of the safe core zones 0 and 1, the pilot picks one; earns by scavenging at the start place and selling scrap at the fixed price; first ship = buy parts and assemble (the sim sets the minimal ship price); all missions at normal pay; can join a faction later (one-way, no penalty); ~~a separate "Independent" ranking board~~ **(owner, 2026-11-27) independents appear on the rankings as normal pilots, no distinction** (same boards, no filter, no label). **Prices: no penalty and no discount for an independent** (the neutral relation, factor 1.0). Prices already depend on the player's relation to the place's faction (`economy.faction_mult`: ally 0.8, neutral 1.0, hostile 2.5; the seed has no ally and nobody lists itself, so buying in your own faction's port gets no discount today): see item 9 for the own-faction discount.
- **Plan ready and reviewed (2026-11-27), 9 tasks:** `docs/superpowers/plans/2026-11-26-hard-mode-independent-start.md`. Open for the
  owner: pirate ports charge an independent the neutral price; the code predicts a first ship in about 1 game hour (making it slower
  needs an independent-only setting).

## 6. Route planning and manual refuel stops (from v0.1.5 items 5c / 5d; build it LAST)

- [ ] Plan ready, 7 tasks: `docs/superpowers/plans/2026-11-25-slice-2-2-route-fuel-planning.md`. A stop is manual (dock, act, "Continue
  the trip"), docked time is real time, prices unchanged, amber under 20% of the tank. Owner 2026-11-26: fuel is sold at every place;
  an Admin list of place types that do NOT sell it, empty by default.

## 7. A lost fight costs a fee for the lost cargo and the broken contract, scaled by zone (owner, 2026-11-26) - *not started*

Today a lost combat encounter debits a flat `economy.combat_loss_penalty` (1200) per lost fight, whatever the zone or the reward. It comes from the 2026-10-23 rule ("a won fight pays nothing; a lost one costs a penalty"); the 1200 was in the first config and no balance round chose it. The owner feels it reads like the pirates are robbing money.

- [ ] **Decided (owner, 2026-11-26): option 1, scale the penalty by zone**, like the wear already is (`combat.loss_wear_scale` is 0.1 / 0.3 / 0.4 / 0.5 by zone 0-3; a first guess for the money scale: 10% / 30% / 40% / 100% of the base, as admin knobs, DB wins). Needs the sim before any change (it changes income).
- [ ] **Say what it is:** the amount taken is a FEE for the cargo lost and the contract broken, not a theft by the pirates. Name it so in the report and the result popup (en + pt-BR), and in the Admin knob description.
- [ ] Owner's thinking to settle in the plan: when the mission carries cargo, a lost fight loses the cargo and the contract pays zero; when pirates only want a fight, the worst case damages parts of the ship (already so) and nothing else; the money fee is for not completing the mission. Decide whether the fee applies when there was no cargo, and whether it can exceed the mission's reward.
- Do NOT build now; plan it with the next balance round.

## 8. Pirate places have fewer offers and favour mining (owner, 2026-11-26) - *not started*

Owner, about adding escort/mining templates at places that lack them, and the pirate places `veil` and `drift`: "IDK to be honest, maybe? I think those pirate places should have less jobs available. Or at least less jobs. The place will be good for mining tho."

- [ ] Pirate places (`veil`, `drift`) get FEWER offers on their boards than other places of their size and favour MINING offers (they are good mining places). No new escort templates there.
- [ ] Likely shape: an Admin knob for a board-size factor per faction/place tag. First guess: board size = 50% of the normal for the place detail, mining preferred in the board composition. Extend `apps/api/src/missions/board-composition.ts` and `board-size.ts`.
- [ ] Needs a small plan. Sim check: income per hour must not regress.

## 9. A 10% discount for buying in a port of your own faction (owner, 2026-11-26) - *not started*

Prices already depend on the relation of the player's faction to the place's faction (`economy.faction_mult` in `pricing.service.ts` / `price.calculator.ts`: ally 0.8, neutral 1.0, hostile 2.5, same for buy, sell and repair). Nobody is `ally` in the seed and a faction does not list itself, so your own faction's ports charge the neutral price today.

- [ ] Add an `own` relation: when the place's faction is the player's own faction, apply `economy.faction_mult.own` = 0.9 (an Admin knob, DB wins; check that selling stays below the cheapest purchase so the haul and repair loops stay closed: sell uses `min(1, isolation x faction)`, so a discount does not raise sell prices). Independent pilots (item 5) are never "own": no discount. Needs the sim (it changes costs).
- [ ] Decide with it whether the discount applies to fuel and repair too (`repair-cost.calculator.ts` and refuel use the same factor).

## 10. Balance and sim (decisions open)

- [ ] **Board mix** (v0.1.5 item 5a): the gate failed. Ion-shield levels 11-18% later in every run of the new board; chem 95.9%,
  chem-shield 94.3% of the old income. Suggested: make the forced long and people-transport slots optional, or raise short-job pay.
- [ ] **Ship specialty** (v0.1.5 item 1): the gate failed (hybrid 92.7% income, level 3 +18.9%). The owner kept the escort defaults;
  if revisited, `specialty.escort.per_danger` 0.015 -> 0.005 is the first knob. The bots never take TRANSPORT, so its minimum is
  untested by the sim.
- [ ] Sim bot: stalls after failed, unpaid danger 9-10 escorts (broke and dry); hop first, then tow, with a higher tow cap.
- [ ] Transport pay rose about 25% with passenger head counts (v0.1.5 items 6/8): never measured on its own.
- [ ] Re-export `apps/api/sim-data/snapshot.json` before the next sim round. The sim mirror stretches on the unscaled offer when the
  bridge-scaling what-if hook is on.
- [ ] Content (owner): escort and mining templates are missing at some places (escort at drift, echo, veil, nadir and local stops).
  The owner kept escort as it is (2026-11-26).

## 11. Checks never done

- [ ] Browser e2e specs not brought up to date or passed for v0.1.5 (CI treats the browser smoke as non-blocking and it was cancelled).
- [ ] No browser review by us of UI slices 1.5-1.7, the review rounds, the Hold tab, or the i18next 26 upgrade.
- [ ] Known from the browser checks of slices 1.1-1.4: axe flags the HUD outside a landmark; layout shift on cold load; on a 667 px
  phone the map sheet leaves little map; while adrift the sheet still draws a route preview from the last port.

## 12. UI polish (owner: features first)

- [ ] (owner, 2026-11-27, "I really hate that") Ship screen drag: remove the weight/resistance on a carried part. It follows the
  pointer exactly, with no lag or easing, mouse and touch.
- [ ] (owner, 2026-11-27) Ship screen drop: releasing a carried part OUTSIDE the ship-drawing box removes it from the ship (back to
  the hold), not only when dropped on the discard area on the left.
- [ ] (owner, 2026-11-27) Ship screen: let the pilot collapse the RIGHT column too, so the ship view gets the room (the other side
  can already be hidden); remember the choice like that one.
- [ ] Goods rows: per-item Sell button names, a row total, a named group region.
- [ ] A larger touch area for the repair/refuel slider thumb; the TankChart target line and corner nits.
- [ ] Help tips: a name per topic (all read "Help"), a 44x44 touch area.
- [ ] Contract cards repeat the ship-faults line in their chips.
- [ ] Per-tank fuel from the server (the tank chart estimates it).
- [ ] Not built from slice 1.6: the rank/XP bar and medals (need game design).

## 13. Deferred "to a later version" (owner, 2026-11-26)

- [ ] The port as a place (UI slice 1.8; needs a mockup approval).
- [ ] The art for the parts (slice 1.9; needs the owner's drawing ideas).
- [ ] The map about 5x bigger, with missions of 8+ hours and far zones; raise `missions.board_long_min_seconds` with it.
