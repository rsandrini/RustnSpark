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
- Mobility 35 is far above what early ships do (reference_mob 3). That only scales the radar: a ship with
  mobility 0.13 is still a Racer (from `racer_min` 0.08), because the type is named from the relative shape (below).

## How the type uses the profile

The refs only scale the radar (absolute values, 0..1) and the modifier. The **type** is named from the relative
shape: the type axes (cargo, passengers, the better of firepower and defense, mining, mobility; range excluded)
are summed; a nearly empty ship (sum at most `min_total` 0.05) is Balanced; otherwise the top share must be at
least `min_share` (0.5) and lead the second share by `lead_margin` (0.15), else Balanced. The modifier is the
strongest remaining axis that is at least `second_min` (0.5) absolute, or a type axis holding `second_share`
(0.25) of the sum. This keeps early Common ships from all reading Balanced (the old "every ship is Multirole" bug).

Mobility only takes part in the type decision from `racer_min` (0.08) up: any hull with an engine has some mobility,
so a small value would otherwise make every lightly engined ship a Racer. Mobility is a modifier only through the
absolute `second_min` rule, never through the share rule.

Results from the seed catalog, derived by `ship-class-seed.spec.ts` through the real `deriveSheet`,
`deriveShipProfile` and `deriveShipIdentity` (values rounded to 3 decimals):

| Ship | cargo | defense | firepower | mobility | Type (modifier) |
| --- | --- | --- | --- | --- | --- |
| starter kit | 0.018 | 0 | 0 | 0.026 | Balanced (nearly empty) |
| starter, medium engine and one gun | 0.018 | 0 | 0.014 | 0.044 | Balanced (nearly empty) |
| starter plus one cargo bay | 0.064 | 0 | 0 | 0.020 | Hauler |
| 14 Common cargo bays | 0.636 | 0 | 0 | 0.006 | Hauler |
| 8 Common cannons | 0 | 0 | 0.114 | 0.019 | Warship |
| light fast Common chem ship (2 medium engines, tank, reactor) | 0 | 0 | 0 | 0.134 | Racer |
| Rare ion racer (3 medium ion + nuclear) | 0 | 0 | 0 | 0.456 | Racer |
| 8 Uncommon cargo bays | 0.436 | 0 | 0 | 0.013 | Hauler |
| Rare 4 cargo bays + 3 large armor | 0.291 | 0.325 | 0 | 0.017 | Balanced (shares 0.48 / 0.52) |
| Rare 6 cargo bays + 2 large shields | 0.436 | 0.221 | 0 | 0.022 | Hauler (defense) |

## Passenger transport knobs

Related admin knobs (not part of the profile): `missions.transport_passengers_min` and `missions.transport_passengers_max` (head count, default 1 to 6),
`missions.transport_pay_per_extra_passenger` (default +10% per extra person). Part fields `pax` (cabin seats) and `lifeCap` (people a life-support part keeps alive)
feed the passengers axis and the people-transport check. Average transport pay rises about 25%; not re-simulated.
