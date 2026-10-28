# Global ranking (design)

Status: approved by the owner in conversation, 2026-10-28. Second online feature after profile stats
(`2026-10-27-profile-stats-design.md`), which supplies the numbers.

## Why

Pilots have no way to compare themselves with each other. The per-pilot numbers now exist (lifetime and per UTC day), so a
ranking is a read over them.

## Goals

- Four boards, each with a **Weekly** and a **Lifetime** tab, computed live (no reward, so nothing is frozen):
  1. **Distance flown** (`flight.distance`).
  2. **Fights won** (`fights.won`).
  3. **Race wins** (`races.won`).
  4. **Fastest race time, per route** (a route is the race mission's origin and destination pair).
- Each board shows the **top 50** (rank, pilot name, faction, value) and a pinned row with **the pilot's own position**
  ("you are 312th"); a pilot with no result sees "no result yet". A row opens that pilot's public card.

## Non-goals

- No reward, title or history for weekly winners (a later feature; the week result would have to be frozen then).
- No ranking by ship power or speed (not recorded), none by money, damage or success rate (owner's choice of four).
- No friends or faction boards, no pagination beyond 50.

## Decisions

- **Week:** Monday 00:00 Brazil time (UTC-3, 03:00 UTC) to the next Monday; the day columns are game days in the same time. Weekly counter boards sum the `PlayerStatsDaily` rows from that day.
- **Counter boards** read `PlayerStats.totals` (lifetime) or sum `PlayerStatsDaily.totals` (weekly). Pilots with a zero value
  are not listed. Banned accounts are not listed.
- **Race times need their own rows:** a `RaceResult` row per finished race (pilot, mission, route key, seconds, place, UTC
  day). Lifetime best = the pilot's minimum on the route; weekly best = the minimum since Monday. One entry per pilot per
  route. Route key is `<originId>><destinationId>`.
- **Ties:** equal values rank by the earlier-joined pilot, then by name (deterministic; "who got there first" would need a
  history we do not keep). Ranks are positions (1, 2, 3...), not shared.
- **Race route picker** lists only routes with at least one result.
- **Access:** signed-in pilots only. Names are public already (profile card is always public).
- **Cost:** one SQL per request (window function over the whole board) with a `LIMIT`; fine at this scale. If a board
  grows heavy, cache it for a minute or index a hot stat; not now.

## API

- `GET /v1/rankings/race-routes` -> `{ routes: [{ routeKey, originId, destinationId, pilots }] }`.
- `GET /v1/rankings/:board?window=weekly|lifetime&route=<routeKey>` with `board` in `distance | fights_won | race_wins |
  race_time`. `window` defaults to `lifetime`; `route` is required for `race_time`.
  Response `{ board, window, route, weekStart, entries: [{ rank, name, factionId, value, isMe }], me: { rank, value } | null,
  total }`. `me` is the pilot's own position whether or not they are in the top 50.
- Errors: `INVALID_BOARD`, `INVALID_WINDOW`, `ROUTE_REQUIRED` (400), translated en + pt-BR.

## Web

A Rankings page (`/rankings`, linked from the account menu next to Profile): a board selector, a Weekly / Lifetime toggle, a
route picker for the race-time board (location names, not ids), the list and the pinned own row. Bilingual, 320 px safe,
controls at least 40 px tall.

## Tests

Unit (week start, board config), integration (each board weekly and lifetime, tie order, banned hidden, zero hidden, own
row beyond the top 50, race route picker, validation errors, contract schema parse), web (page, empty state, own row), one
smoke spec.

## Addendum (owner, 2026-10-28): ship power and speed, Brazil-time week

- Two more boards, **Ship power** (engine thrust, `sheet.pot`) and **Ship speed** (mobility, shown with the display scale).
  They rank a `ShipRating` snapshot per pilot (also stores firepower and armor for later), lifetime only: no weekly window.
- The snapshot is loaded by `ship-rating.cli` for now; a scheduled job replaces the manual run later. Old data is ignored.
- The week and the daily stats follow Brazil time (UTC-3): a week starts Monday 00:00 there (03:00 UTC).
- The pilot card does not show rankings; only the rankings page does.
