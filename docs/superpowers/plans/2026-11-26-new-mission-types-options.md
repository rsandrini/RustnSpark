# New mission types: options for EXPLORE, REPAIR and FIGHT (2026-11-26)

Owner's ask (2026-11-26): "Create a suggestion plan based on what else we have today. Give me options, keep it simple."
Source: `docs/TODO_v0.1.5.md` item 5b. This is an OPTIONS document: nothing here is decided or built.

## What we already have (checked in the code)

- **Specialty table** (`apps/api/src/missions/mission-specialty.ts`): one row per type says which ship stat drives it,
  its curve (`power`, `trips` or `built-in`), a minimum ratio and a blocker code. A new type is one row, a
  `specialty.<type>` knob (en + pt-BR), a blocker label and its `requirement-fix` target. A new stat needs one new
  case in `specialtyStat`.
- **A radar already exists.** The SENSOR part class has the `sensor_radar` (Radar) and `sensor_radar_large`
  (Wide Radar) families, 5 tiers each, with a `sen` stat on the sheet. Today `sen` only lowers ambushes, helps
  escapes and decides who strikes first. It is NOT one of the 7 profile axes (cargo, passengers, firepower,
  defense, mobility, range, mining).
- **No repair tool exists.** UTILITY holds Life Support, Mining Rig and Deep-Core Mining Rig only.
- **Mining is the tool-gated pattern:** the checker asks `min >= 1` (blocker "needs mining equipment"); a board
  contract digs on its LAST leg for up to N ticks (`digTicks`) and stops when the amount is reached; it pays
  `base x delivered / required` (`contractedMiningPayout`); a free mining job digs where it sits, no flight.
- **Combat:** at most ONE encounter per leg. Chance = `danger / chance_divisor` (escort legs x1.5). Pirates come
  from the zone strength; the combat resolver runs rounds; a lost fight wears parts scaled by zone
  (`combat.loss_wear_scale` 0.1 / 0.3 / 0.4 / 0.5), the winner rolls a motive (cargo, stored parts, territory)
  and a contract with cargo or a territory motive ends `defeat_failed`. TODO item 11 (zone-scaled fee) is decided,
  not built.
- **Finds:** scavenging rolls used parts and scrap by zone risk; `economy.core_drops` rolls cores and fragments by
  zone. Rescue hands out loose COMMON replacement parts; the hold carries spare parts (1 slot each, 8 slots).
- **Boards:** templates gate a type by origin faction and place type (`scrap_field`, `dead_zone`, `outpost`,
  `relay`, `frontier`, `garrison`, `port`, `junction`). The board fills the 4 core types
  (`missions.board_core_types`), then races, then extras. The new types would be extras.
- **Pay:** `base x integrity` above the floor (zero below), mining pays by share delivered.
- **Sim:** the bots only take today's types. New types need a regression guard only (same numbers before/after).

## Work every new type needs (the same for all three)

A `MissionType` enum value + migration (also in the encounter policy's own type list and `wearScaleFor`); 1-3
templates (en + pt-BR) with their place types; a specialty row, knob and blocker label (en + pt-BR, the API keeps
its own types, no contract import); a report event or two (en + pt-BR); the contract card needs-chip, a guide
entry and the `requirement-fix` link; Admin knobs for every number (DB wins); a sim run to prove no regression;
the e2e literals checked. Roughly a size S on its own, counted inside each size below.

---

## 1. EXPLORE a region (needs a radar)

**What is the radar?**

- **R1. The radar we have (recommended).** The existing SENSOR parts are the tool: the gate is `sen >= minimum`,
  like mining asks `min >= 1`. A better radar explores faster. New: an 8th profile axis "sensors" (or just a
  `sensors` case in `specialtyStat`). No catalog work.
- **R2. A new survey scanner part.** A new SENSOR family with its own stat, so explorers buy a dedicated part.
  New: 5 tiers x sizes in the seed, a new sheet stat, admin editor, art later. Clearer identity, much more work.

**What does an exploration produce?**

- **A. Area surveyed, paid like a mining contract (recommended).** The ship flies to the region and scans on its
  last leg for up to N ticks, like `digTicks`. Each tick surveys "radar amount per 5 minutes" with luck around it.
  The contract asks for an area (e.g. 100 units). Pay = `base x surveyed / asked`. The trip's encounter risk
  stays as today.
- **B. Finds, like scavenging.** The same scan, but it brings things back: rolls the zone's core drops and maybe a
  used part, using the scavenge and core-drop rolls. The contract pays a small fixed fee and the finds are the prize.
  Rewarding, but it competes with scavenging and mining for the same loot.
- **C. Reveal map info.** A scan uncovers something on the map (a hidden field, a better price, a shortcut). Needs a
  per-pilot map state, new map layers and content. Most fun, the largest by far: it fits the next version's 5x map.

**Recommendation:** R1 + A, with one core-drop roll at the end as a small extra (the drop code exists).
**Reuses:** the SENSOR parts and `sen`, the dig-tick loop and the share payout of mining, the core-drop roll, the
specialty table (a `power` row: a strong radar shortens the scan).
**New:** the type, the scan loop (a copy of the dig loop without ore and cargo space), an "area" number on the
offer, report lines, a "needs a radar" chip.
**Size:** S-M (R1 + A). R2 adds M. C is L.
**Owner's question:** "Should the radar we already sell be the explore tool, and does exploring pay money (A) or
bring back finds (B)?"

---

## 2. REPAIR something (may need a tool)

**What is the "something"?**

- **A. A disabled ship at a place (recommended).** A crew is stranded at an `outpost`, `relay`, `dead_zone` or
  `scrap_field` (the places the rescue templates already use). The pilot flies there, works on site, flies back.
  Reads like the rescue story from the other side.
- **B. A station or beacon at a place.** A relay beacon or a station module is broken. Same mechanics as A; only
  the text and the places change (`relay`, `junction`, `garrison`). Can be added later as more templates.

**What is the tool?**

- **T1. A new repair rig part (recommended).** A UTILITY family "Repair Rig" (5 tiers, small and 2x2), copied from
  the Mining Rig: a `rep` stat (amount repaired per 5 minutes), draws power, adds mass. The gate is `rep >= 1`;
  the work runs on the last leg for up to N ticks; pay = `base x repaired / asked`, like a mining contract.
- **T2. No tool, bring the parts.** The contract names 1-2 COMMON parts (e.g. an engine and a tank) the pilot must
  carry in the spare-part slots; on arrival they are handed over and consumed. Pay covers the parts plus the trip.
  Reuses the hold and the replacement-parts list. No new part, but the mission is "a delivery of parts".
- **T3. Tool plus materials.** T1, and each tick also spends scrap from the pilot's goods (the upgrade materials).
  Gives scrap a use; one more number to balance.

**Recommendation:** A + T1. It matches the owner's rule "each subtype asks for the part that fits it", and the
Mining Rig is a ready template for the part, the gate, the ticks and the share payout.
**Reuses:** the mining rig family shape in the seed, the dig-tick loop and share payout, rescue's place types,
the specialty table (a `power` row on the new `rep` stat), the admin part editor.
**New:** the part family (10 seed rows, en + pt-BR names), the `rep` stat on parts and the sheet (migration, admin
schema), the work loop, report lines, a "needs a repair rig" chip; the store and guide pick up the family by class.
**Size:** M (T1). T2 alone is S. T3 adds S on top of T1.
**Owner's question:** "A new Repair Rig part to buy (T1), or just bring spare parts in the hold (T2)?"

---

## 3. FIGHT in a zone (outline decided 2026-11-23)

Decided: waves of pirates with a target; a score is kept; a partial result that reaches the target is still a
victory; no faction points. The options are about HOW the waves and the score fit today's combat.

- **A. Waves on site, on the last leg (recommended).** The ship flies to a pirate zone. On arrival it fights up to N
  waves back to back with the existing combat resolver (one pirate per wave, from the zone strength, a little
  stronger each wave). Shields recover between waves by the existing regen; hull and battery do not. Score =
  waves won. The ship retreats when its hull falls under a retreat line (an Admin %). Target reached = victory.
- **B. A forced encounter on every leg.** The mission is a route of several legs through the zone; each leg rolls
  an encounter at 100% instead of `danger / chance_divisor`. Score = fights won along the way. Smallest change
  (one flag on the encounter chance), but a "wave" is spread over a trip, and a won fight does not end anything.
- **C. One scaled fight.** A single combat against a pirate whose strength is the sum of the waves; score = damage
  dealt. Simplest of all, but there are no waves to tell and the "partial win" is hard to read.

**Score and pay (for A or B):**
- Score = waves won. The offer shows the target (e.g. 3 of 5).
- Reaching the target pays the full reward; each wave above it adds a bonus (e.g. +15% each, an Admin knob).
- Below the target: either a share (like mining: `base x won / target`) or nothing. This is the owner's call.
- A lost wave is a lost fight: the zone-scaled wear (`loss_wear_scale`) applies as today. There is no cargo, so the
  pirate motive is at most "parts in storage" or "territory" (which ends the run). The fee of item 11 should NOT
  stack on a fight contract if the share rule already pays less (to settle with item 11).

**Recommendation:** A, with pay "full at target, bonus above, share below" (one rule, mirrors mining).
**Reuses:** the combat and encounter resolvers, `generatePirate` and the zone strength, shield regen, the loss wear
by zone, the combat report rounds, the specialty table (a `power` row on `combat`, like ESCORT: a strong ship
fights faster or gets a fairer target), pirate places as origins (item 12 already gives them fewer offers).
**New:** the wave loop (fight, check the retreat line, next wave), the score on the mission row and in the report,
the target on the offer and the card ("3 of 5 waves"), a wave-by-wave report section, the retreat knob.
**Size:** M (A). B is S. C is S but weak.
**Owner's question:** "Below the target, does the pilot get a share of the pay or nothing?"

---

## Questions for the owner

1. EXPLORE: is the radar we already sell the explore tool (yes/no)?
2. EXPLORE: does exploring pay money for area surveyed, or bring back finds?
3. REPAIR: a new Repair Rig part to buy, or bring spare parts in the hold?
4. FIGHT: waves fought on site at the destination (A), or a fight on every leg of a route (B)?
5. FIGHT: below the target, a share of the pay or nothing?
6. FIGHT: does item 11's lost-fight fee apply to a fight contract (yes/no)?

## Recommended build order

1. **EXPLORE (S-M)** first: no new part, it reuses the radar and copies the mining scan loop. It also builds the
   shared steps (enum, templates, extras slot, chip, guide, sim guard) the other two reuse.
2. **REPAIR (M)** second: the same "work on the last leg" loop as explore, plus one new part family.
3. **FIGHT (M)** last: the only one that touches combat; best done with item 11 (the fee) and the next balance
   round, since it changes income and the sim must check it.

Each type ships alone behind its templates (no template = never on a board), so the owner can stop after any one.
