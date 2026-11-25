# Ship profile references

`ship_profile.ref_*` is the value that counts as a **full** axis (1.0) of the ship profile. Derived by arithmetic
from the seed catalog (`apps/api/prisma/seed-data/parts.ts`), nothing was simulated. Rule: take the strongest
**dedicated** build a mid-game ship can field and set `ref = value / 0.65`, so a good mid-game dedicated ship fills
about 65% of its main axis.

Mid-game ship used: Rare bridge `bridge_rare` (structure budget 120, mass 3), `rare_1` yard (45 cells), all parts
Rare tier. Support for a fuel-burning ship: `engine_chem_small_rare` (5) + `reactor_solar_rare` (2) + `tank_small_rare` (4) = 11 structure.

| Axis | Build used | Value | Ref (rounded) |
| --- | --- | --- | --- |
| cargo (`crg`) | support + 9 x `cargo_bay_rare` (11 structure, 40 crg each) | 360 | 550 |
| passengers (`min(pax, lifeCap)`) | support + 13 x `passenger_cabin_rare` (6 str, 4 pax) + 9 x `life_support_rare` (3 str, 6 lifeCap): 52 seats, 54 air | 52 | 80 |
| firepower (`pdf`) | support + 15 x `weapon_ballistic_heavy_rare` (7 str, 9 pdf) | 135 | 210 |
| defense (`esc + bli * 8`, `combat.armor_pool_factor` = 8) | support + 6 x `armor_plate_large_rare` (18 str, 11.5 bli): 69 x 8 | 552 | 850 |
| mobility (`pot / mass * 1.6`) | 6 x `engine_ion_medium_rare` (pot 144, mass 3.7) + 1 x `reactor_nuclear_rare` (mass 14) + bridge (mass 3): 864 / 39.2 x 1.6 | 35.3 | 54 |
| range (`fuelCap / fuelUse * 100`) | `engine_chem_medium_rare` (fuelUse 20) + reactor + 7 x `tank_huge_rare` (fuelCap 1980): 13860 / 20 x 100 | 69300 | 105000 |
| mining (`min`) | support + 7 x `mining_rig_heavy_rare` (15 str, 4.6 min) | 32.2 | 50 |

Notes:

- A dedicated build fills the structure budget with one kind of part, so it is the strongest a ship of that tier can
  be on that axis; a ship that splits its structure shows proportionally less on each axis (a half-armor, half-gun
  warship reads about 0.3 on each, and the WARSHIP type takes the better of the two).
- Firepower reads `sheet.pdf` (the weapons' stat), not `sheet.pot` (engine thrust, which feeds mobility).
- Range counts fuel-free ion ships as 0 (`autonomy` is 0 when no engine burns fuel); range never names a type.
- Mobility 35 is far above what early ships do (reference_mob 3); the Racer type needs a dedicated ion build to
  reach `min_main` (0.25 of 54 = 13.5). If playtests show Racers never appear, lower `ref_mobility` in the Admin.
- Every number is an Admin knob (`ship_profile.*`); the DB wins over these defaults and takes effect at once.
