# To do - v0.1.4

Owner's list for v0.1.4 (planned later, 2026-11-09). Delete an item when it ships.

## 1. Missions follow the ship's own specialty (transport, escort, delivery, race)

- [ ] The mining rework (v0.1.3 item 8) sets the pattern: a mission's time and difficulty come from the ship's stat that matters for it,
  so a prepared ship does the job faster and a weak one slower, or not at all. Owner will plan each type later. First guesses:
  transport from cargo (a load above the hold needs several trips), escort from firepower and defense, delivery and race from
  mobility (already so). Needs the sim before any change.

## 2. An accepted mission's card does not refresh when the ship's parts change (owner, 2026-11-10)

- Found by the owner: accepted a RACE mission, then added a new engine and a new tank. The ship's mobility dropped below the race's
  requirement, but the accepted mission's card did not reflect it (it kept saying the pilot qualifies).
- To do: after a mission is accepted (and before it is dispatched), every change to the ship (parts fitted or removed, engine tuning,
  fuel) must refresh the card's requirements, eligibility, time and fuel estimate, the same way the dispatch will judge them. If the ship
  no longer qualifies the card must say so, and Dispatch must be blocked with the reason.
- Check the same for the other types with requirements (cargo space for deliveries, life support for passengers, mining rigs).
