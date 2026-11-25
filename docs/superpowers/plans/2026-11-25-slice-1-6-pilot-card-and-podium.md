# Slice 1.6: the pilot card and the rankings podium

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Commit on `develop`, one commit per task.

**Goal:** the profile stops being "a grid of zeros and a plain table of names": a pilot is a face with a ship and a few big numbers, and the rankings are a podium with the asking pilot's place and how far they are from the next one.

**Owner scope note (2026-11-24):** no browser/e2e/screenshot task; the owner reviews visually later. Unit specs and the final whole-slice review still run.

**Architecture:** web only, no server change. Two small pure modules (`podium.ts` for the rankings, `pilot-numbers.ts` for the card tiles) feed presentational components. Existing data is enough: `RankingResponse` (top 50 entries, `me`, `total`), `PublicProfileResponse` (name, faction, ship with `profile`/`shipClass`/`profileModifier`/`bridgeRarity`, `totals`, `records`, `successRate`), and the signed-in user's `publicId` (`PlayerProfileResponse.publicId`).

**Not in this slice (the mockup `5-pilot-and-podium.png` shows them but no system exists):** a pilot RANK with an XP bar ("Rank 4, 620/1000"), and MEDALS. They need game design (what is a rank, what earns a medal) and a server model: they stay out until the owner designs them. The card keeps room for them (a row below the stats that renders nothing).

**Tech Stack:** React + Vite, react-i18next, Vitest + Testing Library. Kit from slices 1.1 to 1.5 (`IconTabs`, `ShipRadar`, `StatPip`, `RiskPips`, `Tooltip`, faction helpers `ui/factions`, `FactionBadge`).

**Spec:** `docs/design/game-ui-v0.2-plan.md` section 4 (Profile / Rankings), mockup `docs/design/game-ui-v0.2/mockups/5-pilot-and-podium.png`.

## Global Constraints

- Work on `develop`, one commit per task. `git branch --show-current` before every commit; never `release/*`, `main`, `master`. Pushing `develop` is allowed.
- Code in English; every player-facing string in en AND pt-BR, no hard-coded text; copy removed from the UI is removed from both locale files unless another screen still uses it (grep first).
- One short line per panel; symbols never carry meaning alone (the podium has numbers and names, the faction colour has the faction badge text).
- 390px phone: the podium columns shrink (names truncate with ellipsis, full name in the accessible name), the card is one column.
- Existing behaviour that must keep working: the ranking links to `/pilots/:publicId`, the `isMe` highlight, `data-testid="ranking-list"` and `ranking-own` (specs and e2e use them: grep `apps/web/e2e` before changing), the board/window/route controls and queries (`['ranking', board, window, route]`), the report-a-pilot button on other pilots' cards, the weekly window note for ship boards, the empty and error states.
- A pilot's public card never shows parts or layout (contract comment): keep it.
- `apps/web` must not import API code. No server change. Admin screens untouched.
- Tests: run only the specs of touched files; no browser, no e2e (a grep of `apps/web/e2e` for changed literals is still required).

## Review Focus

- A board with 0, 1, 2 or 3 entries: the podium shows only the places that exist (no empty pedestals with undefined names), the list below is empty.
- Ties (several pilots with the same value): the server ranks them; the podium follows `entry.rank` and shows equal values.
- The asking pilot is in the top 3, in 4..50, or outside the top 50 (only `ranking.me`): the "You" strip says rank and, when the pilot is in the list, the gap to the pilot just above; outside the top 50 the gap is unknown and is NOT invented.
- Value formats: distance/fights/races as integers, ship boards with 1 decimal, race time as m:ss (existing `valueText`): the podium and the list use the same formatter.
- Race-time board: LOWER is better; "points to pass the next" is a time to shave, phrased differently ("-12 s to pass"); never negative or nonsense.
- A pilot with no ship (`ship: null`) and with no flights (`missions.started` 0): the card shows a clean empty state and no radar, no grid of zeros.
- A very long pilot name and a pt-BR label: truncated/wrapped, no overflow at 390px.
- Faction with no colour in the DB (unknown faction id): the avatar ring falls back to the neutral colour.

## File Structure

- Create `apps/web/src/features/rankings/podium.ts` (+ spec), `podium.tsx` (+ spec).
- Create `apps/web/src/features/profile/pilot-numbers.ts` (+ spec), `pilot-avatar.tsx` (+ spec).
- Modify `features/rankings/rankings.page.tsx` (+ spec), `features/profile/pilot-card.tsx` (+ spec), `features/profile/profile.page.tsx` (+ spec), `styles/rankings.css`, `styles/profile.css`, both locale files.

---

### Task 1: the podium data (pure)

**Files:** create `podium.ts`, `podium.spec.ts`.

**Interfaces:**
- Consumes: `RankingEntry`, `RankingBoard` from `apps/web/src/api/generated`.
- Produces:
  - `podiumOf(entries: readonly RankingEntry[]): { first?: RankingEntry; second?: RankingEntry; third?: RankingEntry; rest: RankingEntry[] }` by `entry.rank` order (the server's order is the truth; do not re-sort values): positions 1 to 3 and the rest (4 and up).
  - `gapToNext(input: { board: RankingBoard; entries: readonly RankingEntry[]; me: { rank: number; value: number } | null }): { kind: 'first' } | { kind: 'behind'; amount: number } | { kind: 'unknown' }`: when `me.rank === 1` -> `first`; when the entry with `rank = me.rank - 1` is in `entries` -> `behind` with `amount = |that.value - me.value|` (for `race_time` the amount is a time to shave: the pilot ahead has the LOWER value; for the other boards the pilot ahead has the higher value); when that entry is not in the list (the pilot is outside the top 50) -> `unknown`; `me === null` -> `unknown`.

- [ ] **Step 1: Failing tests:** `podiumOf` with 0, 1, 2, 3, 5 entries (names/ranks in the right slots, `rest` correct); `gapToNext`: me rank 1 -> first; me rank 14 inside the list with the rank-13 entry 120 above -> behind 120; race_time board: me 95 s, ahead 83 s -> behind 12; me outside the top 50 -> unknown; me null -> unknown; equal values (tie, rank 2 and 3 same value) -> behind 0 (the UI treats 0 as "tied").
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(ui): podium data from a ranking (pure)`.

---

### Task 2: the podium component and the rankings page

**Files:** create `podium.tsx`, `podium.spec.tsx`; modify `rankings.page.tsx` (+ spec), `styles/rankings.css`, locales.

**Interfaces:**
- Consumes: `podiumOf`, `gapToNext` (Task 1), `FactionBadge`, faction colour helpers (`ui/factions`), the page's `valueText`.
- Produces: `<Podium entries board valueText />`: three columns in the order 2-1-3 (the winner in the middle and the tallest), each with an avatar placeholder (a round tile with the pilot's initial in a ring of the faction colour; no portrait system for pilots exists), the pilot name (link to `/pilots/:publicId`, truncated), the value, and the place number on the pedestal; only the places that exist; the `isMe` entry highlighted. `<OwnPlace me rank gap valueText />`: the strip "You · rank 14 · +120 to pass the next" (or "You lead"/"Tied for the next place"/the plain rank when the gap is unknown), keeping `data-testid="ranking-own"`.
- Page: the list under the podium shows ranks 4 to 50 as today (`ranking-list`, `rankings-row`, `isMe` highlight) — when the board has fewer than 4 entries the list is hidden; the old standalone "your position" paragraph is replaced by `OwnPlace`, shown when the pilot is NOT in the visible podium+list OR always as the footer strip (decide: always show the strip, it is the pilot's anchor); i18n: new keys `rankings.you`, `rankings.rankValue`, `rankings.toPass` (plural-aware, e.g. "+{{amount}} to pass the next"), `rankings.toPassTime` ("-{{time}} to pass the next"), `rankings.leading`, `rankings.tied`; remove `rankings.yourPosition` only if nothing else uses it.

- [ ] **Step 1: Failing tests:** the podium renders three columns for 3+ entries in the order 2-1-3 with names, values and place numbers; 2 entries -> two columns (1 and 2), 1 entry -> one, 0 -> nothing; each name links to `/pilots/<publicId>`; `isMe` gets the highlight class; the page shows the podium and the list from rank 4, hides the list under 4 entries; OwnPlace texts for first/behind/tied/unknown/noResult (en and pt-BR keys exist); the race-time board phrases the gap as time; existing rankings specs (`rankings.spec.tsx`) updated where the markup changed (keep `ranking-list` and `ranking-own`).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `rankings.spec`, `podium.spec`, i18n specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): the rankings as a podium with the pilot's own place`.

---

### Task 3: icon tabs for the boards and a segmented period toggle

**Files:** modify `rankings.page.tsx` (+ spec), `styles/rankings.css`, locales.

**Interfaces:** consumes the kit `IconTabs` (read its props/spec) and one small icon per board (distance, fights won, race wins, race time, ship power, ship speed): inline glyphs in the style of `features/board/mission-kinds.tsx`, a `BOARD_ICON` map with a fallback; the period toggle (weekly / lifetime) becomes a two-button segmented control (kit style: `aria-pressed`, one pill); the route select for race time stays a select.

- [ ] **Step 1: Failing tests:** each board is a tab with an accessible name (`rankings.board.<name>`) and an icon (aria-hidden); selecting a tab changes the query (`['ranking', board, ...]`); the segmented period toggle sets `weekly`/`lifetime`, is hidden for ship boards (as today); the tablist keeps `role="tablist"`/`tab` + `aria-selected` semantics the old buttons had (specs/e2e rely on `role: tab`).
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** Grep `apps/web/e2e` for rankings selectors and update changed literals. **Step 4: Run:** PASS.
- [ ] **Step 5: Commit** `feat(ui): icon tabs for the ranking boards and a segmented period toggle`.

---

### Task 4: the pilot card as an ID card

**Files:** create `pilot-numbers.ts` (+ spec), `pilot-avatar.tsx` (+ spec); modify `pilot-card.tsx` (+ spec), `styles/profile.css`, locales.

**Interfaces:**
- Produces `pilotNumbersOf(profile: PublicProfileResponse): { missions: number; successPct: number | null; distance: number; fightsWon: number; raceWins: number; bestRacePlace: number | null; hasFlown: boolean }` from `totals` (`missions.started`, `flight.distance`, `fights.won`, `races.won`), `successRate` and `records['best.race_place']`; `<PilotAvatar name factionId size />`: a round tile with the initial in a ring of the faction colour (neutral fallback), `aria-hidden`.
- Card layout: header (avatar + name + faction badge); the ship panel (ship title, type with modifier, bridge rarity, the `ShipRadar` at size 120 beside it; none when `ship` is null); four big-number tiles (missions, success %, distance, race wins) using the number formats of today (`Intl.NumberFormat`), with the fight and race details in a second smaller line (fights won, races entered/won/podium, best race place) kept from today's card; a clean empty state when the pilot has not flown (`profile.stats.noFlights`) and NO grid of zeros; a reserved row for future medals/rank that renders nothing.

- [ ] **Step 1: Failing tests:** `pilotNumbersOf` for a flown pilot, a never-flown pilot (hasFlown false), null successRate -> successPct null, missing totals -> 0; the card shows the avatar initial, name, faction, ship title/type/radar, the four tiles with values, the detail line; a pilot without a ship shows no ship panel and no radar; a never-flown pilot shows only the empty state (no tiles); long name does not break (class for truncation); pt-BR labels exist; existing pilot-card specs updated for markup changes.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `pilot-card.spec`, `profile.spec`, `public-profile` specs, i18n specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): the pilot card as an ID card (avatar, ship and radar, big numbers)`.

---

### Task 5: the pilot's own profile page shows their card

**Files:** modify `features/profile/profile.page.tsx` (+ `profile.spec.tsx`), `styles/profile.css`, locales.

**Behaviour:** on `/profile` (the pilot's own page) show the same `PilotCard` at the top: fetch `GET /v1/players/profile/<publicId>` with `user.publicId` from `useAuthContext` (only when `publicId` is defined; the card needs `PublicProfileResponse`), then the wallet line and the existing stats tabs (`MyStats`) and history below as today; when `publicId` is missing or the card query fails the page renders exactly as today (no error banner for the card); the stats tabs keep working. The page title line keeps the wallet (`data-testid="wallet"`).

- [ ] **Step 1: Failing tests:** with `user.publicId` the page fetches and shows the card (name, ship, tiles); without `publicId` no request and no card; a failing card request leaves the rest of the page intact; the wallet testid and the history list still render.
- [ ] **Step 2: Run:** FAIL. **Step 3: Implement.** **Step 4: Run** `profile.spec`, `my-stats.spec`, i18n specs: PASS.
- [ ] **Step 5: Commit** `feat(ui): the profile page opens with the pilot's own card`.

---

### Task 6: status

- [ ] **Step 1:** the whole web unit suite once, lint + prettier on files changed since `a29c6fea` that this slice touched, `tsc --noEmit` for apps/web, the web build.
- [ ] **Step 2:** grep `apps/web/e2e` for literals/selectors this slice changed (rankings tab names, `rankings-row`, `ranking-own`, profile stats labels) and update the literals; list the e2e specs that depend on them.
- [ ] **Step 3:** update the slice 1.6 status line in `docs/TODO_v0.1.5.md` item 4 (built and unit-tested, NOT browser-checked; rank/XP and medals NOT built: they need game design).
- [ ] **Step 4: Commit** `docs: slice 1.6 built (status; owner reviews in the browser later)`.

---

## Self-review

- Coverage (phase 6): pilot card (T4, T5), podium (T1, T2), board tabs (T3). The mockup's rank bar and medals are explicitly out (no system).
- Names across tasks: `podiumOf`/`gapToNext` (T1) feed T2; `pilotNumbersOf`/`PilotAvatar` (T4) feed T4/T5.
- Not in this slice: server changes (a "gap to next" for pilots outside the top 50 needs an API field), pilot portraits (uploads), rank/XP, medals.
- Defaults chosen (change by saying so): avatar = the pilot's initial in a faction-colour ring; the "You" strip is always shown; the gap is shown only when the pilot ahead is in the top 50.
