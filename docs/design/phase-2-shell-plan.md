# Phase 2 plan: shell and navigation (A)

Scope rule (owner, 2026-10-16): **the shell only.** Screen contents stay as they are. In particular the
**Store tab stays inside My Ship** and Port keeps its seven tabs; merging them is a later phase, if ever.
Everything below is chosen so that no later phase has to undo it.

## 1. What the shell is today (facts)

- One `TopBar` row: `GameNav` (My Ship / Port / Board / Map), `ShipIdentity` (faction badge, ship name,
  status text), `LastMissionLink`, `LanguageSwitcher`, `AccountMenu` (wallet, Profile, Admin, Sign out).
- `HangarPage` serves three paths: `/hangar` (ship), `/hangar/port`, `/hangar/board`; it holds the place
  banner (`ActiveShipStage`), the transit view while a mission flies, and the yard. `/board`, `/port`,
  `/transit` are redirects. Map, report and profile are their own routes.
- The pages' `<h1>` are visually hidden (`sr-only`) on My Ship and Map.
- 33 places in the code and 18 specs use the old paths or labels; the browser smoke uses `/hangar`,
  `/board`, `/map`.

## 2. Decisions this plan rests on (confirm or change before step 1)

| # | decision | recommendation |
|---|---|---|
| D1 | Top-level routes | `/ship`, `/port/:tab?`, `/missions`, `/map`. All three of ship, port and missions still render `HangarPage` with a different tab, so no screen content moves. |
| D2 | Old URLs | `/hangar`, `/hangar/port`, `/hangar/board`, `/board`, `/port`, `/transit` redirect to the new ones and keep the query string (the board's `?location=` filter). They stay for good, like the existing redirects. |
| D3 | Labels | en: Ship, Port, Missions, Map. pt-BR: Nave, Porto, Missões, Mapa. (Today: My Ship / Minha Nave, Board / Quadro.) |
| D4 | The old "Board" content under the "Missions" name | yes, unchanged. The in-flight transit view stays where it is today (on Ship); merging it into Missions is a screen change for a later phase. |
| D5 | Language switcher | moves into the account menu (it is used once per session, it does not need a place in the bar). |
| D6 | "Last mission" link | moves to the right end of the status strip. |
| D7 | Status strip | ship identity (faction badge, ship name) and status text with the countdown while something is running. It will repeat the place name that the banner already shows, until the banner is shrunk in the screen phase. |
| D8 | Place banner and its "Hide animation" control | **untouched in this phase.** |
| D9 | Page titles (lowercase serif with an accent word) | **not in this phase.** My Ship and Map have no visible title today; adding one is a layout decision for each screen. |

## 3. Steps (each one ships on its own: web tests green, CI green, before/after screenshots)

1. **Routes and redirects (no visual change).** *(done; `/port` has no `:tab` parameter yet, Port's own tabs are not URL-driven until the Port screen is rebuilt)* New paths per D1, redirects per D2, `goToTab` and every
   internal link updated, `useNavigate` targets updated. Specs and the browser smoke move to the new paths.
   *Why first:* everything after it (nav links, tab bar) points at the final URLs, so nothing is rewritten.
2. **Labels.** `nav.*` strings in en and pt-BR per D3 (Transit's and Board's keys are removed or reused);
   specs that look for "My Ship" / "Board" follow.
3. **Header.** New `TopBar`: wordmark, four links, wallet, avatar menu (Profile, Language, Admin for admins,
   Sign out). `GameNav`, `AccountMenu` rebuilt on the component kit; `ShipIdentity` leaves the bar.
4. **Status strip.** New component under the header per D6 and D7, reading the same queries as
   `ShipIdentity` today (`/v1/ships`, world, rescue settle) so no data flow changes.
5. **Phone tab bar.** Under 860 px the four links become a fixed bottom bar with safe-area padding and the
   top nav row disappears; the header keeps wordmark, wallet and avatar on one row.
6. **Hardening.** 320 / 375 / 414 / 768 px, keyboard and focus order, the account menu closing on Escape and
   outside click, reduced motion, the browser smoke on desktop and phone, before/after screenshots.

## 4. What this phase does not touch (so it cannot need redoing)

My Ship's Parts / Store tabs, the yard and its stylesheet, the ship sheet, Port and its seven tabs, the
board cards, the map, the report, auth, onboarding, profile, the banner, and the admin screens.

## 5. Risks

- Specs and the smoke: 18 specs and the smoke reference old labels/paths; they are updated in the same
  step as the code that changes them, never left red between steps.
- The header carries the wallet and the language, which several tests read (`topbar-wallet`); the test ids
  are kept.
- pt-BR labels are longer ("Missões"); checked in step 6 at 320 px.
