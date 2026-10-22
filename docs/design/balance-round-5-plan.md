# Balance round 5: Rare is comfortable, Epic and Legendary are for the hardcore (plan, 2026-10-22)

Owner direction (2026-10-22), after playing and after the sim check (`sim-report-2026-10-22.md`): the game was too easy;
money piled up faster than it could be spent, the ship was upgraded all the time and combat was no problem. Wanted:
**a pilot can play comfortably on Rare; Epic and Legendary are what the most hardcore players go for**, so they must
be slower, more expensive and more dangerous. Options 1 (money sink at the top), 2 (danger above parity) and 3 (a slower
middle) of the report are approved as a direction. **Upgrades (materials, the upgrade tab) are a separate talk, later.**
Nothing here is built; the numbers below are a first guess to be tuned with the sim.

## 1. What the measurement says (balanced, current defaults)
- Epic at 45-57 game hours (about 50 missions), Legendary at 67-81 h (90-125 missions). Every run got there.
- A mission pays 8k at a Common bridge and 95k at Legendary (x11), while a whole Legendary ship is 1.5-1.8 M (16-19 missions).
  After the last part there is nothing to buy: 0.3-2.7 M piles up at Legendary.
- Fights lost: 64% (Common), 21% (Rare), 5-6% (Epic, Legendary). Pirates are built from the player's own sheet at 55-100%
  of its firepower and hull (never above parity), so a good ship always out-guns them.
- The choice of quest does not matter (a random pilot is as fast as a careful one).

## 2. Targets (to confirm: these are my proposal, change any)
| | now | target |
|---|---|---|
| Rare reached | 23-34 missions, 31-42 h | **unchanged** (the comfortable part stays as it is) |
| Epic reached | 50 missions, 49-57 h | 100-150 missions, **90-130 h** |
| Legendary reached | 90-125 missions, 67-81 h | 250+ missions, **250-400 h** (many will not get there in v1) |
| Wallet at Epic | 10-80k, all spent | stays near zero: a part is always the next thing to buy |
| Wallet at Legendary | 0.3-2.7 M, nothing to buy | never more than the next 2-3 parts |
| Fights lost at Rare / Epic / Legendary | 21% / 6% / 5% | 20% / **15-25% / 25-35%** |
| Missions failed (success rate) | 86-98% | Rare 95%, Epic 85-90%, Legendary 75-85% |
| Repair share of income | 22-30% | Rare 20-25%, Epic 30-40%, Legendary 40-50% |

## 3. Levers (config keys, all Admin-owned data; DB wins over defaults)
**A. The money curve (option 1)**
- `economy.reward_by_bridge`: now `{1, 1, 1.4, 2.2, 3.2}`; first try `{1, 1, 1.4, 1.9, 2.5}` (Rare unchanged, top flattened).
- `economy.reward_per_tier`: 900 -> 700 (the tier part of the reward grows slower).
- Part prices: Epic x2 and Legendary x3 on top of today's (`catalogPrice` in the sim; in the game a migration over
  `PartCatalog.basePrice` and `scrapValue` of those rarities). The ship value then ends near 4-5 M instead of 1.5 M.
- Watch: `economy.ship_tier_thresholds` ({12k, 35k, 80k, 180k}) turns ship value into a tier, and tier feeds the reward:
  dearer parts raise the tier sooner. The sim will show it; if it leaks, scale the thresholds with the prices at Epic and up.
**B. Danger above parity (option 2)**
- `encounter.pirate_strength_options`: `[0.55, 0.7, 0.8, 0.85, 1.0, 1.1]` -> `[0.7, 0.85, 1.0, 1.1, 1.25, 1.4]`.
- `encounter.pirate_zone_strength`: `{0: .35, 1: .5, 2: .65, 3: 1.0}` -> `{0: .7, 1: .9, 2: 1.1, 3: 1.4}`.
  Rare stays comfortable because zones 0-1 stay under parity; zones 2-3 (where Epic and Legendary pilots work) get dangerous.
- If that is not enough: the encounter chance (`encounter.chance_divisor` 20) and a wear/hull factor that does not
  fall with part quality (`wear.hull_to_condition`).
**C. Slower middle (option 3)**: falls out of A (less money per mission at Rare and up, dearer Epic parts). If not enough:
`missions.short_trip_min_seconds` / `duration_k` (a longer minimum trip), or a lower Rare reward. Rare must not get slower.

## 4. How we test it before touching the game (sim, no code)
Edit files `sim/edits/r5-sink.json` (A), `r5-danger.json` (B), `r5-both.json` (A+B), each on the **balanced** and
**random** pilots (random = the owner's style), 4 builds, 8 runs x 300 missions, seed 1 (about 20 minutes together).
Read with `levels.py` and the analysis script of the 2026-10-22 report (pace, wallet by level, reward by bridge, fights
lost by bridge). Iterate the numbers until section 2's table holds; then run greedy and safe once as a check.

## 5. How it ships (after the numbers are agreed)
1. Migration with the new values (rules in `GameConfig`, prices in `PartCatalog`), `game-config.defaults.ts` and
   `seed-data/parts.ts` kept in step, registry bounds checked (`pirate_zone_strength` max 5).
2. Tests that pin the old numbers: grep the old literals (reward, price and pirate fixtures; the validation specs keep
   the signed-off OLD values on purpose; the Appendix E fixtures stay), then unit, integration, validation and e2e.
3. Sim report addendum with the final table; the dev DB reset and rebuilt (api and worker) for the owner to play.
4. Existing pilots are ignored as agreed (resets are frequent).

## 6. Risks
- **Repair floor**: repair cannot go under about 0.6 x part price (the repair/sell exploit test), so wear is the lever; dearer
  Epic parts make repair dearer too, which helps the sink but can stall a weak Epic pilot: check stalls (target 0-3 of 32).
- **Rare must stay comfortable**: every change is judged first on the Rare numbers; nothing at Common-Rare moves.
- **Ion build** is the slowest to Legendary in hours (96-128 h now); it may fall too far behind: watch the spread between builds.
- **Too hard at the top** is the cost of a wrong guess; the numbers are Admin data, so they can be retuned live.

## 7. Open points (recommendation first)
1. Targets of section 2 (Epic 90-130 h, Legendary 250-400 h): **as proposed**, or give your own.
2. Part price multiplier at Epic and Legendary: **x2 and x3 on top** (ship value about 4-5 M), or milder x1.5 / x2.
3. Danger: zones 2-3 above parity as proposed, **keeping zones 0-1 below parity so Rare stays comfortable**.
4. Also touch the encounter chance and wear (section 3B), only if the first pass is not enough (**recommended: only if needed**).
