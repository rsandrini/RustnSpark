# Fuel on a mission card: show what you have and what the trip needs (built, 2026-10-20)

Built as recommended: the fuel block sits under the facts (`fuel-block.tsx`: a sentence with the three numbers, a bar with
the fuel aboard, the trip's mark and the tank's end, the verdict word and the one action), three states from
`fuel-status.ts` (enough / short, amber, "Refuel N" opening the Refuel tab with N chosen / tank too small, red, "Find a
bigger tank" to the market), and a fuel chip on every mission row.

Owner (2026-10-20): "fuel required in the missions is badly represented. We can show the current fuel and the amount
necessary highlighted, or in another way."

## 1. What the card shows today (`features/board/mission-card.tsx`)
- A "Fuel needed" row with a **bar** of the fuel aboard (`75/300` inside it), the trip's burn carved out of the fill in a
  highlight colour, and "uses 120" beside it. When the fuel aboard is short the bar turns red ("bad").
- Under it, a red line when short: either "refuel first" (a link to the Port's Refuel tab) or, when the trip is longer
  than the tank, "refuelling is not enough".
- Since 2026-10-19, a FUEL_CAPACITY warning row in the requirements list when the trip needs more than the tank holds.

What is wrong: (1) the numbers that matter are not side by side in words: you have 75, it needs 120, the tank holds 300,
so you are short by 45; the pilot has to read a bar and a separate "uses 120"; (2) the carved-out part of the bar only
makes sense when the pilot has enough fuel; when short, the burn is wider than the fill and the picture is confusing;
(3) three different states (enough, short but refuelling fixes it, impossible with this tank) look almost the same
until the red line under the bar; (4) the fuel row sits below the requirements, far from the reward and the trip facts
where the pilot decides; (5) a mission list (the rows) shows no fuel at all.

## 2. Proposal
One short sentence, one bar, three clear states, in the same place on every card and row.

1. **A sentence first**: `Fuel: you have 75 · the trip needs 120 · tank 300`, with the "needs" number highlighted.
2. **Three states, each with its own colour, icon and word**:
   - **Enough** (green, "OK"): you have at least what it needs.
   - **Refuel first** (amber, "Short by 45"): the tank can hold the trip, you just do not have it yet; a button/link
     "Refuel" to the Port's Refuel tab (asks for the amount missing).
   - **Too far for this tank** (red, "Needs a bigger tank"): the trip needs more than the tank holds; says how much
     more (`needs 800, tank 300`), and offers the Store's tanks (like the market tip).
3. **The bar shows three marks on one scale** (0 to the tank's capacity, or to the trip's burn when it is bigger): the
   fuel aboard (fill), the trip's burn (a bracket or a tick, in the highlight colour) and the tank's end. When the trip
   needs more than the tank, the scale runs to the burn and the tank end is marked, so the gap is visible.
4. **Move the row up**: next to the reward and the flight time (the facts the pilot weighs), not below the requirements;
   the requirements list keeps the FUEL_CAPACITY warning (already built).
5. **Mission rows (the list)** get a small fuel chip with the same three states (`OK`, `Short 45`, `Tank`), so the pilot
   can scan a board for what they can fly now.
6. A pure-ion ship (burns no fuel) shows nothing, as now.

## 3. Work (web only; the numbers are already in the offer: `info.estimate.fuelNeeded`, the ship's `fuel` and `fuelCap`)
1. A pure helper `fuelStatus(have, needed, cap)` returning the state and the amounts, with unit tests for each state and
   the edges (equal, zero tank, a pure-ion ship).
2. The new fuel block on the card (sentence, bar with marks, the state word, the action link), en + pt-BR, a11y names.
3. The chip on the rows; the Port link opening Refuel with the missing amount preselected (`?tab=refuel&units=45`).
4. Tests (card states, row chip), a browser check of the three states, the visual specs for the Missions screen.

## 4. Decisions (recommendation first)
- Put the sentence AND the bar (recommended); the alternative is the sentence only, on narrow screens.
- The "Refuel" action opens the tab with the missing amount preselected (recommended).
- Amber for "refuel first" and red only for "tank too small" (recommended), so red means "you cannot fix it by refuelling".
