# Rust and Spark v0.1 — First-playtest feedback plan

> Source: the owner's first hands-on session (2026-09-26) on the compose dev stack. Status: **planned, nothing implemented yet**. More feedback is expected; append it to "Incoming feedback" and re-order before starting.

## Already done in this session (uncommitted)
Auth/Home styling, register field rules and specific error messages (409 / 400 / 429), language switcher style. See `apps/web/src/features/auth`, `pages/home.page.tsx`, `styles/index.css`.

## Approved work

### A. Zoom and readable parts (web only) — approved
- Zoom (+/−, fit, wheel, pinch) and drag-to-pan on the ship grid; cells are ~28 px today and labels truncate ("Sm…", "Ca…").
- Part detail panel for the selected part (full name, description, stats, condition, structure/mass/energy cost); the same content as a hover/focus tooltip.
- Longer labels at higher zoom.

### B. Market filter (web only) — approved
- Chips by part type/class, text search, sort (price, condition), new/used toggle. The API already returns everything; no server change.
- Fix the empty icon squares on the offer cards.

### C1. Shop inside the Hangar — approved (C2 deferred, see Future versions)
- A "Store" tab in the Hangar parts panel reusing the Port market component and the B filter. Buying adds the part to loose parts without leaving the screen.
- Buying stays "pay now"; no draft/ghost parts in v0.1.

### D. The starter kit is a kit, and it arrives uninstalled — approved
- Onboarding creates the ship with an **empty layout** and puts the D31 kit (bridge, small chemical engine, tank, battery, 2× cargo, hull at `parts.starter_condition`, tank full, 200 ¢) into the player's loose parts, grouped and labelled **"Starter kit"**.
- The Hangar opens with an empty grid and a clear call to action ("This is your starter kit. Press Auto layout, or drag the parts in"). The ship cannot be dispatched until it is viable, and the viability warnings say so.
- Touches: `apps/api/prisma/seed-data/starter-kit.ts`, the onboarding service, the D43 first-mission guarantee (must not assume an installed ship), Hangar empty state, and every test/e2e that assumes an installed starter ship (browser smoke, economy specs, soak, contract fixtures).
- **Open point:** the rescue "restart kit" (D41) should follow the same rule (arrive loose, not installed) for consistency. Default: yes, unless the owner says otherwise.
- Records a change to D31 (new decision, D44).

### E. Item descriptions and details — approved
- **E1** Show `description` everywhere a part appears (market cards, Hangar parts, part detail panel). The API already sends it (`GET /v1/parts/catalog`). Add a guard test: a part card without its description fails.
- **E2** Rewrite the ~20 part descriptions in en + pt-BR as a **starting point** the owner will edit later: what it does, why you want or need it, its trade-off. Check that Admin can edit part descriptions (tuning policy: Admin owns data); add that to the Admin editor if it cannot.
- **E3** Requirements: mark required parts (Bridge always; a chemical engine needs a tank; passengers need life support), and make each viability warning name the part that fixes it.
- **E4** A way to see details on demand: an info control on each part (opens the detail panel), plus one-line tooltips for the opaque stats (POT, PDF, BLI, ESC, SEN, CRG, MIN) and a one-line summary on each card ("Engine · speed +2 · burns 0.7 fuel/leg").

## Order
1. E1 + A + B (front-end only, independent).
2. E2 + E3 + E4.
3. C1.
4. D (largest blast radius; do it once the Hangar has the zoom, the detail panel and the empty-state guidance it will lean on).

## Future versions (not v0.1)
- **C2 — mount before you pay:** drag unowned market parts onto the grid as "ghost" parts, see the live stats and total cost, then one atomic "buy N parts and mount" (server: preview accepts catalog offers; new endpoint buys and assembles together; covered by the security and soak suites).
- **Pay at accept:** a draft ship whose parts are paid when the mission is accepted (needs a rule against accept-then-back-out exploits).
- Faction-specific starter kits.

## Incoming feedback (second batch, 2026-09-26) — to be planned, not started
- **F. Map: show where I am.** The player's ship position must be unmistakable on the sector map (marker, label "You are here", pulse), not just a dashed ring.
- **G. In-transit animation.** The Transit screen shows a moving scene: a star field scrolling past, the ship hovering slightly at the centre. Reuses the existing mission countdown; respects `prefers-reduced-motion`.
- **H. Missions need more information.** Cards and the accept flow lack detail (what is carried, where, the risk and why, requirements, reward breakdown, what the ship is missing).
- **I. Map interaction.** Nodes are hard to click; clicking a place should open a popup with its missions (and services) instead of a small side sheet.
- **J. Mission variety.** The board has about one offer per place and too few kinds. Needs more templates and more offers per port (Admin-tunable `missions.board_min_per_location`, new template content, en + pt-BR).
- **K. Mission report screen is boring.** Rework the last screen (the report): a narrated timeline of the trip and fights, visible payoffs, loot and damage, a clear next step.


## Incoming feedback (third batch, 2026-09-26) — to be planned, not started
- **L. Travel without quests.** A way to fly to another port on its own, from the map (pick a port, see the route, fuel and time, confirm). Today the ship only moves by finishing a mission (dispatch is `POST ships/:id/dispatch` on an accepted mission; there is no travel command).
  - *Proposed shape:* a new mission type `TRAVEL` created on demand for the chosen route, with no cargo and no reward, that goes through the normal accept, dispatch, legs, fuel, encounter and report machinery. This reuses everything already tested (idempotency, ON_MISSION lock, resolve, reports) and only adds: a travel-quote endpoint (route, fuel, duration, risk), a create-and-accept step, and a report template for a trip with no cargo.
  - *Rules to decide:* fuel is the cost (already spent per leg); is there a per-trip fee; can the pilot travel with an unviable or empty ship (no: same viability gate as missions); risk (encounters on dangerous legs) stays.
- **M. Position during travel.** While a mission or trip is in progress the map draws the ship on its route (interpolated from the leg windows the server already sends), plus "you are here" when docked. Merges with F.
- **N. Transit/mission screen is boring.** Merges with G and K: animated star field and ship while in transit, a live leg-by-leg progress line, ETA, and what is at stake (cargo, reward, risk); the report screen tells the story of the trip.

Suggested order for F, G, I, M, N and L: map first (F + I + M, one screen), then transit (G + N), then travel (L), then mission variety and information (H + J), then the report (K).
