# Step 3 & Step 4 Review — Changes and Fix Recommendations

**Date:** 2026-09-23
**Scope:** Step 3 "Config and Seed" (merged to `develop` at `3f19478`) and Step 4 "Parts and Ships" (branch `step-4-parts-ships` at `6a2aa6d`, not yet merged).
**Why this review happened:** both steps were implemented by a process that did not use this project's per-task review discipline (no ledger entries, no task-scoped reviews, no fix rounds). Before proceeding to Step 5 — the balance-critical resolution engine — both steps were independently reviewed from scratch: ground-truth test runs plus a full reviewer pass per step, treating the code as never-reviewed rather than double-checking prior verification.

**Bottom line:** both steps need fixes before Step 5 starts. Step 3's is the more serious one — the entire admin browser UI, which exists specifically because you rejected tuning the game through code edits, does not currently work in a real browser. Step 4's is more insidious — nothing is visibly broken, but three of its bugs would silently corrupt the balance numbers Step 5 is built to validate.

---

## Ground truth (verified directly, both steps)

Run from repo root with `source .superpowers/sdd/2026-09-21-rust-and-spark-v0.1-implementation/env.sh` (Node 22 / pnpm 9), on branch `step-4-parts-ships` (which includes all of Step 3):

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | clean |
| `pnpm typecheck` (api + web) | clean |
| `pnpm --filter api test:unit` | 322/322, 52 suites |
| `pnpm --filter api test:int` (real Postgres/Redis) | 138 passed, 2 skipped (opt-in Docker-lifecycle suite) / 140 — see note below |
| `pnpm --filter api test:e2e` | 3/3 |
| `pnpm --filter api test:validation` | 10/10 |
| `pnpm --filter web test` | 24/24, 16 files |
| `pnpm --filter web build` | succeeds; admin UI correctly split into its own lazy-loaded chunk |
| `prisma migrate diff` (drift gate) | No difference detected |
| `pnpm lint` (repo-wide) | **fails, 15 errors** — see Step 3 finding I2 |

**Note on the integration suite:** the Step 3 reviewer ran into leftover, deadlocked `jest --runInBand` integration processes on this machine from earlier verification runs, contending with each other for the same test database. This has since been cleaned up (stray processes killed, containers cleared) and is an environment artifact, not a code defect — my own 138+2/140 result, run separately, stands.

**The central lesson from both reviews:** a fully green test suite here means the authors' own tests pass — it does not mean the tests assert the right things, or that formulas or contracts match spec. Several of the findings below have passing tests that cannot fail even when the underlying behavior is wrong, because the test checks the wrong thing, mocks the same wrong assumption back to itself, or was weakened to match a wrong implementation.

---

## Step 3 — Config and Seed

**Range:** `e9c008e..c45340b` (merged into `develop` as `3f19478`)
**What this step was supposed to deliver:** after you explicitly rejected tuning the game by editing code, this step was pulled forward (originally planned much later) specifically to let every game number and item be edited live, in a browser, by an admin, with no deploy and no restart.

**Overall verdict: With fixes.** The backend half of this is strong. The frontend half doesn't work yet.

### Strengths (confirmed independently, not just claimed)

- **The "database always wins, changes apply immediately" promise is real, not just structural.** The reviewer set up two separate instances of the config service on two separate Redis connections, changed a value through instance A, and watched instance B pick up the change on its own within 2 seconds — with no restart. This is exactly the guarantee you asked for, and it's proven, not assumed.
- **Re-seeding the database genuinely never overwrites an admin's tuned values.** Verified by a real test: seed, manually change a setting and an item's name directly in the database (simulating what an admin edit would do), re-seed, confirm both changes survived untouched.
- **Only the command-line tool can create an admin account** — there is no way to do it through the API, verified by actually running the real CLI tool and confirming a regular player account still gets rejected from admin routes.
- **No game logic leaked into the browser.** The reviewer scanned every line of the new frontend code for game-math and found none — the browser only renders what the server tells it and sends back edits; the server is the sole authority, exactly as required.
- **The bilingual (English/Portuguese) requirement is real content, not placeholder scaffolding** — 82 of 87 translated phrases are genuinely different between the two languages, not just copied.
- **The seeded game world (12 locations, routes, factions, environments) matches every specific number and rule from the design document**, verified in detail.

### Critical — must fix before this step is done

**C1. The entire admin browser interface was built against a made-up version of the API, and cannot actually be used.**

The frontend code assumes the server sends back things it doesn't. Concretely: when a player logs in, the server never tells the browser whether that person is an admin — but the "is this an admin?" check the frontend uses to decide whether to show the admin section relies on exactly that missing piece of information. The practical result: **an admin logging into the browser right now would be redirected away every time, and the admin tuning screens can never be opened.** On top of that: creating a new account through the browser sends different information than the server expects, so registration currently fails; and a display of "when was this change made" shows "Invalid Date" because the frontend and the server disagree on what that field is called.

Every one of the 24 frontend tests passes despite this, because the fake "pretend server" used in those tests was built from the same incorrect assumptions as the real frontend code — so the tests and the code agree with each other while both disagree with reality. This is why the tests couldn't catch it, and it's a pattern worth watching for elsewhere: a test that fakes the server can only be as accurate as whoever built the fake.

**In short: the specific thing this step exists to deliver — tuning the game live from a browser — does not currently work outside of direct API calls.** The backend side of it is solid (see Strengths above); only the connection between the browser and the backend is broken.

**Fix:** align the frontend's assumptions with what the server actually sends (a handful of field-name and shape corrections), and — more importantly — stop hand-writing that connection layer by hand in a way that can silently drift from reality. Generate it directly from the real API's contract instead, and add at least one real test that logs in and opens the admin screen for real (no pretend server) so this class of bug gets caught automatically going forward.

### Important — fix before calling this step done

**I2. Building the frontend leaves behind broken files that make the project's own code-quality check fail.** Running the frontend's build command doesn't just produce the final app — it also litters extra generated files throughout the source folder, and the project isn't set up to ignore them. Right now, doing a normal build immediately breaks the code-quality check for everyone until those files are manually cleaned up. Cheap to fix, but currently reproducible on this exact codebase.

**I3. If the live-update connection (Redis) has a hiccup, an admin's changes can silently stop reaching the game — with no recovery, and in the worst case, the whole server crashes.** The plan called for a backup mechanism (checking for missed changes periodically) in addition to the live-update signal, so a dropped signal would self-correct within a short window. Only the live-update signal was built; the backup check was not. Separately, a broken piece of configuration hitting this exact refresh path can crash the entire process instead of just failing that one update.

**I4. Several of the safety rules this step's design explicitly called for don't actually hold.** Specifically: (a) you can point new-player onboarding at a starter item or starting location that doesn't exist or has been disabled, and nothing stops you; (b) a location can never be retired/disabled at all — the code path meant to allow it has a bug that makes it unreachable; (c) the rule that protects "this item is required for new players, don't let anyone deactivate it" only checks one of the two ways an admin could deactivate something — the other way bypasses the protection completely.

**I5 / I6. Two smaller but real gaps in the admin tuning system:** renaming an item's internal identifier through the tuning screen is allowed, but doing so silently breaks every other place that item is referenced, and makes that change impossible to undo later. Separately, "undo this change" doesn't fully re-check that the restored value is still valid, and undoing certain changes to routes crashes with an unhandled error.

**I7. There's no automatic check confirming that every admin-only feature actually requires admin access.** Right now that protection is added by hand to each screen individually rather than being guaranteed by the system, so if a future admin feature is built and someone forgets to add the protection, nothing would catch it — it would just be quietly reachable by any logged-in player.

**I8. The root cause of the Critical finding (C1) is that the connection between frontend and backend is hand-maintained rather than generated from the real API** — which is exactly the setup that let the two drift apart unnoticed.

### Lower priority (worth fixing, not blocking)

- Some of the seeded Portuguese text is actually still in English in one spot, invisible because the check only confirms "something was translated," not "the right thing was translated."
- There's no language switcher yet, and the login/registration screens are English-only even for a Portuguese-speaking admin.
- The safety check that guards against typos in game numbers (the "no unexplained magic numbers" rule) currently has nothing to check, since the code areas it's meant to guard don't exist yet — this is expected at this stage, just noting it isn't actually protecting anything yet.
- A few small pieces of dead/unused code and one database index that would help a frequently-run admin query.

---

## Step 4 — Parts and Ships

**Range:** `3f19478..6a2aa6d` (branch `step-4-parts-ships`, not yet merged to `develop`)
**Why this step matters most for what comes next:** it computes ship mobility, viability, and progression tier — the exact inputs Step 5's resolution engine will validate against the game's official balance reference. An error here doesn't fail loudly; it silently makes Step 5's balance validation measure the wrong thing.

**Overall verdict: With fixes.** Gate on the Critical finding and four of the eleven Important findings before starting Step 5; the rest can be fixed during Step 5 without blocking its start.

### Strengths (confirmed independently, not just claimed)

- **The connection to Step 2's security system was done exactly right.** When a ship is created, it correctly registers itself with the ownership-checking system built two steps ago, with zero changes needed to that older code — this is precisely the kind of cross-step integration that's easy to forget, and it wasn't forgotten.
- **Nothing here relies on randomness or the current time**, which is required for the game's "replay the exact same result" guarantee.
- **The core math was hand-checked against the design document and is correct**: ship speed, the rounding rules, the "part starts failing more often as it wears out" curve, and 4 of the 7 required "can this ship actually fly" checks all match exactly.
- **No shortcuts around the server-is-the-authority rule:** ship stats are always recalculated by the server, never trusted from what a player's device sends; a "preview this build" feature genuinely doesn't save anything, as it should.

### Critical — fix before Step 5

**C1. A recent balance change to the starting ship part has no path to reach any database that was already set up before the change**, and as a result, **every new player on such a database currently cannot build a working ship at all.**

The core piece that decides how much a ship can carry (its structural budget) comes entirely from one number on the "bridge" part. That number was changed as part of this step's work — but the seeding system is intentionally built to *never* overwrite a value that already exists in the database (that's a deliberate, correct safety rule protecting admin-tuned values). The unintended side effect: any database that was already running before this change keeps the *old, wrong* number forever, which means the structural budget becomes zero, and literally no ship design can fit within it. New players joining such an environment cannot get past account setup.

**Fix:** this specific value needs an actual one-time correction applied to existing databases (not a re-seed, which won't touch it), plus a decision on when exactly that kind of "the old number was just wrong" fix is allowed to override the normal "never touch existing values" rule.

### Important — fix before Step 5

**I1. Fewer than the required checks for "is this ship actually flightworthy" are implemented**, and one of the missing ones is left in the code in a way that looks like it works but doesn't — the game has a check for "does this ship have life support," and the code has a labeled slot for reporting that failure, but no actual check behind it. Two more required checks (battery capacity for combat spikes, and a specific rule for a certain type of engine) are also missing. Because of this, one entire category of ship design trade-off described in the game's design document currently has no effect in the model.

**I2. Ships can end up being saved in a state that was never actually verified as flightworthy.** When the "automatically arrange my parts" feature can't fit every requested part, it just quietly leaves some out instead of reporting a problem — but the flightworthy check runs on the original full list, not the smaller list that actually got saved. So a ship can be saved and reported as "good to fly" when the real, saved version is different from what was checked.

**I3. Two settings that admins are supposed to be able to adjust live currently do nothing when changed.** One is a wear-related setting that's supposed to control how quickly parts degrade — changing it has zero effect because the code computes it from a different setting instead of using the one an admin would actually change. Another setting (how much extra weight fuel adds to a ship) is stored and readable but never actually used in any calculation. Both of these feed directly into numbers Step 5 will be checking.

**I4. The database currently only allows one ship per player, ever** — which directly contradicts an explicit project rule that the system should support multiple ships even though players only see one today (this matters for planned future features, like a temporary backup ship while your main one is being repaired). The rest of the code was correctly written to support multiple ships; only this one database restriction wasn't.

**I5. This is the one that needs your decision, not a code fix.** The calculation for a ship's "tier" (used to scale how much missions pay out and how tough enemies are, starting in Step 5) currently puts *every single ship design described in the game's own design document* — including the fully-upgraded, late-game ones — into the lowest tier. The thresholds for leveling up a tier and the way a ship's value is measured don't line up with each other. As it stands, Step 5 would be building a reward and difficulty curve that never actually changes no matter how much a player progresses, which defeats the purpose of having tiers at all. This needs your call: is the way we're measuring "how much is this ship worth" wrong, or are the tier thresholds wrong?

**I6. A specific design intent — that a "does everything" ship should be the slowest, least mobile option — is currently backwards.** In the actual numbers, that type of ship is the *fastest* one tested, not the slowest.

### Lower priority (worth fixing, won't block Step 5 from starting)

- The "let the system auto-arrange my ship" feature quietly drops parts a player doesn't actually own instead of rejecting the request outright (manually assembling a ship already does this correctly).
- The order parts are loaded in from the database isn't guaranteed to stay the same between runs, so an identical ship's saved layout (the visual arrangement, not its stats) could shuffle slightly between saves.
- A "what type of ship is this" classification feature (cargo hauler, warship, etc.) was built and tested, but nothing actually shows it to a player anywhere.
- Nothing checks that a new player's starting kit still references real, active items — a bad admin edit elsewhere could quietly break new-player setup for everyone with no warning.
- Setting up a new player isn't one atomic step and isn't protected against accidentally running twice — a network hiccup during setup could leave a new player with a ship but no starting money, with no way to recover.
- **A test file was committed that looks like it should be the official balance reference for Step 5, but it was actually generated from this implementation, not from the game's official reference calculator.** If reused as-is, Step 5's balance validation would just be checking this code against itself instead of against the real target — flagging this clearly so it doesn't get used by mistake.

---

## Suggested order of work

1. **Fix Step 3's C1** — the admin browser UI needs to actually work before it's fair to call Step 3 done, since that was the entire point of pulling this step forward.
2. **Fix Step 4's C1** — this is a live-breaking bug for anyone testing against a database that already existed before this change.
3. **Get your decision on Step 4's I5** (ship tier) before Step 5 starts — this is the one architectural question in either step, not a bug to just fix.
4. Fix Step 4's I1, I2, I3 — all three feed directly into numbers Step 5 will be checking against the official balance reference.
5. Fix Step 3's I4 (the missing safety rules) alongside the C1 fix, since they're in the same area of code.
6. Everything else in both steps (I2/I3/I7/I8 in Step 3, I4/I6 and the lower-priority items in Step 4) can be handled alongside Step 5's own work without blocking its start.
