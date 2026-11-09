# Balance notes - prod account `bc3164ff` (read-only extract, 2026-11-09)

Source: `backups/prod-2026-11-09/*.jsonl` (gitignored): MissionLog + MissionInstance, PlayerEvent, GameConfig, ShipRating.
Run: 98 missions in 4.5 days, 1.236M credits earned, 263k spent (21%), 984k in the wallet.

## 1. The money
- 7 trips in zone 3 (danger 9-10, distance 3000-12900) paid 1.17M = 95% of all income. Everything else is small change.
- Pay per real hour: 13-43k (Nov 5, zone 1-2) -> 100-200k (Nov 6, mobility up) -> 180-400k (zone 3 long trips).
- Pay per distance is about 15 on the board at any zone, ~22 for the Races; what grows is the DISTANCE: zone 3 danger 10 offers
  average 9171 distance (152k), zone 2 danger 5 average 1802 (30k). Board now: 46 deliveries avg 71k, max 222k; races max 310k.
- Spend: upgrades 141k, market 84k, repairs 35k (2.8% of income), refuel 1.4k. Nothing taxes the income.

## 2. Why it is easy: nothing scales with distance except the pay
- Encounters are per LEG (`danger / 20`), not per distance. Wear is per leg and by danger, not by distance. A 10016-distance run in
  5 legs costs the same exposure as a 500-distance run in 5 legs, and pays 20x.
- Time: mobility 2 -> 7.8 cut seconds per distance 4x (1.13 -> 0.28). Pay has no time term, so pay per hour grew with the engine.
- Ion burns no fuel, so a long trip has no running cost (chemical would pay per unit of distance).

## 3. Combat (38 wins, 1 loss, 6 escapes in 45 fights)
- Enemy hit rate fell 52% (Nov 5) -> 31% -> 26% -> 12-14% (Nov 8-9). Cause: the dodge number (`dc = 10 + 1.5 x mob`) went 13 -> 22 as
  mobility rose, and the pirate needs d20 + 3 >= 22.
- The pirate is built from the player's own sheet (pdf x 0.55-1.1, never below 2, no shield, mob +-1 of the player). With the
  player's pdf 3-5 the pirate pdf stays 2-3 at every stage: it never gets stronger than "the ship you already have".
- The shield (32-41) soaks everything: hull damage was 0 in 33 of 38 wins. Most fights run to the 40 round cap and are decided by
  hull ratio ("stalemate by hull"), nobody dies.
- Danger (up to 10) only changes how often a pirate shows up (50% per leg at 10), not how strong it is. The zone cap
  (`pirate_zone_strength` 1.0 in zone 3) and `pirate_strength_by_bridge` (RARE 1.0) hold the strength at or below the player's.

## 4. Environment
- Mean wear to the hull per leg: debris 0.3, gravitational 0.0, radiation 0.9, open 1.2 (max 11). Part wear is ~1-14% per part on a
  60-minute zone-3 trip, repaired for 2-11k. Environment is cosmetic at this level.

## 5. Candidate levers (not decided)
1. Make exposure follow distance: encounter chance and wear per unit of distance (or per N distance), not per leg.
2. Make pirates and environments scale with the zone/danger on their own (a floor on pirate pdf/hp/shield by zone, `dodge` capped so
   mobility cannot reach "never hit": e.g. cap the dodge bonus or give the pirate a to-hit bonus by danger).
3. Pay with a time term or a per-hour ceiling per rarity; cap the distance of a mission by the ship's tier.
4. A distance cost for ion (battery/reactor wear, or a charge), so ion has a running cost like chemical.
Next: reproduce this run in the sim (ion-only bot) before choosing.
