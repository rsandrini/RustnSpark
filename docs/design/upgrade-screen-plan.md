# Upgrade screen: show what is missing (built, 2026-10-20)

Built as recommended: the "You have" strip, the needs list on each card (credits first, each line met or not with what is
missing), the button that names what is missing, the cards grouped as Ready / Missing credits / Missing materials with
counts, and where-to-get-it hints. The "Only what I can afford" filter now starts off. A part that needs repair still
shows in the list below the grid (with its Repair button), not as a card.

Owner (2026-10-19): "today it is too hard to understand what is missing in the upgrade screen; in my case it is
money."

## 1. What the screen does today (from the code and a look in the browser)
Port > Service > Upgrade (`port.page.tsx`, `tab === 'upgrade'`). Each upgradable part is a card:
- the **price** top right ("Upgrade cost", `PartCard price`), the same look whether the pilot can pay it or not;
- under it, "Part · Rarity → Part · Next rarity" and a list of **materials** as small chips
  (`✗ Scrap: 0 of 2`, red when short, green when held);
- one **Upgrade** button, **disabled** when the credits are short, or a material is, with **no reason shown**;
- a filter chip "Only what I can afford", and a "How upgrading works" box (3 rules) above the grid.

What is wrong with it:
1. **Money is the one requirement that is never shown as a requirement.** Materials get a red chip with the
   numbers; money is only the price at the top, so a card that costs 660 ¢ looks the same with 300 ¢ in the
   wallet as a card that costs 77 ¢. The pilot sees a dead button and has to work out why.
2. A disabled button never says what to do about it (the Market already says "Need 170 ¢ more").
3. **Several things can be missing at once** (credits, scrap, crystals, condition) and each is shown in a
   different way and place (condition is on a separate "why not" list below the grid).
4. Nothing says **what the pilot has** overall (credits and materials), so every number is read against memory.
5. Nothing says **where to get** the missing thing (scrap from scavenging and repairs; crystals and cores from
   the farther zones).

## 2. Proposal
One idea: **every card shows the same short "needs" list, in the same order, each line met or not, with the
missing amount, and the button says what is missing.**

1. **"You have" strip** at the top of the tab: `300 ¢ · Scrap 0 · Rare crystals 0 · Core fragments 0`. Always
   visible, so every card is read against it.
2. **Needs list on each card** (replaces the price caption and the chips):
   - `✓ Condition 100%` (or `✗ Condition 85%: repair it first`, with a button to the Repair tab);
   - `✗ Credits: 300 of 660 (missing 360 ¢)`;
   - `✗ Scrap: 0 of 5 (missing 5)`.
   The price stays big at the top; a part you cannot pay for gets the amount missing under it in red.
3. **The button says what is missing**, like the Market: `Upgrade` when everything is met; otherwise it is
   disabled and reads `Need 360 ¢ more`, or `Need 5 more scrap` (the first thing missing, in the order
   condition, credits, materials).
4. **Sort and group**: the cards the pilot can do now first; then "close" (only credits missing); then the rest,
   with a small heading each ("Ready", "Missing credits", "Missing materials"). The "Only what I can afford"
   chip stays.
5. **Where to get it**: under a missing material, a short link: Scrap -> "Scavenge or repair at a Port" (the Work
   tab), crystals and cores -> "Scavenge in the farther zones" (the Guide's topic).
6. **Counts at the top of the grid**: "4 parts ready, 2 need credits, 3 need materials", so the pilot knows
   what to do next without reading every card.

No new server data is needed: the quote already returns the cost, the materials with `have` and `needed`, and the
reason for a part that is not eligible (condition, top tier). The credits come from the wallet the page already
has.

## 3. Work, in order (all web)
1. A small `UpgradeNeeds` component: builds the list from the quote and the wallet, with the first missing thing
   and its text (en + pt-BR), and unit tests for every combination (all met; money only; materials only; both;
   condition).
2. The "You have" strip and the counts (materials from the player's materials query the Port already runs).
3. Use it on the card: needs list, the amount missing under the price, the button label; grouping and sort.
4. The "where to get it" links; Guide text; e2e (new pilot: the Upgrade tab names what is missing and the button
   text matches); the visual specs for the Port.

## 4. Decisions (recommendation first)
- The disabled button should say what is missing (recommended), not only be grey.
- Group the cards by readiness (recommended); the alternative is one list sorted by readiness with no headings.
- Condition keeps its own "go repair" button (recommended) on the card instead of the list below the grid.
