# The first flight: refuel, then a test pad a few seconds away (built, 2026-10-19)

Owner idea (2026-10-18): the first mission is two parts. 1) Refuel the ship. 2) A quick test flight, seconds
long. The tutorial ends there, and the pilot is free to take their "real first mission" (the private start-safe
mission, unchanged). Owner decisions on 2026-10-19: refuelling is a **tutorial step**, the test flight is a very
close place built for it (a **test pad** next to each home port), and **existing pilots and ships are ignored**
(only the owner's accounts exist, and the database is reset again soon).

## What was built
- **A new ship starts with a low tank**: `onboarding.start_fuel_fraction` (default 0.25), Admin-tunable. It is
  enough for the first flight; the tutorial's first action step is to fill it (the Port's Refuel tab, reached
  with a link; the tick reads the pilot's own refuel record, `GET /v1/players/me/tutorial-progress`).
- **A test pad next to each home port** (`ceres_pad`, `hedus_pad`, `cair_pad`; type `test_pad`, local detail on
  the map, repair and refuel only, no market): 30 units away on a safe route, so there and back takes seconds.
  A pad is never the destination of an ordinary mission.
- **The very first mission goes to the pad**: the private start-safe offer (D43) is generated with
  `firstMission` while the pilot has completed nothing; its destination is the nearest pad. Later offers are the
  usual start-safe missions ("the real first mission"). A pad has a board offer back home (`pad_return_*`).
- **No 5-minute floor on such a trip**: `missions.short_trip_exempt_below` (default 60 distance) exempts trips
  that short from the short-trip minimum; every other short trip still takes at least 5 minutes.
- **Tutorial order**: build, check the connections, fill the tank, take a mission, dispatch, read the report,
  repair, other work (scavenge or mine). Repair and other work can only tick when the pilot does them, which in
  practice is after the first real mission (the pad has almost no wear and no work tabs).

## Not done / kept as is
- Existing pilots: no migration (the owner's accounts only; the database will be reset).
- The old idea of a separate `TEST_FLIGHT` mission type and a fixed 30-second duration was replaced by the pad:
  the duration is simply the distance.
