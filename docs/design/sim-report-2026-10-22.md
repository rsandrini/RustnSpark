# Simulation check: is the game too easy? (2026-10-22)

Owner report from play: money was easy to gain, more than could be spent; the ship was upgraded fast; combat was no
problem. The owner did not pick easy quests: took what was on the board, and when nothing fit travelled to a close
port and worked there.

Method: snapshot re-exported from the dev DB (all current defaults: prices x10, boards of 8/6/4, quest givers), the
same experiment as the earlier rounds (`sim/run-parallel.sh`): 4 builds (chem, chem-shield, hybrid, ion-shield) x 8
runs x 300 missions, seed 1, **four temperaments** (balanced, greedy, safe and **random**, which is the closest to the
owner's way of playing: take whatever the board offers). 16 experiments, `oct22-<temperament>-<build>-edit`. Nothing was
changed in the game; this is a measurement. Numbers are medians of 8 runs.

## 1. Pace: the whole ladder in about 70 game hours and 100 missions
| build (balanced) | L2 | L3 | L4 Epic | L5 Legendary |
|---|---|---|---|---|
| chem | 9 missions / 12 h | 23 / 38 h | 50 / 53 h | 89 / 69 h |
| chem-shield | 12 / 19 h | 24 / 36 h | 54 / 57 h | 94 / 71 h |
| hybrid | 10 / 13 h | 34 / 31 h | 56 / 49 h | 120 / 70 h |
| ion-shield | 6 / 14 h | 12 / 42 h | 18 / 55 h | 60 / 96 h |

Epic comes at 45-57 game hours and Legendary at 67-81 h (ion 96-128 h). Every run of every temperament reached
Legendary inside 300 missions, with no stall. **The pilot's choice of quests hardly matters**: the random pilot (takes a
random qualifying offer) reaches Legendary at 69 / 81 / 69 / 122 h against 69 / 71 / 70 / 96 h for balanced. It agrees
with the owner's experience: playing "what is on the board" is as good as playing it well, because every quest pays well.

## 2. Money: it grows faster than the shopping list
Reward per mission by the ship's bridge rarity (balanced, all builds):

| bridge | missions | reward paid | trip | reward per game hour | fights per mission | fights lost | repair/wear |
|---|---|---|---|---|---|---|---|
| 1 Common | 280 | 8,330 | 0.29 h | 28k | 0.10 | 64% | 8 pts |
| 2 Uncommon | 483 | 15,336 | 0.37 h | 41k | 0.21 | 57% | 19 pts |
| 3 Rare | 621 | 30,671 | 0.21 h | 143k | 0.40 | 21% | 34 pts |
| 4 Epic | 992 | 59,697 | 0.19 h | 314k | 0.42 | 6% | 21 pts |
| 5 Legendary | 571 | 95,453 | 0.21 h | 446k | 0.40 | 5% | 16 pts |

A mission pays 11 times more at the top than at the start, while trips get shorter (0.19-0.21 h). A whole Legendary
ship costs about 1.5-1.8 million, which is **16-19 top missions**. After the last part is bought there is nothing to buy:
the wallet when a run reaches Legendary is 0.3-2.7 million (balanced 295k-1.3M, random chem 1.5M, safe hybrid 2.7M), 5-41%
of all income is never spent, and repair is the only sink left (22-30% of income; fuel 6-8%; upgrade materials about 1%).
Before Epic the opposite holds (wallet 10-80k at L4, everything spent on parts), which is why the first hours feel right and the
last ones feel free.

## 3. Combat: a threat only for the first hours
The share of fights lost falls from 64% (Common bridge) to 5-6% (Epic and up), and the hull stays at 93-97% integrity on
average. Overall the pilot wins 79-89% of fights (69-72% only for the ion build under greedy and safe play) and succeeds
in 86-98% of missions. Danger is moderate: an average of 3.5-4.6 on the 0-10 scale, and only 13-27% of the missions go
above 6 (49% only for a greedy ion pilot). Enemy strength does not follow the ship: pirate strength is a fixed
number by zone (0.35 / 0.5 / 0.65 / 1.0), so a Rare ship out-guns zone 0-2 for good and combat stops mattering.

## 4. What this says about the owner's game
- It is not the choice of easy quests: a random pilot does as well. The cause is the curve: reward per mission grows
  about 11x while the cost to expand grows slower than the reward and ends at a fixed ceiling (a full Legendary ship).
- The ship "was upgraded all the time" because from Rare up one mission is worth 2-3% of the next part. Wear and repair,
  the old lever of round 4, fell from 34 to 16 points per mission as the ship gets better.
- Combat is a one-way ramp: strong at the start, a formality from Rare up (loss 21% -> 5%).
- The test pad, the new boards and the quest givers did not change this (they were measured in the 2026-10-20 report).

## 5. Options for balance round 5 (nothing applied; pick what you want tested)
1. **Money sink at the top**: price of Epic and Legendary parts x2-3 (and bridge expansion), so the ceiling is about
   10-20 million instead of 1.5 million; or reward by bridge flattened at the top (`reward_by_bridge` 4-5 from x6 to x3-4).
2. **Danger that follows the ship**: pirate strength and fight rate scaled by the ship's tier (or by the player's best
   part), so combat stays a risk at Epic and Legendary; and a wear/hull cost that does not fall as parts get better.
3. **Slower middle**: Epic at 50 h is quick; a longer Rare-to-Epic step (fewer missions per hour via a longer minimum
   trip, or lower reward at Rare) would stretch the ladder to the 120-200 hours of the earlier targets.
4. **A different sink**: upgrade materials (scrap, crystals, cores) were about 1% of spending: more of the ladder could
   run on them instead of money.
Each can be tried as a `sim/edits/*.json` and compared with this baseline in minutes (the previous rounds did exactly
that); recommended first pass is 1 + 2 together.

Not checked: the replay against real play (`test/validation/sim-replay.ts`, needs the owner's missions in the DB), the
quest-giver type weights (bots read the board the same way), and fights by zone.
