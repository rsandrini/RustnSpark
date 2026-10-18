# The first flight: refuel, then a 30-second test flight (plan, not built)

Owner idea (2026-10-18): the first mission could be two parts. 1) Refuel the ship. 2) A quick test flight,
about 30 seconds. The tutorial ends there, and the pilot is free to take their "real first mission", which is
what the game already offers today (the private start-safe mission).

## 1. What exists today (facts)

- A new pilot starts with a **full tank** (`onboarding`), a loose starter kit, 750 credits, and the tutorial
  checklist: build, check the connections, take a mission, dispatch, read the report, repair, other work.
- The private start-safe mission (D43) is a DELIVERY to the nearest trading place, created on the home board
  when nothing takeable is there. It is the pilot's first real trip; its duration follows distance / mobility.
- Trips under `missions.short_trip_below` (400 distance) take at least `short_trip_min_seconds` (300 s): a
  30-second flight cannot come from a normal mission any more.
- The tutorial ticks from game state (ship, active mission, reports) and from what the pilot did
  (`repaired`, `worked`, saved in the browser); finishing or skipping is saved on the server (`tutorialDone`).

## 2. The proposal

### The flow
1. **Build** (as today) and **check the connections** (as today).
2. **Refuel.** The ship starts with a low tank, enough for the test flight but not for a real trip (about a
   quarter). The checklist step asks the pilot to open the Port's Refuel tab and fill the tank (the "refuel
   first" link already goes there). Ticks when a refuel is paid (`worked`-style flag, `refuelled`).
3. **Test flight.** A private mission, `Test flight`, is on the home board from day one: a short round hop
   inside the home port's own system, safe zone, no fight, tiny reward, **about 30 seconds**. Accept, dispatch,
   read the report: those three steps tick as today.
4. The checklist **finishes**. The pilot is told the real first mission is on the board (the D43 mission,
   unchanged) and the tutorial card is gone for good (`tutorialDone`).

Repair and "other work" stop being tutorial steps (they stay in the Guide and in the market tip); the
checklist becomes: build, connections, refuel, take the test flight, dispatch, read the report.

### What changes in the game
- `onboarding.start_fuel_fraction` (new, default 0.25): the starting tank. (Today: full.)
- A `TEST_FLIGHT` mission template, private to the new pilot, created at onboarding next to the D43 logic
  (`ensureStarterOffer`), with a fixed duration `missions.test_flight_seconds` (default 30), exempt from the
  5-minute short-trip floor. It is offered once; after it is reported it never comes back.
- The D43 start-safe mission stays as is, and is offered **after** the test flight is reported (so the
  board's first public offer is not the long one while the pilot is still learning).
- Tutorial steps and texts (en + pt-BR), and the guide's "Getting started" topic.

## 3. Decisions (recommendation first)

1. **Low starting tank.** Recommended: 25% so the Refuel step is real. This reverses the earlier "a full tank
   at the start" rule; the test flight burns very little, so a pilot who skips refuelling still flies it.
2. **Is the test flight a mission type or a flag on DELIVERY?** Recommended: a DELIVERY template flagged
   `testFlight` (no new type, so the board, report, resolver and economy tests are untouched), with the
   duration override read where `missionDuration` is called.
3. **Reward.** Recommended: a small fixed sum (about the price of the fuel for it) so it is never a money
   source; the real money starts with the real first mission.
4. **Existing pilots** (the tutorial is already done or in progress for them): unchanged; the new flow only
   applies to accounts created after the change.
5. **The pilot who skips the tutorial** still gets the test flight on the board (it is just an offer) and the
   real first mission after it.

## 4. Work, in order

1. API: `start_fuel_fraction` and `test_flight_seconds` (config, schema, registry, defaults, migration),
   onboarding fuel, the test-flight template and offer, the duration override, "offer the D43 mission after
   the test flight is reported". Unit and integration tests; the starter-mission specs gain the new order.
2. Web: the new checklist steps (`refuelled`), texts, the Port Refuel tick, the Guide topic.
3. e2e: the smoke spec flies the test flight first (about 30 s), then the real mission.
4. Docs: GDD note, this plan marked built.

## 5. Not in this plan

A second tutorial flight, combat in the test flight, and a changed economy for the real first mission.
