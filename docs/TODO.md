# To do

The owner's backlog, by priority (P0 first). Items are written as the owner asked for them, with a
note on where the code lives so whoever picks one up can start quickly. Delete an item when it
ships (the commit has the history). Raise questions before starting anything marked *needs design*.

## P1 — CI/CD

- [ ] **Keep the CI/CD green.** Every push to `develop` must end with the aggregate `CI` job
  green: quality, unit, web, integration (`test:cov` with the coverage thresholds and the Prisma
  migration diff), compose-check, docker-lifecycle, security and oracle-fixtures-fresh. State on
  2026-10-14: green on the head (`c6d7341`) after the heap (8 GB), resolve transaction (30 s),
  connection pool (20) and repair-test fixes. *Standing rules:* (1) the **browser smoke does not
  gate the aggregate** (`continue-on-error`), so a red smoke is a real regression that goes
  unnoticed (the far fields broke the map count and the race board for eight commits): read it on
  every run, and promote it to required once it has stayed green for a week (see the comment in
  `.github/workflows/ci.yml`); (2) rapid pushes cancel each other (`cancel-in-progress`), so confirm
  one full run on the head before calling anything done; (3) a CI-only failure is reproduced with a
  full local `test:cov` (cross-suite state), after checking for a stray jest process; the soak
  test prints the rejection reasons when it fails; (4) never edit `baselines.json` by hand
  (regenerate it with `tools/oracle/gen_fixtures.py`).

## P2 — Simulations

- [x] **Check the simulations: is the economy bot simulation feature complete? Run it and get
  insights.** (done; see the status section below) Specs: `docs/superpowers/specs/2026-10-11-economy-bot-simulation-design.md`, plan:
  `docs/superpowers/plans/2026-10-11-economy-bot-simulation-plan.md`, code in `apps/api/sim`. First
  verify it against the plan (what is built, what is missing), then run it and report what it says
  about progression through the bridge rarities and the economy. *Known drift to fix first:* the
  game now has one generic `scrap` material, and the sim still models per-part scrap
  (`scrap_<type>`); scavenging now picks cheap parts far more often, caps a run at two part finds
  and caps the price of a find by zone (`scavenging.max_part_finds`, `price_weight_power`,
  `find_price_cap`), so measure the value of an average run per zone against a mission's reward. Also measure
  the combat outcome mix with the new rules (`combat.stalemate_by_hull`, `escalation_*`,
  `loss_bridge_wear`): the dev logs had 78% draws before; check that wins, losses and the rate of
  destroyed ships (a lost fight now wears the bridge) are where we want them.

### P2 status — balance round (2026-10-15)

Done: the sim is trustworthy (builds `chem`, `chem-shield`, `ion-shield`, `hybrid`; foot scavenging;
partial repair; idle-part removal; fuel reserve; store schema v2). The economy math (repair grows with
ship value ×33 from tier 1 to 5, reward ×6) drove one config round, applied to the DB by migration
`20261015020000_balance_round_wear_repair_fuel` and to the factory defaults: `repair_factor` 0.62,
`maintenance_per_tier` 60, `fuel_price` 0.65, `wear.base_min/max` 1/1.7, `environment_damage_factor` 1,
`hull_to_condition` 0.3, `pirate_zone_strength` {0.35, 0.5, 0.65, 1.1}. Results (sim experiments
46→47): wear per mission 57–76 → 18–32, repair share of reward 53–69% → 23–44%, stalls 0–2 of 6,
ion L2 day ~17 and L3 day ~35. Rules learned: repair must not go below ~0.6 × part price (the
buy-used/repair/sell exploit floor), so wear is the lever, not a repair price curve.

- [x] Re-baseline on the new defaults: experiment 48 (16 cells, stored). Chem stalls 4-7 of 8 -> 1,
  wear per mission 57-76 -> 21-38, repair share 53-87% -> 34-50%.
- [x] Reward ladder, first step (migration `20261015030000_balance_round_reward_ladder`):
  `reward_danger_divisor` 8 -> 4, `loss_wear_scale` {0.1, 0.3, 0.4, 0.7}. Zone 3 net per mission went
  42 -> 823 credits (zone 2: 668 -> 1055).
- [x] Fast pace (owner: "keep the pace a lot faster"), migration `20261015040000_balance_round_fast_pace`:
  `reward_base` 300, `reward_danger_divisor` 3, `loss_wear_scale[3]` 0.5, zone 3 pirate strength 1.0.
  Zone 3 net is now 1.35x zone 2, chem fuel 30% -> 20% of reward. *Finding:* level days did not move
  (chem L2 ~day 11 / L3 ~21, ion L2 ~17 / L3 ~42) although wallets are full at L2 (6.8k chem, 21k ion):
  money is not the gate, the market's bridge-gated rarity shelves and the upgrade materials are.
- [x] Pace investigation (sim experiments 53-68): neither shelf rarity (`market_rarity_by_bridge` up) nor
  halved upgrade materials moved the level days, and the pilot is income-bound early. A real sim
  artifact was found and fixed: the bot did one fit/buy/upgrade per loop turn, a player does several
  per stop; chaining them (up to 8 per stop) took ion L2 17 -> 14 days and L3 42 -> 26. Today (balanced
  pilot, 2 h/day): chem L2 ~11 / L3 ~18, hybrid ~9 / ~19, ion ~14 / ~26. An early-income dial exists
  (`reward_base` 450 + `reward_per_tier` 90: L2 ~15% sooner, chem repair share +6 points) but is NOT
  applied. To halve L2 again the early net per mission has to double; that is a design call.
- [x] Bot: buys a mining rig when only `MINER` work is on the board.
- [x] Balance round 4 (migration `20261016000000_balance_round_epic_sink`, sim experiment `epic-v1`, 8 runs x
  300 missions per build, game-clock hours, median): Epic parts cost x2 and Legendary x3 (money is the
  path past Rare), rare/epic bridges see epic parts more often, `reward_base` 450 / `reward_per_tier` 90,
  `fuel_price` 0.45. Time to Epic (L4): chem never -> 56 h, hybrid 132 h (1 of 8) -> 56 h, ion 187 -> 91 h;
  Legendary (L5): chem never -> 107 h, ion 232 -> 191 h. End wallets 200-450k -> 35-85k. Cost: repair is
  49-62% of reward at the top (parts cost more); fuel is 12% of reward on chem.
- [x] Fuel share of reward on chem 29-37% -> 12%; the "prefer shorter routes" bot gap is no longer needed.
- [x] Sim robustness: a fill slot (second solar panel) buys the next tier up when the wanted tier is on no
  reachable shelf, instead of wandering (ion's early levels depended on shelf luck).
- [x] Map: a separate next step (owner): expand it for a complete v1, with zoom and panning, very short and
  long distances. The dev-only `ziggy` route was shortened 5000 -> 900 so it stops inflating zone 1.
- [ ] Late game (parked): fusion torch engine + fusion reactor family above nuclear (see GLOSSARY once
  written); needs the early and mid economy to hold first.

**Deferred on purpose (owner): the bigger bridge / starter shield test.** First the game, the sim and
the balance must all work; only then go back to a starter shield with a larger bridge budget.

## P3 — Missions

- [x] **Mission rewards follow the bridge rarity (the part-price ladder)** — first slice of P3, owner
  decision "rewards follow the part-price ladder". New rule `economy.reward_by_bridge`
  {COMMON 1, UNCOMMON 1, RARE 1.4, EPIC 2.2, LEGENDARY 3.2}, applied in `rewardBase` (board estimate,
  accept-time figure and the resolver's payout all see it; older rule sets have no table = x1).
  Before it, 80% of the missions flew at ship tier 5 (value >= 18000, reached at L3) so pay was flat
  from L3 to L5 while repair kept growing. Sim (8 runs x 300 missions): repair share of reward
  chem 37-44% -> 18-26%, ion 64% -> 40%; ion Legendary 164 -> 130 game hours; chem pace unchanged. The
  stronger table [1, 1.2, 1.8, 3, 5] over-pays (repair 11-22%).
- [x] P3 closed by the owner after the reward slice: requirements, fuel and repair scaling by bridge rarity
  were not needed (the sim shows repair at 18-40% of reward).

## P4

- [ ] **A wiki / game guide.** A place that explains the details of the game: what is the
  difference between defense, armor, shields, hull frames, engines (chemical and ion), batteries,
  reactors, weapons; how rarity, size and the bridge level work; how upgrading works (condition at
  100%, money, scrap / crystals / cores); how fuel, repair, scavenging, mining and missions work;
  what ports, connectors and incorrect ports mean; what each mission type needs. *Needs design:*
  in-game pages (a "Guide" route in the web app, bilingual en + pt-BR, no hard-coded strings) or
  markdown rendered in the app; keep it in sync with the Admin-tunable numbers by reading values
  from the API where it quotes them (for example the repair and upgrade rules), not hard-coding
  them. The part descriptions (`hangar.partClasses`, the part-class help texts) are a starting point.

- [ ] **A simple tutorial for newcomers.** Something short that shows, step by step: how to build a
  ship (place parts, connect them, fix red ports), how to refuel, repair, scavenge and mine, and
  how to get and accept tasks. *Needs design:* an in-game guided flow for a new pilot (a checklist
  that ticks as the pilot does each thing, or a few highlighted steps), shown after onboarding and
  skippable, bilingual (en + pt-BR). It pairs with the starter changes above (a full tank, a short
  first mission) so the first minutes work. It can link to the wiki for details.

- [x] **Mining animation.** (done: the ship stage shows a free dig; port art animated) The mining job and its screen need an animation (like the ship scene
  for scavenging / travel). *Where:* `apps/web/src/ui/ActionArt.tsx` (the port action art),
  the mining tab in `port.page.tsx`, and the ship stage in `apps/web/src/ui/ShipStage.tsx`.

- [x] **Admin parts browser.** Filters, search, sort and column choice live in the URL and survive a save
  (`EntityScreen.tsx`, round 6). Comparison (round 7): tick parts in the list (`?sel=`), a table of the
  numeric stats with the best value marked and hand-rolled SVG bars for the stats ticked
  (`PartCompare.tsx`, parts only).

## Parked / not yet scheduled (owner steers, 2026-10-16)

- [ ] Starter shield + battery in the free kit with a larger bridge budget (2x2 bridge limits): test it as
  its own A/B once the game, sim and balance all work.
- [ ] Map expansion for a complete v1: zoom and panning, very short and very long distances, new places.
- [ ] Late game: far *missions* (the three `deep_field` places have mining only), the fusion torch engine
  and the fusion reactor family, and a pre-warning before a bridge is destroyed.
- [ ] Seed sync of dev-only data: the `ziggy` location, route and `race_explorers_ziggy` template, hull
  edits, `sell_min_condition` 15 and the 1x1 bridge connector rules only exist in the dev DB.
- [ ] Tests: a no-bridge dispatch test; the soak test prints rejection output while it runs.
- [ ] Sim: chem and hybrid builds still stall now and then on an empty wallet; the ion build's repair
  share is 40-68% of reward at the top; `sim/` could model utility parts outside the ship level.

## P5 — Look and feel

- [ ] **Upgrade the CSS to https://github.com/nutlope/hallmark: investigate first, to choose which
  one will be used.** Today the styles are one hand-written sheet (`apps/web/src/styles/index.css`)
  and the design tokens live in it. The investigation compares what hallmark offers with what the
  game needs (the dark yard look, the rarity colours, the part cards, the popups and the Admin
  screens), what the migration would touch, and what it costs; it ends with a recommendation to
  pick the one to use. No code changes until that is decided.
