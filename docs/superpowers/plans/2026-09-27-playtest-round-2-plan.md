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

- **W3 done:** Transit menu disabled when idle; auto-redirect to the report; wallet refreshes when a mission ends, on report open and on window focus.
- **W4 done:** whole-number condition (migration 0027 + rounding when wear is stored); repair screen starts at zeros, no "Loading", red over budget; refuel slider with a server quote (`POST ships/:id/refuel/quote`); `economy.repair_min_base_price` (50) so the bridge is not free; BROKEN badge + pulsing red outline in the Hangar, cards and repair list (`broken` flag from the server).
- **W5 done:** `economy.sell_min_condition` (15): no quote and a 409 `TOO_DAMAGED_TO_SELL` below it; `POST /v1/inventory/discard` with a confirmation popup. **Exploit audit** (unit test): loops at ONE place never pay (buy → repair → sell, repair → sell), for every part, condition, isolation, faction and mood. **Owner note:** the cross-place gap is large: buying a part at the cheapest place (isolation 0.9, ally, mood 0.85) and selling it at the dearest (isolation 2, hostile, mood 1.15) returns about **5.6×** the price (`0.6×5.75 ÷ 0.61`). The design notes call this the future trading profession; it is now measured and recorded, not changed.
- **W1 done:** the policy uses the met ship's relation (pirates hostile to everyone); an attacking pirate can no longer be "ignored"; delivery and transport templates flee (migration 0028); pirate strength scales with the zone (`encounter.pirate_zone_strength`); a winning pirate demands `cargo` (mission over), `parts` (1–2 from **storage** only, removed in the resolve transaction and named in the report) or `territory` (driven off, mission failed), weights in `encounter.pirate_motive_weights`; every contact leaves a trace (escapes and draws get events: new `pirate_demand` and `combat_draw`); the wear event now reports the condition really lost. Old stored logs will not replay byte-identically (the wear magnitude changed); new logs do.
  **Balance table** (unit simulation, 1500 runs per cell, two legs of 500, danger 2/5/8/8 for zones 0–3; `test/unit/resolution/danger-balance.spec.ts` prints it):

  | ship / zone | flee | fights won+lost | lost | escaped | mission failed | hull lost / run | credits / run |
  |---|---|---|---|---|---|---|---|
  | armed / 0 | no | 19 % | 0 % | – | 0 % | 2 | 410 |
  | armed / 1 | no | 44 % | 0.1 % | – | 0.1 % | 10 | 507 |
  | armed / 2 | no | 65 % | 1.3 % | – | 1.3 % | 24 | 574 |
  | armed / 3 | no | 63 % | 5.9 % | – | 5.9 % | 31 | 529 |
  | armed / 3 | yes | 47 % | 3.5 % | 22 % | 3.5 % | 21 | 530 |
  | starter (no weapon) / 0 | no | 4 % | 1.1 % | – | 1.1 % | 3 | 379 |
  | starter / 1 | no | 9 % | 4.6 % | – | 4.6 % | 6 | 426 |
  | starter / 2 | no | 21 % | 13.6 % | – | 13.6 % | 13 | 432 |
  | starter / 3 | no | 20 % | 14.8 % | – | 14.8 % | 13 | 424 |
  | starter / 3 | yes | 6 % | 3.9 % | 38 % | 3.9 % | 4 | 494 |

  Reading: a well-armed ship now meets pirates in 20–65 % of missions and wins most of them (combat pays, so danger is a real prize); the weaponless starter ship loses 14–15 % of its zone 2–3 runs unless it flees, and fleeing deliveries cut that to about 4 %. These are the numbers to tune from (danger, `chance_divisor`, zone strength, motive weights are all Admin values).
- **W6 done:** auto layout arranges only the parts in the ship (the kit only when it is empty); rotate explains 1×1, nudges a blocked rotation, and says when nothing fits.
- **W2 done:** 39 generated place SVGs (`apps/web/public/places`, script `apps/web/scripts/generate-place-art.mjs`), replaceable by file name; first-letter part thumbnails; banners and the report backdrop use them.
- **W8 done:** scavenging is a 5-minute `SCAVENGE` job from the Port (migration 0029, `Material.fixedPrice` scrap), risk and finds by zone, always used parts, finds and scrap shown in the debrief; the Transit screen auto-redirects to the report (it now keeps asking until the report exists, fixing a race found by the browser smoke).
- **W9 done:** `ShipResponse.activity` and the `ShipStage` scenes (parked backdrop, repairing drones/sparks, scavenging debris, flying) on Home, Hangar, Port and Transit. Browser specs updated for the redirect and the refuel slider.
- **Round 2b (owner, 2026-09-27) done:** fuel and repair base prices halved (`economy.fuel_price` 3 → 1.5, now a decimal; `economy.repair_price` 6 → 3; migration 0030 moves only values still at the old defaults); repairs restore condition gradually while the job runs (every read of a part, the inventory and the ship sheet shows the share done; stored value written at completion; the Port polls every 4 s meanwhile); a destroyed part (condition 0) is refused with `PART_DESTROYED`, has a disabled slider and is skipped by "set all to 100%". **Balancing notes for the coming round:** (1) a full 1000-unit tank still costs ~1.35–1.5 k ¢ against a 200 ¢ start, so tank size or price per unit is the next lever; (2) with the halved repair price, buy-used → repair → sell at a port with the top mood (1.15) now nets a few credits (up to ~75 ¢ on the priciest part); the audit test asserts the loop closed only for mood ≤ 1.
- **Round 2c (owner, 2026-09-27) done:** fixed the map popup's reward blinking in the wrong spot — the repair-scene's spark animation class (`.spark`) collided with the reward text's class of the same name; renamed the animation's class to `.stage-spark`. Reworked refuel: it now opens on what the wallet can afford (a new "Max I can afford" button next to "Fill tank"), not on the full tank's price; the quote returns a per-unit price and the slider computes its own total from it (the server's exact rounding), so dragging is instant and never shows a stale figure.
- **Round 2d (owner, 2026-09-27) done — admin debug mode.** `admin.debug_fast_ops` (off by default) + `admin.debug_fast_ops_seconds` (5): while on, every timed job — missions, travel, scavenging (all three go through `DispatchService`) and repair — still computes, stores and displays its real duration (`durationSeconds`, `arrivalAt`/`completesAt`, the countdown, the report), but the *actual* queue delay before the job fires is capped at the configured seconds (`src/config/debug-timing.ts`, `jobDelayMs`). Edit it live with `PATCH /v1/admin/tuning/config/admin.debug_fast_ops` (`{"value": true}`, then `false` to turn it off) — no restart needed. Refuel has no job (it is already instant) so nothing to change there. Owner-only; never enable for players.
- **Round 2e (owner, 2026-09-27) done:** a wide background per faction on the onboarding picker (generated SVG placeholders, `apps/web/public/factions/`, script `apps/web/scripts/generate-faction-art.mjs` — same sky/star treatment as the place art, one sigil per faction: Luna a station ring, Sun a market flare, Explorers a compass, plus `_default` for a faction an admin adds later without its own art). Owner will replace the files later, same as the place art.
- **Round 2f (owner, 2026-09-27) done — debug mode corrected to per-account.** The owner rejected the round-2d global switch outright ("enable that and everyone can do it is bullshit... PER ACCOUNT"): `admin.debug_fast_ops` (GameConfig, global) is removed; a new `Player.debugFastOps` column (migration 0031) gates `jobDelayMs` per player instead — `admin.debug_fast_ops_seconds` stays the one shared tunable ("how fast is fast"). New `SupportService.setDebugFastOps` + `POST /v1/admin/players/:playerId/debug-fast-ops` (audited, same pattern as ban/reset), plus `--set-debug-fast-ops on|off` on the `reset-player` CLI. Set on for the owner's own account.
- **Round 2g (owner, 2026-09-27) done — wear rebalance.** The owner's complaint: a "simple and direct" mission dropped every part 80%→71% — the game applied the same random `missionWear` roll (base 3–5 + env level×1.2) to EVERY installed part, EVERY leg, regardless of what happened on it, so a bridge or a cargo hold wore out from merely existing exactly as fast as an engine or the hull. Fix (`resolution/wear/wear.calculator.ts`, `partAmbientWear`/`partDefeatWear`/`dangerFactor`/`isPassiveWearClass`, wired into `leg.resolver.ts`'s per-part wear and combat-defeat paths; `missionWear` itself is untouched — it stays byte-identical for the oracle/D19 replay tests):
  - **Passive classes** (bridge, cargo, reactor, utility — already the classes `failureCategory` never treats as choke-critical) now take a tiny flat "usage" wear per leg (`wear.system_base_min/max`, 0.05–0.15), not scaled by environment or danger at all — degrading only from being used, "much much slower," per the owner's words.
  - **Exposed classes** (engine, tank, battery, weapon, defense — hull/armor/shield —, sensor) keep the existing base+environment roll, now scaled by the leg's own danger: `dangerFactor(danger) = clamp(danger / wear.danger_ref, wear.danger_floor, wear.danger_cap)` (defaults 6 / 0.1 / 2.5). A simple, safe leg (danger ≈0–2) now costs a small fraction of the old roll; a genuinely dangerous one (zone 2–3, danger 8) costs multiples of it — wear now tracks the difficulty of the path, exactly as asked.
  - Combat defeat still hits every part, but a passive-class part only takes `wear.system_defeat_share` (0.25) of the rolled loss.
  - 6 new Admin-tunable keys (`wear.danger_ref/floor/cap`, `wear.system_base_min/max`, `wear.system_defeat_share`); another balancing round can retune all six later.

## 5b. TODO — next after the current workstreams (owner request, 2026-09-27)

1. **Menus follow the ship's status (W3b).** While the ship is on a mission (or otherwise not docked) the screens that need a port are blocked with the reason: Port tabs (shop, goods, repair, refuel, scavenging) and the Hangar's Store. The Hangar stays readable but not editable (it already refuses edits in flight). Same rule as the Transit menu: disabled entry with a hint, and a friendly "the ship is flying, back in 12:30" on a direct visit, driven by the ship `activity` field planned for W9.
2. **Ship status on the home screen (W9b).** A ship card on Home (and in the stage header): status (docked / flying / repairing / scavenging), fuel bar, condition of the hull, location; click it to open the full ship status: sheet (mobility, cargo, firepower, energy, structure), fuel and range in trips, every part with its condition, and what is broken.
3. **Requirements with numbers (H2).** On mission cards and in the map popup, every blocker shows what is needed against what the ship has ("Mobility 1.4 of 2 required", "Cargo 5 of 10", "Passenger Cabin: none", "Mining rig: none"), so the pilot sees exactly what to change. Server: the eligibility reasons carry `have` and `need` values (the requirement checker already has both); the client formats them and links to the Hangar/Store part class that fixes it.
4. **Compare a market part with the one in the ship (B2).** A "Compare" option on market cards and in the part popup: pick the installed part of the same class (or the closest by class and size) and show the difference stat by stat with the sign and colour (thrust +12, mass −2, structure +3, price, condition), plus the effect on the ship sheet if swapped (mobility, cargo, energy, structure budget) using the existing server preview. Client: a `PartCompare` component shared by the Port market and the Hangar Store; server: reuse `POST ships/:id/preview` with the swapped layout (no new rules on the client).

## 6. Risks
- W1 changes difficulty everywhere: gated by the simulation and by Admin-tunable values; roll out with the numbers in the plan.
- W4's condition rounding touches stored data: a reversible migration and a rounding test.
- W5's exploit audit may find real arbitrage; then price multipliers change, which is an owner decision.
- W9 needs an `activity` field in the ships contract: the contract tests and the browser specs must be updated with it.

## 7. Done means
Each workstream ships with tests (unit + integration + web + the browser specs on the real stack), lint/types clean, the plan status updated, and the browser specs restoring any config they touch.

## 8. Round 3 — navigation consolidation & detail views (owner, 2026-09-28)

Two feedback messages, combined here. **Status (2026-09-28): R3-1, R3-4, R3-5 done. R3-2 and R3-3 — the actual tab-count reduction (Board/Port folded into My Ship with ship-status gating, Transit removed) — are the remaining, largest piece; deliberately not rushed at the tail of an already large session (4 stateful pages, ~2000 lines, to merge safely). Next up.** (owner asked to plan first — "so we can plan" — before implementing). Supersedes §5b items 1–3 (menus-follow-status, ship-status card, requirements-with-numbers), which fold into R3-2/R3-4/R3-5 below rather than shipping separately.

### 8.1 Findings
Today: a thin Home screen for onboarded players; `GameNav` always shows Hangar / Map / Board / Transit / Port / Profile (Transit greyed out when idle); Port is its own page with its own tabs (market/goods/repair/refuel/scavenging); the Hangar has its own tabs (Parts/Store); part details open in a side panel; the market/store list and the ship yard share the screen with no independent scroll; the map's mission popup shows eligibility (`board.eligible`/`board.blocked`) but not *why* (Board's own mission card already renders `offer.eligibility.reasons` — the map popup just never reuses it); the Report page has a narrated "story" tab but nothing that lists every resolved event in full.

Owner's ask, verbatim themes: too many tabs; Home is weak — make Hangar the landing page; Admin + Logout belong in a top-right menu; while docked, all port operations should live inside the same Hangar screen (remove a whole top menu level); a real ship-stats view is missing (part HP/detail today = a side panel; wants click → popup instead); the parts list needs its own scroll so the ship stays in view; mission popups on the map need the same requirement detail the Board already has, on hover; repair race (fixed, Round 2 §"never lets Start repair open on a stale quote"); a full/detailed battle log (today's report is too short to follow).

### 8.2 Decisions (proposed defaults — flag if any should change before I start)
1. **Home removed.** `/` redirects an onboarded player straight to `/hangar`; a player with no faction still lands on `/onboarding` (unchanged). `HomePage`/`pages/home.page.tsx` retired.
2. **Hangar is the landing page**, labelled **"My Ship"** in the nav/UI copy (route stays `/hangar` — no link rot, no test-path churn for the sake of a URL).
3. **Top-right account menu**: Profile, **Admin** (only when `user.role === 'ADMIN'` — first time the client branches on role for a nav item), **Logout**. Replaces the Profile nav-bar link.
4. **`GameNav` trimmed to My Ship + Map.** Board becomes a tab *inside* My Ship, enabled only while the ship is `IN_PORT` (disabled elsewhere with a reason, same pattern as today's Transit-disabled entry) — this is where §5b item 1 (menus follow ship status) actually lands.
5. **Port's tabs (market/goods/repair/refuel/scavenging) move inside My Ship**, alongside Parts/Store/Board, all gated the same way (enabled only in port). The standalone `/port` route is dropped (or kept as a redirect to `/hangar?tab=...` for any stray bookmark/link — cheap to keep, no reason not to).
6. **`/transit` removed.** Its content (ship-stage animation, leg-by-leg breakdown, Release/Cancel) becomes a section of My Ship that appears whenever the ship isn't idle — "the resume of the travel on main page," per the owner. Dispatch still happens from the Board tab right after accepting a mission (unchanged trigger, new destination).
7. **Part details: side panel → click-to-open popup.** Same content (name, description, stats, condition), styled as a modal/card over the yard instead of pushing the layout sideways. Hover/tooltip preview is explicitly deferred (owner asked for click).
8. **Store/market list gets its own scroll region** (`overflow-y: auto`, fixed height tied to the viewport) so the ship yard stays visible while scrolling parts — a layout change, no new data.
9. **Map mission hover popup** reuses the Board's own eligibility renderer (`offer.eligibility.reasons`) — same data already on the wire, just not shown on the map today. On desktop this is a hover card; touch devices get it on tap (no true "hover"), matching how the existing map popup already opens on click/tap.
10. **Detailed battle/event log**: a new expandable section (or a distinct "Full log" sub-tab) on the Report page that lists every stored `MissionEvent` in order — not just the narrated highlights — leg by leg, round by round where combat happened. Server already stores everything needed (`MissionLog.legs`/events, already fetched for the story tab); this is a client rendering job, reusing the existing report-template event data rather than adding new fields.

### 8.3 Workstreams (proposed order — each independently shippable/testable)
- **R3-1**: Home removal + redirect; My Ship label; top-right Profile/Admin/Logout menu.
- **R3-2**: Ship-status gating (`IN_PORT` vs not) on Board and the Port tabs, all folded into My Ship; drop/redirect `/port`.
- **R3-3**: Drop `/transit`; travel/mission summary + leg detail becomes a My Ship section; dispatch flow re-pointed.
- **R3-4**: Part detail → click popup (retires the side panel); Store/market internal scroll.
- **R3-5**: Map mission hover popup with eligibility reasons (reuses Board's renderer).
- **R3-6**: Detailed/full event log on the Report page.

### 8.4 Risks
- This is the biggest surface-area change of the playtest so far: 3 routes disappear (`/`, `/transit`, and `/port` folds in), `GameNav` shrinks from 6 links to 2, and one page (My Ship) absorbs three others' worth of tabs. Expect rework across `app/router.tsx`, `GameNav`, `hangar.page.tsx`, `port.page.tsx`, `transit.page.tsx`, `home.page.tsx` (deleted), the browser smoke (`e2e/smoke.spec.ts`, `e2e/economy.spec.ts` — both navigate through `/port` and `/transit` today) and several unit specs.
- Doing it in the R3-1→R3-6 order keeps each step small enough to test and roll out on its own, rather than one giant change.

### 8.5 Round-3 follow-up (owner, 2026-09-28) — R3-4 correction + a display bug

1. **R3-4 was too eager.** Clicking a part (tray row or placed block) now opens the full popup; the owner wants that ONLY from the (i) button. Clicking/hovering a part **in the ship yard** should instead show a small stats-only card (no description text) on hover, not the full popup.
2. **Mobility display bug.** A ship with mobility shown as "1" still gets a viability message saying mobility is below the 1 required — almost certainly the client rounds a sub-1 raw value UP to "1" for display while the real (lower) unrounded value fails the check, so the number on screen and the number the check used disagree. Needs the raw vs. displayed value traced and fixed at whichever end is wrong (display should show the true value, not mask a real shortfall — or the display rounding itself is inconsistent with what the check reads).
