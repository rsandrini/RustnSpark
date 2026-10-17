# Visual regression harness (local only)

Pixel-compares every screen of the game against a baseline, so a CSS refactor can be proven to change nothing.
It is **not** part of CI: it needs the dev stack (`docker compose up`, web on :8080) and an admin account, and a
stable player created once by `setup.mjs`.

1. `E2E_*`-style admin: `admin@e2e.test` / `e2e-admin-password-1` (created with the admin CLI, see
   `docs/` / the browser smoke recipe).
2. `node visual/setup.mjs`: creates the `visual@e2e.test` player with an assembled ship and one finished mission.
3. `npx playwright test -c visual/playwright.config.mjs --update-snapshots` takes the baseline into `visual/__shots__`.
4. After a change: `visual/check.sh` rebuilds the web container and compares.
5. `node visual/cleanup.mjs` cancels a mission left accepted by an interrupted run.

Dynamic areas (offer lists, countdowns, ship animation, charts) are masked or their text hidden; the mission-card
states are soft checks because the board content changes between runs. Needs `LD_LIBRARY_PATH` set as in the
browser-smoke recipe on this machine.
