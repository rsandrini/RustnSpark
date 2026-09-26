# Rust and Spark v0.1 — Playtest round 2: findings and plan

> Source: the owner's second playtest session (2026-09-27), on `feat/playtest-feedback`. Status: **decisions answered (below); implementation in progress, workstream by workstream**. Every claim under "Findings" was checked against the code or the dev database; the plan is ordered so each workstream ships on its own.

## 1. Findings (what is actually going on)

**F1 — There is no combat because the encounter policy uses the wrong relation.** An encounter happens (chance = `danger / 20` per leg), but `decidePolicy` is fed the *employer faction's* relation to the player (`mission.faction.relations[playerFaction]`, `neutral` almost always) instead of the relation of the *ship met* (a generated pirate = hostile to everyone). With `relation = NEUTRAL` the tree returns `IGNORE`, and an `IGNORE` outcome emits **no event at all**. In the dev database: 12 resolved missions, 0 fights, 0 encounter lines; the only "encounter" events were 2 player-vs-player overlaps. So danger has no visible effect today. (`resolveEncounter` in `resolution/encounter/`, wiring in `leg.resolver.ts` and `resolution-input.ts`; unit tests pass because they hand-feed `HOSTILE`.) Also: the GDD says delivery/transport legs *flee*, but the seeded templates have an empty `encounterPolicy`, so `missionForcesFlee` is never true.

**F2 — The report shows "0 wear" while parts really wear down.** Parts in the dev database sit at 22–65 % after a dozen runs, so wear works, but the `mission_wear` event's `magnitude` is 0 (it is computed from part conditions that were already updated), so the report prints "0 of condition worn" and the debrief cannot show damage. Together with F1 this is why the report never explains the damage the Repair tab shows.

**F3 — Travel time is thrust and weight.** `MOB = Σthrust ÷ total mass × 1.6`, `time = round(distance ÷ MOB × duration_k) × time_scale` (`duration_k` 2.25). So yes: engines and mass decide it. Fuel does not add mass yet (`ship.fuel_mass_per_unit = 0`, although GDD §6.3 says a full tank weighs).

**F4 — The profile balance is stale because nothing refreshes it after a mission.** The wallet is re-read only after market/repair actions (`reloadProfile`); a mission that resolves on the server never triggers it.

**F5 — "Zero repair costs money" is float noise.** Condition is a float (79.6), the UI shows a rounded value and starts the slider at `ceil(condition)`, so a "no change" row can already be 0.4 points above the stored value and gets billed. The stored condition should be a whole number (or the whole pipeline must treat it as one).

**F6 — "Loading" in Repair is the quote spinner text.** It shows while the first quote loads and per row, and the totals only exist after the first slider move; the screen should show zeros until then.

**F7 — Refuel already supports a partial amount on the server** (`mode: 'partial'`, `amount`); only the screen lacks the control.

**F8 — The bridge repairs for free because its base price is 0** (only the workshop fee remains). It is a side effect of the "bridge is free" rule, not a decision; it needs one.

**F9 — Auto layout arranges every part the player owns**, including loose spares, because the screen sends all part ids.

**F10 — Rotate.** The button is enabled only when a block is selected and the rotation must fit; a 1×1 part rotates into an identical footprint (looks like nothing happened) and a rotation blocked by a neighbour fails silently. Needs a reproduction in the browser before fixing.

## 2. Decisions (answered by the owner, 2026-09-27)

1. **Combat.** Pirates are hostile to everyone. Deliveries and transports **flee if they can** (and fight only when the escape fails). Pirates are **weaker in safer zones** (strength scales with the zone) but they always fight: they want to win and take something. What they want is one of: the **cargo** of the mission, **parts kept in storage** (never installed ones), or to **defend territory** (they drive the ship off: the mission fails, nothing is stolen). Every encounter appears in the report.
2. **Bridge repair.** A small price, not free (`economy.repair_min_base_price`, default 50, applies to any part whose base price is lower).
3. **Auto layout.** Arranges the parts already in the ship; only an empty ship (new pilot, rescue) uses the loose kit.
4. **Scavenging.** A mission-like job of about **5 minutes** that starts and ends at the same place (ship locked, then a report). **Risk comes from the place: more risk, better prize; a safe place gives less valuable finds.** The finds are always **used parts** (a condition roll); some places also give **scrap**, which sells at a **fixed price per part** (the part's catalog scrap value).
5. **Selling.** Parts under 15 % cannot be sold: a port never "takes" them for 0. A **Discard** action destroys every such part that is not installed, behind a confirmation popup.
6. **Art.** The first set is generated SVG (icon + square + wide per place; first-letter tiles for parts); the owner will replace it later.

## 3. Workstreams

### W1 — Combat and danger that you can see  *(F1, F2)*
- Wire the encounter policy to the *met ship's* relation (pirates hostile to everyone; other players via their faction), keep the employer relation for reputation only.
- **Pirate strength by zone:** the generated pirate's strength option is drawn from a zone-dependent range (zone 0–1 weak, zone 3 full strength), configurable (`encounter.pirate_zone_strength`).
- **What pirates want (a `motive` rolled per encounter, weighted by zone):** `cargo` (a lost fight forfeits the mission cargo and payout), `parts` (they take 1–2 parts from **storage**, never installed ones), `territory` (the ship is driven off: mission failed, nothing stolen). Stolen parts are removed by the resolve service in the same transaction and written to the log as a `pirate_theft` event, so the report and the admin replay show it. If the escape works, or the fight is won, nothing is taken.
- Emit an event for every encounter, including ignored and escaped ones ("a raider shadowed you and lost you"), so danger always shows in the report.
- Seed `missionForcesFlee` for delivery/transport templates (GDD §8), and check each mission type against the policy tree.
- Fix `mission_wear` magnitude; add wear and per-fight damage to the debrief and story.
- **Balance safety net:** a simulation test that runs N missions per zone with the starter ship and reports fight rate, win rate, damage per run and net credits per run; the numbers go into the plan before shipping, and `danger`, `chance_divisor` and pirate strength stay Admin-tunable.
- Acceptance: a zone-3 route produces combat in a large sample; a zone-0 route rarely does; every encounter appears in the report; the unit oracle and the replay tests still pass.

### W2 — Images for places and parts
- A `place art` set: for each of the 12 places an **icon**, a **square image** and a **wide background** (SVG files under `apps/web/public/places/<id>.{icon,square,wide}.svg`, generated from place type and faction so new places get art automatically; a fallback for unknown ids).
- One `PlaceArt` component (sizes: icon / square / wide) used by: the report debrief (wide banner of the destination), the map popup (square), the Port header and Board header (wide), the Transit screen (destination), place lists.
- Parts and items: a `PartThumb` that shows the **first letter** of the name on a rarity-coloured tile until real art exists; used on market cards, the Hangar list, goods and the part detail popup.
- Acceptance: every screen that names a place or part shows art or the placeholder; no layout shift; works in both locales; art is decorative (`aria-hidden`), names stay text.

### W3 — Navigation and flow
- **Transit menu** enabled only while there is something to see there: an accepted, held, flying or resolving mission (otherwise disabled with a hint). From the map popup / board the pilot is sent to Transit as needed.
- **Auto-redirect to the report** when the mission being watched finishes: the Transit screen remembers the mission id and, when the active list turns empty and the newest report is that mission, navigates to `/report/:id`. Works for missions, trips and (W8) scavenging.
- **Profile money** refreshes when a mission resolves, when the report opens, and on window focus (`reloadProfile`), so no F5 is needed (F4).

### W4 — Repair, refuel, and the bridge  *(F5, F6, F7, F8)*
- Store condition as a whole number (round at the moment wear/repair is applied, one place, with a migration that rounds existing rows) and treat "no change" strictly; add a test that no zero-point repair ever costs anything (F5).
- Repair screen: zeros on entry (rows `0 ¢ · 0 s`, total `0 ¢ · 0 s`, "No changes" line), no "Loading" text (keep the previous numbers while a new quote loads); a row or total price turns **red** when it exceeds the balance, and Start is disabled with the reason.
- Refuel: a slider (0 to the free space in the tank) with a live price and the existing "Fill tank" shortcut, using the `partial` mode that already exists.
- Bridge repair: `economy.repair_min_base_price` (default 50) raises the repair base of cheap parts, so the bridge is never free.
- **Broken items:** a part at 0 shows a **BROKEN** badge and a highlighted (red, pulsing) border in the Hangar, the repair list and the sheet; broken parts count as zero for the ship's stats. *(V2, recorded not built: a broken part can be removed and disconnects the pieces attached to it — a ship-building mechanic.)*

### W5 — Selling, discarding and the repair/sell economy
- Parts under 15 % condition cannot be sold (no offer, message "too damaged: repair it first"); threshold in config (`economy.sell_min_condition`, default 15), Admin-tunable.
- **Discard:** `POST /v1/inventory/discard` destroys every uninstalled part under the threshold; the Goods tab shows how many and asks for confirmation first; recorded as a player event. Installed parts are never touched.
- **Exploit audit** as a test: for every catalog part, every condition, every pair of places (isolation × faction × mood) check `sell(after repair) − buy − repair ≤ 0`, plus buy-used → repair → sell loops, plus the restart-kit invariant (D41) with the new cutoff. Expected (repair 1.2 × base per full condition vs sell 0.6 × base) but cross-place multipliers can break it, so it is asserted, not assumed. Findings are fixed or documented before merge.

### W6 — Hangar fixes  *(F9, F10)*
- Auto layout uses the parts in the ship (or the kit when the ship is empty) — API call carries the right ids.
- Rotate: reproduce in the browser, then fix (visible rotation for 1×1 is impossible by definition, so the button explains "1×1 parts look the same rotated"; blocked rotations say why and offer to nudge neighbours).
- Broken-part visuals from W4.

### W7 — Timings, fuel weight and the numbers you asked about
- Show in the Board/Map popup the formula inputs ("thrust 25 · mass 25 → mobility 2 → 18 min") so the player sees *why* a trip takes that long (F3).
- Decide with data whether a full tank should weigh (`ship.fuel_mass_per_unit`): a small simulation of trip time for the starter ship at 0, 0.01 and 0.02.

### W8 — Scavenging as a timed job with a report
- A `SCAVENGE` mission type (like `TRAVEL`: no cargo, no reward, no leg to another place) created at the current place: **5 minutes**, ship locked (`ON_MISSION`) meanwhile, resolved by the worker into a **report**.
- **Risk by place:** the place's zone/danger sets the encounter chance (pirates as in W1), and the quality of the prize: higher risk → rarer parts and better condition; a safe place → common parts in poor condition. Finds are always **used parts** (condition roll).
- **Scrap:** some places (scrap fields, dead zones, relays) can instead yield scrap, one **scrap material per part type** whose price is fixed (the part's catalog scrap value, no location or condition modifier), sold with the existing materials sale.
- Replaces the instant button; the Port tab explains odds and the 5 minutes, and shows the running job; the Transit screen and the ship stage (W9) show the scavenging scene; auto-redirect to the report when it ends (W3).
- Reuses the drop tables, quality range and cooldown logic; the loot lands in the inventory when the job resolves.

### W9 — The ship stage: the main screen always alive
- A `ShipStage` component (the scene from the Transit screen, generalised) on the home/main screen and at the top of Hangar, Port and Board, driven by what the server says the ship is doing:
  - **Flying:** as today (scrolling stars, ship hovering).
  - **Parked** (Hangar/Port/Board/Home): the ship at rest against the **wide background of the place** (W2).
  - **Repairing:** small drones flying around the hull with sparks and welding glints until the repair job completes.
  - **Scavenging:** the ship travelling with wreckage and pieces drifting past.
  - **Refuelling:** a hose/pulse animation while filling (short).
- Data: `GET /v1/ships` gains `activity` (`idle | repairing | scavenging | flying`, `until`, `missionId`) derived from the active mission and pending repair job; the stage reads it and re-renders on the poll already in use.
- Every animation respects `prefers-reduced-motion` and is decorative (`aria-hidden`); a text line beside the scene says what is going on ("Repairing 3 parts · 2m 10s left").

## 4. Order of work

1. **W3** (redirect, Transit menu, live profile) — small, high daily value.
2. **W4** and **W5** (repair/refuel/sell correctness, exploit audit) — fixes what is wrong or confusing today.
3. **W6** (Hangar fixes).
4. **W1** (combat), after decision 1 — the biggest change to game feel; ships with its balance simulation.
5. **W2** (art), then **W9** (ship stage) which consumes it.
6. **W8** (scavenging job), **W7** (timing explanations).

## 5. Status
_(updated as each workstream lands)_

## 6. Risks
- W1 changes difficulty everywhere: gated by the simulation and by Admin-tunable values; roll out with the numbers in the plan.
- W4's condition rounding touches stored data: a reversible migration and a rounding test.
- W5's exploit audit may find real arbitrage; then price multipliers change, which is an owner decision.
- W9 needs an `activity` field in the ships contract: the contract tests and the browser specs must be updated with it.

## 7. Done means
Each workstream ships with tests (unit + integration + web + the browser specs on the real stack), lint/types clean, the plan status updated, and the browser specs restoring any config they touch.
