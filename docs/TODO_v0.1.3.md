# To do - v0.1.3

Owner's list for v0.1.3, in the order given (2026-11-08). The general backlog stays in `docs/TODO.md`.
Delete an item when it ships (the commit has the history).

## 1. [mobile] The ship sheet shows the structure in the summarized version

- [x] Built, waiting for the owner's test. On phones (<= 700px) the whole summary row was hidden, structure included, and the yard
  does not show it. Now only the Structure tile stays (`mobile.css`, `.sheet-headline-structure`). Not checked on a real phone.

## 2. Mining ignores the selected time (always 5 minutes)

- [x] Built, waiting for the owner's test. Cause: the dig stopped when the hold was full, and the dispatch trimmed the job to the
  ticks that ran (hold 16 + mining 2 filled on tick 1, so a 20 min pick started as 5 min). Now an independent job runs the whole time
  and unloads into the goods after each tick: the hold caps each tick's load, not the job (`leg.resolver.ts`). Contracted/board
  mining keeps the old cap. The picker shows "Load per 5 min" and "Most ore". The int-test (`mining-job.int-spec.ts`) was edited
  but not run yet (needs the int stack).

## 3. Map places show information when clicked

- [x] Built, waiting for the owner's test. The place card on the map now lists the services open there and what can be mined, with
  the odds of each ore: `GET /locations/:id/mine/info` returns `ores` (`chancePerMin`, `pickShare`) and `attemptsPerTick`; the web
  scales the chance by the ship's mining capacity (`PlaceFacts` in `map.page.tsx`). Scavenging is not listed on the card.

## 4. 100% ion ships do not show the fuel bar (mission cards and the map)

- [x] Built, waiting for the owner's test. The mission cards and rows already hid the fuel for a pure-ion ship (`burnsFuel`); the map's
  trip quote still showed it, now hidden too (`TravelSection`). If a card still shows fuel for an ion ship, send a screenshot: it
  may be a screen that does not pass `fuelUse`.

## 5. Balance: ion-only is too easy (prod run)

- [ ] ION has no fuel cost, so no distance limit. A prod run (ion only, about 1M credits in 5 days, nearly a Rare ship) was too easy.
  Extract the numbers from the prod DB (read only), compare with the sim (`apps/api/sim`, add an ion-only bot), then tune.
  Do this step last.
  Prod extract analysed (2026-11-09): see `docs/BALANCE_prod_2026-11-09.md` (income concentrated in 7 long zone-3 trips; exposure
  is per leg, not per distance; dodge makes pirates miss 88%; pirates scale off the player's own sheet).

## 6. A long mission (8 legs) finished much faster than the card said (prod, 2026-11-08)

- [ ] Prod check (read only, rescue `ddee3302`): all 8 legs resolved, the payout was right, the legs ran back to back, resolved at the
  stored `arrivalAt` (19m22s for distance 4126, 0.28 s per unit = mobility ~8 with `duration_k` 2.25). So the resolver did NOT stop
  early. The owner says the card showed about 1h30m. Nothing stores the quote shown, so the mismatch is not proven. Suspects: the
  board estimate (`missions.service.ts` `offerInfo`, mobility from `tuned.sheet` of `viewer.installed`) vs the dispatch
  (`dispatch.service.ts`, `flightShip(installedConnected)` + engine levels). Both use `missionDuration`. Reproduce with an int-test
  (an ion ship with a high mobility: card estimate vs `durationSeconds` of the dispatch) and, if it holds, store the estimate with the
  accepted mission so a report can compare. Also look at what the transit screen shows (the open "transit screen disagrees" item).
- [x] Built (owner asked to log it, for anti-cheat and logic checks): every dispatch writes a `mission.dispatch` PlayerEvent with the
  card's quote (`quotedSeconds`, `quotedMobility`: all installed parts, engines at their levels) next to the real plan
  (`plannedSeconds`, `plannedMobility`, `durationK`, `timeScale`, `driftPct`, engine levels, penalties, fuel needed/aboard, reward,
  `arrivalAt`). A drift above 5% also logs a warning. After a few missions in prod, query `payload->>'driftPct'` to see if the card
  and the flight ever disagree. Still open: a flight int-test for a fast ion ship, and the transit screen.
- Related finding for item 5: seconds per unit of distance went 1.13 (starter) -> 0.28 (current ship), and pay per real hour went
  from 13-43k to 200-400k. See the balance notes in item 5.

## 7. Upgrade tab and Refuel (owner, 2026-11-08)

- [x] Built, waiting for the owner's test (`port.page.tsx`, `upgrade-needs.ts`, i18n `port.upgrade*`):
  - the upgradable parts are sorted from the lowest rarity to the highest inside each group (ready / credits / materials);
  - the needs read "what it asks first, what you have after": `Core Fragment: 5 (you have 21)`; the credits line shows only the
    price (card and confirm popup); the missing amount still shows;
  - "How upgrading works" is folded behind its title (a `<details>`);
  - the Refuel tab is not offered to a ship whose engines burn no fuel (`fuelUse` 0); a link to it opens another tab.
- [x] Built, waiting for the owner's test: the buy confirmation popup in the Market shows the part's footprint and its connectors big
  (`ConnectorGrid size="large"`, 160px) with its size in cells ("Size: 2×2 cells"); the shop cards keep the small drawing.

## 8. Mining rework: mix by rarity, ore space x2, one-trip cap, specialist contracts (owner, 2026-11-09)

- [x] Built (2026-11-09), waiting for the owner's test. Plan: `docs/superpowers/plans/2026-11-09-mining-rework.md`. The numbers were checked in `apps/api/sim/mining_calibration.py` first. Agreed rules:
  - Mining value = amount per 5 minutes: `mining x tool condition x place richness x K` (K about 8.3 keeps today's income). Luck stays:
    the amount rolls around that expectation. The map card shows only the ores minable there (done), no odds, no text.
  - Each unit found rolls its ore by a weight by rarity (about 60 / 30 / 10 common / uncommon / rare). The per-try rarity penalty goes
    (rarity lives in the weights). A drill's rarity shifts the weights towards the rare ores (tunable bias, medium: rare drill 48/36/16,
    legendary 40/40/20), so a bigger drill still helps once the hold caps the amount.
  - Ore space = 2 x the ship's cargo, for the whole job (one trip), whatever the time (5 or 20 min). Over the limit: the cheapest ore
    (rarity, then price) is dropped, the best kept. Example: found 20 common + 5 uncommon + 1 rare, limit 20 -> keep 1 rare, 5 uncommon,
    14 common; drop 6 common. The picker says it before the job ("Ore space: N, the cheapest is dropped first", and "fills in about N
    min"); the job card shows how full it is; the report lists found / kept / dropped per ore.
  - Board mining contracts ("bring N of ore X", X minable at that place): the mission time is the time the ship's own drill needs to
    reach N with about 90% chance, with a cap; over the cap the card says the drill is too weak (blocked); N above the ore space says
    "needs more cargo". The mission ends early once N is reached. The contracted ore is delivered (it does NOT stay with the pilot);
    other ores found, and any surplus, stay. Pay: the full contract for 100% delivered, partial in proportion for less, nothing for
    zero. (Today a contract is all or nothing and asks 1-3 units.)
  - Sim estimate (minutes for 90% chance, cap 60, medium bias): 10 uncommon takes a small common rig 50 min in debris and over 60 in
    open space; a heavy rare rig 10 min in debris; 5 rare is over 60 for a small common rig and 25 min for a small rare one.
  - Calibration (`apps/api/sim/mining_calibration.py`, run 2026-11-09). Chosen starting values: `yield_k` 8.33 (market value per find
    about the same as today: 500 vs 227 x 20 / ... income neutral within 8%), `mix_weights` 60/30/10, `tier_bias` common 0 / uncommon 0.15
    / rare 0.3 / epic 0.45 / legendary 0.6 (weight x (1 + bias x rank), rank 0/1/2: a rare drill 52/34/14, a legendary one 46/37/17),
    `space_factor` 2, `contract_max_ticks` 12 (60 min), `contract_confidence` 0.9, `contract_rarity_weights` 60/30/10,
    `contract_quantity` common 10-24, uncommon 6-14, rare 3-7, `contract_unit_pay` 400 / 1200 / 4000 (2x market: the delivered ore does
    not stay). Findings: a small common drill needs about 40 min for 17 common and cannot do 5 rare (71% in the cap, debris); a heavy
    rare one does the same rare contract in 15 min. In open space a small common drill has under 10% on any contract (the card shows
    the odds). With the one-trip cap a long job adds nothing once the space is full (heavy rare, cargo 16: 5 min 162k/h, 20 min 111k/h
    at base price), but free digging with heavy drills pays 160-270k/h at base price, the same range as the zone-3 trips that were too
    easy: part of item 5 (K and the ore prices are the levers), not changed here.
  - Built as: `resolution/mining/mining-yield.ts` (rules), the dig in `leg.resolver.ts`, payout in `mission.resolver.ts`, dispatch + info in
    `dispatch.service.ts` / `mining-job.service.ts`, the board contract in `template.filler.ts` + `missions.service.ts`, the web in the
    port mining tab, the mission card and the report. Legacy `mining.rarity` / `mining.attempts_per_stop` stay in the config (Appendix E
    tapes), mining no longer reads them; `mining_cargo_full` stays readable for stored logs.
  - Still open: the sim's mining bot does not pick contracts by odds yet (it digs the ores of the place); free digging with big drills pays
    160-270k/h at base price (item 5: K and the ore prices are the levers).
