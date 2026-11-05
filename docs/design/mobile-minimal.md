# Minimal phone layout (branch `feat/mobile-minimal`)

The website on a desktop stays as it is. On a phone (`max-width: 700px`, see `PHONE_MAX_WIDTH` in
`apps/web/src/ui/use-phone.ts`) the game shows what is needed to play and keeps the rest one tap away.

## Rules

1. One screen, one job: a first screen holds the thing you came for (the yard, the flight, the list of missions).
2. Details on demand: a "Details" button, an (i) or a sheet opens the rest. No explanatory paragraphs (they live in the Guide).
3. No decoration: no animation banner, no illustrations on the work tabs, no badge art on the report.
4. Thumb reach: the actions sit in the lower half (sticky action bar above the tab bar), 44 px tap targets.
5. A popup is a sheet from the bottom, as wide as the phone.
6. Feedback stays visible: the confirmation after an action (`.notice[role=status]`) sticks under the top bar.

## Where it lives

- `apps/web/src/styles/mobile.css`: every phone-only rule, loaded last. Desktop is untouched.
- `apps/web/src/ui/use-phone.ts`: `useIsPhone()` for the few places that render something different
  (the hangar action bar and the Parts sheet, the mission card's Details fold).
- `apps/web/src/ui/touch-guards.ts`: stops the iOS long-press menu on game controls (the CSS alone is unreliable on recent iOS).
- Help paragraphs carry the class `help-text` (hidden on phones).

## Screens (what a phone shows)

| Screen | On a phone |
|---|---|
| Ship, docked | The yard (about half the screen) with its stat line; action bar: Parts (sheet), Save, Auto layout, More; Rotate/Remove only for a selected part; ship sheet = name, ready/problems, "Show all stats" |
| Ship, in flight | One card: title, reward, route, risk, distance/legs/time, fuel, Details, route map, countdown. No yard, no animation strip |
| Missions | Rows: title, route, time, fuel/risk, reward, Accept/Hold; Details holds the sender, the story and the checklist; blocked and unmet requirements stay in red |
| Port | Part cards are two lines (name and price, then type and buttons); stats in the (i) popup; filter chips slide sideways; no help text |
| Work (scavenging, mining) | The numbers and the button; no picture or story |
| Map | The map first, no legend; the list of places below |
| Report | The verdict, the pay and the numbers; no badge art or sender |
| Popups | Bottom sheets |

Not changed on purpose: the Guide, the signed-out landing page, Admin.

## Checking it

Phone-size screenshots of every screen (390 x 844) are the quickest review. A throwaway Playwright script that registers a
pilot on a scratch stack (`docker compose -p rs_verify ... --profile dev`, see the browser smoke recipe) and visits each route
with `isMobile: true, hasTouch: true` is enough; compare page heights before and after (ship docked 2052 -> 1076 px, ship in
flight 2667 -> 844 px, market 13375 -> 9248 px). Real-phone checks that a script cannot do: the iOS long-press menu, scrolling
in the chip rows, the sticky action bar over the tab bar, the safe-area padding.
