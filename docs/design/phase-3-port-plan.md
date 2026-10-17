# Phase 3, screen 1: Port (plan, nothing built yet)

Scope rule: **the logic does not change.** Same API calls, same flows, same test ids, same roles. This is
markup, copy, defaults and styling. My Ship's **Store tab stays**, and because it is the same `MarketPanel`
component as Port's Market tab, whatever changes in the panel changes in both places (flagged below).

## 1. What Port is today (facts)

`port.page.tsx` (1,626 lines) is mounted inside My Ship's page (the `/port` route). Seven tabs, in this
order: **Market, Your goods, Repair (badge: number of damaged parts), Refuel, Upgrade, Scavenging, Mining**
(Mining only where the place is minable). A second wallet chip sits at the right of the tab row, and the
place banner (170 px) sits above it. Part cards (`PartCard`, shared) show name, price, rarity pill, a
condition gauge, a one-line summary, a three-line description and a connector grid; the buy button is
always a large blue button (disabled "Not enough funds" when you cannot pay). The market filters are a chip
row of part classes plus search, rarity, size, condition and sort (default sort: by name).

## 2. What changes, tab by tab

### Frame (all tabs)
- **Title:** visible lowercase serif place name with one accent word ("ceres *port*"), one line of subtitle
  (type and faction) under it. Today the page has no visible title.
- **Wallet:** the second wallet chip next to the tabs goes (the wallet is always in the top bar now). The
  "negative balance" warning stays, as a coral strip.
- **Tabs:** the same seven tabs, restyled with the kit (brass underline, mono count badge on Repair).
  *Option (your call, see section 4): group them as Buy / Service / Work.*
- **Notices and errors:** keep their `role="status"` / `role="alert"`; restyled as one-line strips under the
  tabs (ok / coral) instead of loose paragraphs.

### Market (shared with My Ship's Store)
1. **Defaults and filters.**
   - New chip **"Affordable now"**, on by default, hides what you cannot pay; the empty state then says what
     is happening ("nothing here is affordable yet, switch off Affordable now to see everything").
   - Default sort **price, low to high** (today: by name).
   - Part-class chips stay. Search stays. Rarity, size and condition (new / used) move into a **"More
     filters"** popover; sort stays visible. Fewer controls on the first line.
2. **"Your ship needs" row** above the cards, computed from the ship sheet the page already has (no new API
   call): no weapon, no shield, no armor, negative energy, no cargo. One line each, with a button that applies
   the matching class chip. Dismissible. *Shown in Port; in My Ship's Store it is available too (same
   panel), tell me if you want it Port-only.*
3. **Card redesign (`PartCard`, shared by Market, Goods and Upgrade).**
   - Hairline card, rarity as a small coloured pip next to the mono "RARITY · CLASS · SIZE" line (the left
     rarity bar goes).
   - Shows: name, price (mono, brass), the one-line key stat, the buy button. The three-line description and
     the connector grid move behind the (i) button and the existing hover compare card (they are already
     there); the condition gauge only appears when the part is not at 100%.
   - **Buy button:** brass primary when affordable; when not, a quiet disabled button reading **"Need 168 ¢
     more"** instead of "Not enough funds" (new string, en + pt-BR).
   - Grid: `auto-fill` from 250 px, so 4 to 5 columns on desktop, 1 on a phone.
4. The buy confirmation popup keeps its flow; it moves to the kit's popup style (serif title).

### Your goods (sell side)
Same card as above, sell button in the kit style, the "too damaged to sell" note as a coral line. Selling
logic, quotes and the discard confirmation are untouched.

### Repair
- Damaged parts become **rows**: name, condition bar, points lost, cost (mono), with the total and one
  **"Repair all"** primary button at the bottom; the per-part tick boxes stay.
- The quote popup and the "afford" message are unchanged; numbers are mono and tabular.

### Refuel
- Fuel gauge (brass fill), the slider and the price as mono numbers; one primary button; when the tank is
  full the button is disabled and says so. No change to the quote or to the slider's step.

### Upgrade
- Cards use the new part card; the next rarity is shown as an arrow ("common → uncommon"); the money and
  materials needed are chips with a tick (you have it) or a cross (you lack it, with how many). Logic and
  confirmation unchanged.

### Scavenging and Mining
- "With the ship" / "On foot" become a two-option segmented control with the hint under it (the hint text is
  today in a card); cooldown countdown in mono; the ship/foot result summary is unchanged.
- The hero art stays (it is the one place the art earns its space). Mining shows its "needs a mining rig"
  state with a link to the market filtered to rigs.

## 3. What does not change
API calls, quotes, intent keys, confirmation flows, test ids (`port-tabs-wallet` goes with the chip;
`topbar-wallet` is the wallet), the viability gates, rescue banner, the bridge resize panel (a separate
screen section), the place banner (see decision 1).

## 4. Decisions (answered 2026-10-16)

1 slim header: **yes**. 2 tabs: **grouped as Buy / Service / Work**. 3 "Affordable now": **no default** (the chip
exists, it starts off). 4 "Your ship needs" row: **both** Port and Store. 5 description behind (i): **yes**.
*(Below: the original options, kept for the record.)*

## 4b. Original options

1. **The 170 px place banner on Port.** Keep it as is, or replace it on this screen by a slim header: place art
   as a 96 px background with the title over it? *Recommended: slim header (the title needs a home, and it
   gives about 80 px back).*
2. **Tabs.** Keep the seven, or group them as **Buy** (market + your goods) / **Service** (repair, refuel,
   upgrade) / **Work** (scavenging, mining)? *Recommended: keep the seven for now. Grouping is a navigation
   change that can come after the screen reads better; nothing in this plan depends on it.*
3. **"Affordable now" on by default**, in Port and in My Ship's Store (same panel). *Recommended: yes.*
4. **"Your ship needs" row** in both, or Port only? *Recommended: both (it is the same panel).*
5. **Card description behind (i).** The description today is always visible. *Recommended: hide it; it
   remains one click or one hover away.*

## 5. Order of work (each step shipped, tested and CI-green on its own)

| step | what | touches |
|---|---|---|
| P1 *(done)* | Frame: slim serif title header, Buy / Service / Work groups with a second row of tabs, no second wallet chip, notice strips | `port.page.tsx`, `ui/PortTabs.tsx`, `ui/ShipStage.tsx`, new `styles/port.css` |
| P2 *(done)* | Market panel: price-ascending default, "Affordable now" chip (off), "More filters" popover, "your ship needs" row, lighter card (description behind (i), gauge only when worn, the before-buy connector grid stays), "Need N ¢ more" | `market-panel.tsx`, `part-card.tsx` (shared with Store) |
| P3 *(done)* | Goods, Repair, Refuel: the repair and refuel rules moved out of the legacy sheet into `port.css` (rows, summary, brass fuel gauge, mono numbers); section headings in serif and mono. The repair slider and quote logic are unchanged. | `port.css`, `index.css` |
| P4 *(done)* | Upgrade (rules box, what-it-becomes line, material chips with a tick or a cross), Scavenging and Mining (mono fact tiles, brass-ringed mode cards with a smaller picture, serif headings): the rules moved into `port.css`. The ship/foot radio cards stay (they carry the hints and the art); a segmented control would have dropped content. | `port.css`, `index.css` |
| P5 *(done)* | No sideways overflow on all seven tabs at 320, 375, 414, 768 and 1280 px; 430 web specs; browser smoke and economy 14 of 14 | specs, e2e |

The Port rules in the 5,900-line legacy sheet (about 48 selectors, 21 of them card rules) move into
`styles/port.css` as each part is rebuilt, so the sheet shrinks instead of growing.

## 6. Cost and risk

About 70 of the 427 web specs touch Port or the market (`port.spec.tsx` 37 tests, `market-panel.spec.tsx`
and the hangar Store tests): they keep passing by keeping roles, labels and test ids, and I update the few
that read strings that change ("Not enough funds", the default sort). The shared `PartCard` also renders in
Upgrade, so P2 and P4 are checked together. The main risk is the default "Affordable now": a player with
little money sees a short list, so the empty state has to be good (it is part of P2).
