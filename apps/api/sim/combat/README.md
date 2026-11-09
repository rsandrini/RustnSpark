# Fight lab

Ships built from the real part catalog (a ladder from the starter ship to a maximum-power fighter), pirates (today's
generator, built from the player, and a fixed ladder by region), the real combat resolver, energy included.

```
npx tsx sim/combat/run.ts --fights 400 --pirates fixed            # the fixed ladder
npx tsx sim/combat/run.ts --pirates today --only F4               # today's pirates against one ship
npx tsx sim/combat/run.ts --pirates today --regen 0.3             # test a rule change (dials)
```

Dials (multipliers on today's parts): `--weapon` firepower, `--shield` shield capacity, `--regen` shield recovery per
round, `--energy` combat energy that shields and lasers draw, `--supply` reactor and battery output.

Needs `sim-data/snapshot.json` (`pnpm sim export`) for the rules and the catalog. Edit the ships in `ladder.ts`.
