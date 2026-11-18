# Landing Page Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the sign-in page (`/login`, `/register`) so it shows the game: two real screens with callouts, the five ship classes and the eight mission types, and no mention of factions or "powers".

**Architecture:** Keep the page's hero and sign-in panel. Replace the story below it (`LandingStory`) with four blocks: Build (annotated ship-builder screen), Specialise (ship classes), Race (annotated race screen), Choose (mission types), then the three "everything costs" cards and the call to action. All copy is i18n (en + pt-BR). The data that never changes (which classes, which missions, where the callout pins sit) lives in one small module, so components stay plain markup.

**Tech Stack:** React 18, react-i18next, Vitest + Testing Library + msw, Playwright e2e, plain CSS in `apps/web/src/styles`.

**Spec:** the owner-approved mock-up `docs/design/landing-option-b.html` (open it in a browser once the images are in place). The decisions below were made in the design chat on 2026-11-17.

## Decisions (closed with the owner, 2026-11-17)

1. The four-step "How a run goes" section is dropped (Build and Race tell that story).
2. Scavenge and Travel stay on the page, labelled "You start it", with the same card border as the rest.
3. The race callout keeps the numbers as in the mock-up ("The trip needs 378 and you carry 900"). Revisit if the game's numbers change.
4. The public landing endpoint is left alone for now (it still returns factions the page ignores).
5. Images are converted to WebP and live in `apps/web/public/landing/`.
6. The two images are static repo assets; the temporary `img_site/` folder is removed.

## Global Constraints

- **Branch:** work on `develop`, one commit per task. Never commit on `release/*` or `main` (CLAUDE.md).
- **Language policy:** code in English; every player-facing string in `en.json` and `pt-BR.json`, none hard-coded in JSX (lint rule `react/jsx-no-literals`). `src/i18n/keys.spec.ts` must stay green (both files carry the same keys).
- **Removed, for good:** the "Four powers, one sector" section, the "N powers" fact, and any faction list or faction banner on this page. Free pilots are not mentioned. The page renders no faction data.
- **Images are static assets in the repo**, already converted to WebP (quality 90) and moved into place: `apps/web/public/landing/ship-builder.webp` (1280x719, 78 KB) and `apps/web/public/landing/race.webp` (1280x1026, 68 KB). The owner's temporary `img_site/` folder has been removed; nothing else reads it.
- **No new numbers typed into copy** that can drift: counts of classes and missions come from the arrays in `landing-content.ts`; parts and places counts still come from `/v1/public/landing`.
- **Cards:** all eight mission cards use the same border. "You start it" (Scavenge, Travel) is a label inside the card, not a different border.
- **Reduced motion and keyboard:** nothing new animates and nothing new is focusable. Pins are decorative (`aria-hidden`); the numbered legend carries the same information as text.
- Use `data-testid` only where an existing test pattern does; prefer roles and text.

## Review Focus

- The public data fails (HTTP 500) or is slow: the showcase, classes and missions still render; only the parts and places facts disappear.
- An image fails to load: width and height are set so the page does not jump, and the legend next to it still tells the whole story.
- Phone width (390 px): callout pins stay inside their image, no horizontal scroll, cards stack to one column.
- pt-BR copy is longer than English: card text wraps, nothing is clipped.
- Screen readers: pins are hidden, the legend is an ordered list, each image has an alt text that says what the screen is.
- Nothing on the page says "powers", "four", "free pilots" or names a faction (a test pins this).

## File Structure

- Create `apps/web/src/features/auth/landing-content.ts` — the constant data (classes, missions, pins).
- Create `apps/web/src/features/auth/landing-showcase.tsx` — `ShowcaseBlock`: an annotated screen plus its numbered legend.
- Create `apps/web/src/features/auth/landing-catalog.tsx` — `ShipClasses` and `MissionKinds`.
- Modify `apps/web/src/features/auth/landing.tsx` — `LandingStory` composes the blocks; drops the faction, steps and missions-feature sections.
- Modify `apps/web/src/features/auth/login.page.tsx` — hero facts and the new `LandingStory` call.
- Create `apps/web/src/styles/landing-showcase.css`; modify `apps/web/src/styles/auth.css` (remove faction and steps rules); import in `apps/web/src/main.tsx` next to `auth.css`.
- Modify `apps/web/src/i18n/en.json`, `apps/web/src/i18n/pt-BR.json` (the `landing` block).
- Modify `apps/web/src/features/auth/auth.spec.tsx`, `apps/web/src/test/msw/handlers.ts` only if the landing mock needs trimming.
- Added already: `apps/web/public/landing/ship-builder.webp`, `apps/web/public/landing/race.webp` (committed with this plan).

---

### Task 1: Content module, copy and images

**Files:**
- Create: `apps/web/src/features/auth/landing-content.ts`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/pt-BR.json` (`landing` block)
- Test: `apps/web/src/features/auth/landing-content.spec.ts`

**Interfaces:**
- Produces:
  - `export const SHIP_CLASSES = ['hauler', 'transport', 'warship', 'miner', 'multirole'] as const; export type ShipClass = (typeof SHIP_CLASSES)[number];`
  - `export const MISSION_KINDS: readonly { readonly id: MissionKind; readonly start: 'board' | 'own' }[]` with ids in this order: `delivery, transport, escort, mining, rescue, race` (all `'board'`), then `scavenge, travel` (both `'own'`); `export type MissionKind`.
  - `export interface Pin { readonly n: 1 | 2 | 3; readonly left: number; readonly top: number }` (percent of the image)
  - `export const SHOWCASE: Record<'build' | 'race', { readonly image: string; readonly width: number; readonly height: number; readonly pins: readonly Pin[] }>` with `build.image = '/landing/ship-builder.webp'`, 1280x719, pins `(1: 36, 46)`, `(2: 84, 17.5)`, `(3: 24, 95)`; `race.image = '/landing/race.webp'`, 1280x1026, pins `(1: 28, 28)`, `(2: 27, 54)`, `(3: 73, 48)`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** `landing-content.spec.ts`: five classes in the order above; eight missions, the first six `'board'`, the last two `'own'`; every pin of both showcases has `left` and `top` between 0 and 100 and `n` 1, 2, 3 once each.
- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/auth/landing-content.spec.ts` (from `apps/web`); expected FAIL, module missing.
- [ ] **Step 3: Implement** `landing-content.ts` with the exports above.
- [ ] **Step 4: Check the images are in place** (converted and committed when this plan was closed): `ls apps/web/public/landing` lists `race.webp` and `ship-builder.webp`.
- [ ] **Step 5: Write the copy.** In `en.json` `landing`: keep `kicker`, `title`, `authTabs`, `cta.*`; delete `how`, `factions`, `facts.factions*`, `more.missions`. Set `pitch` to "Assemble a ship from parts, pick the jobs it is built for, send it out on a real-time clock and read the run like a story. A shared world of pilots and a living economy." Add, with the same plural style the existing `facts` use (`key` / `key_other`):
  - `facts.shipClasses`: "{{count}} ship class" / "{{count}} ship classes"; `facts.missionKinds`: "{{count}} kind of mission" / "{{count}} kinds of mission".
  - `build`: `kicker` "1 · Build", `title` "Your ship is a puzzle of parts", `imageAlt` "The ship builder: a ship laid out on a grid of parts, with its sheet on the right", `points.grid.title` "Fit every part on the grid" / `.text` "Engines, tanks, shields, cannons, cargo holds and a mining rig, each with weight, power and a place.", `points.class.title` "The ship becomes a class" / `.text` "This one is a Miner. What you fit decides it, and it changes when you refit.", `points.stats.title` "Read it at a glance" / `.text` "Firepower, defense, cargo, mobility and range, live under the grid."
  - `classes`: `kicker` "2 · Specialise", `title` "Different ships, different jobs", `lede` "You do not pick a class from a menu. You build toward one, and the ship takes the shape of what you fitted.", and per class `{name, text}`: hauler "Mostly cargo holds. Built to carry loads."; transport "Pressurized cabins and life support, for passengers."; warship "Weapons and defense first."; miner "A mining rig on board, and room for the ore."; multirole "No single specialty. A bit of everything."
  - `race`: `kicker` "3 · Race", `title` "Pick a job. Beat the field.", `imageAlt` "A race mission: the field of rivals, the route on a map and the ship in flight", `points.field.title` "Know the field" / `.text` "Rivals, their speed and expected times, and a prize for the first places.", `points.fuel.title` "Check the fuel" / `.text` "The trip needs 378 and you carry 900. The card says so before you go.", `points.fly.title` "Watch it fly" / `.text` "The clock keeps running if you leave. Come back to the report."
  - `missions`: `kicker` "4 · Choose", `title` "A mission for every ship", `lede` "Each job tells you what it asks of your ship before you accept. If your ship does not qualify, it says why.", `needsLabel` "Needs", `ownLabel` "You start it", and per mission `{name, text, needs}`: delivery "Carry cargo from port to port." / "Cargo space for the load."; transport "Fly passengers where they are going." / "A Passenger Cabin plus a Life Support module."; escort "Keep a client's ship alive through dangerous space." / "At least one weapon and good mobility to keep up."; mining "Dig ore at a place, then sell it." / "A Mining Rig and cargo space for the ore."; rescue "Reach survivors and bring them home." / "A fast ship and room for the survivors."; race "Beat three to five rivals. The prize depends on where you finish." / "Speed at or above the race's entry minimum."; scavenge "Search the wreckage around a port for used parts and scrap." / "Any time, from the port."; travel "Take your ship somewhere on your own. It costs only fuel." / "Any time, no job needed."
  - `more`: `title` "Not a game you can just leave running", and three cards `economy` "A living economy" / "Upgrades need money plus scrap, crystals and rare cores from dangerous places. Ore you dig up is yours to sell.", `risk` "Everything costs" / "Pirates, wear and running dry. A tow costs credits and the mission. Spare parts and cargo compete for space.", `read` "Read every run" / "Each trip is told like a text RPG: fights, wear, loot and what it cost. Repair, upgrade and go again."
  - In `pt-BR.json` write the same keys in Brazilian Portuguese, in the voice of the rest of `landing.*` ("você"). The owner reviews the pt-BR text.
- [ ] **Step 6: Run** `npx vitest run src/features/auth/landing-content.spec.ts src/i18n` — PASS (content spec and the key-parity spec).
- [ ] **Step 7: Commit** — `git add apps/web/src/features/auth/landing-content.ts apps/web/src/features/auth/landing-content.spec.ts apps/web/src/i18n && git commit -m "feat(landing): content, copy and screens for the new sign-in page"`.

### Task 2: The annotated screens (Build and Race)

**Files:**
- Create: `apps/web/src/features/auth/landing-showcase.tsx`, `apps/web/src/styles/landing-showcase.css`
- Modify: `apps/web/src/main.tsx` (import the stylesheet after `./styles/auth.css`)
- Test: `apps/web/src/features/auth/landing-showcase.spec.tsx`

**Interfaces:**
- Consumes: `SHOWCASE` from Task 1; keys `landing.build.*` and `landing.race.*`.
- Produces: `export function ShowcaseBlock(props: { readonly id: 'build' | 'race'; readonly flip?: boolean }): JSX.Element` — a `<section>` with an `<h2>` (the block's `title`), the `kicker`, the image with its pins, and an `<ol>` legend of the three points.

- [ ] **Step 1: Write the failing test** (render with `renderWithProviders`): for `id="build"` there is a heading "Your ship is a puzzle of parts", an image with alt "The ship builder: a ship laid out on a grid of parts, with its sheet on the right" whose `src` is `/landing/ship-builder.webp` and has `width="1280"` and `height="719"`; the legend has three list items whose titles are "Fit every part on the grid", "The ship becomes a class", "Read it at a glance"; three pins exist and every pin has `aria-hidden="true"`. Same shape for `race` (`/landing/race.webp`, 1280x1026, titles "Know the field", "Check the fuel", "Watch it fly"). Add a test with the language switched to `pt-BR` that the heading text is not the English one.
- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/auth/landing-showcase.spec.tsx`; expected FAIL (module missing).
- [ ] **Step 3: Implement `ShowcaseBlock`.** Image `loading="lazy"` and `decoding="async"`, wrapped in a `position: relative` box; pins are `<span class="landing-pin" aria-hidden="true">` positioned with inline `left`/`top` percentages from `SHOWCASE`. The legend `<ol>` items show the number in a `<b aria-hidden>` and the text in a `<strong>` plus a `<span>`. `flip` swaps the two columns on wide screens only.
- [ ] **Step 4: Style it** in `landing-showcase.css` using the tokens already in `tokens.css` (`--paper-2`, `--rule-2`, `--brass`, `--brass-ink`, `--ink-2`): two-column grid `minmax(0, 1.25fr) minmax(0, 1fr)` above 820 px, one column below; pin 26 px, brass, with the same soft ring as the mock; image `max-width: 100%`, `height: auto`, rounded border. Match `docs/design/landing-option-b.html`.
- [ ] **Step 5: Run** the spec — PASS. Run `npx tsc --noEmit` and `npx eslint src/features/auth` — clean.
- [ ] **Step 6: Commit** — `git commit -m "feat(landing): annotated ship builder and race screens"`.

### Task 3: Ship classes and mission types

**Files:**
- Create: `apps/web/src/features/auth/landing-catalog.tsx`
- Modify: `apps/web/src/styles/landing-showcase.css`
- Test: `apps/web/src/features/auth/landing-catalog.spec.tsx`

**Interfaces:**
- Consumes: `SHIP_CLASSES`, `MISSION_KINDS`, `ShipClass`, `MissionKind` from Task 1; keys `landing.classes.*`, `landing.missions.*`.
- Produces: `export function ShipClasses(): JSX.Element` and `export function MissionKinds(): JSX.Element`, each a `<section>` with kicker, `<h2>`, lede and a `<ul>` of cards.

- [ ] **Step 1: Write the failing test**: `ShipClasses` renders a heading "Different ships, different jobs" and five list items whose names are Hauler, Transport, Warship, Miner, Multirole, each with its text. `MissionKinds` renders a heading "A mission for every ship" and eight list items in the order Delivery, Transport, Escort, Mining, Rescue, Race, Scavenge, Travel; the first six show the label "Needs" and the needs text (for example Mining shows "A Mining Rig and cargo space for the ore."); the last two show the label "You start it". Every one of the eight cards has the same class name (assert `new Set(classNames).size === 1`) so a differently styled card cannot slip in.
- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/features/auth/landing-catalog.spec.tsx`; expected FAIL.
- [ ] **Step 3: Implement both components** by mapping the constant arrays; a card is name (mono tag), text, then the "Needs" or "You start it" footer chosen by `start`.
- [ ] **Step 4: Style the cards** in `landing-showcase.css`: classes grid 5 columns above 1000 px, 3 up to 820 px, 1 column at 520 px; missions grid 4 / 2 / 1; one card style for all of them (solid border, `--paper-2`).
- [ ] **Step 5: Run** the spec, `npx tsc --noEmit`, `npx eslint src/features/auth` — clean.
- [ ] **Step 6: Commit** — `git commit -m "feat(landing): ship classes and mission types"`.

### Task 4: Assemble the page and remove the powers

**Files:**
- Modify: `apps/web/src/features/auth/landing.tsx`, `apps/web/src/features/auth/login.page.tsx`, `apps/web/src/styles/auth.css`
- Modify: `apps/web/src/features/auth/auth.spec.tsx` (the landing test around lines 115-135)
- Test: `apps/web/src/features/auth/auth.spec.tsx`

**Interfaces:**
- Consumes: `ShowcaseBlock`, `ShipClasses`, `MissionKinds`, `SHIP_CLASSES`, `MISSION_KINDS`; keys `landing.facts.*`, `landing.more.*`, `landing.cta.*`.
- Produces: `export function LandingStory(): JSX.Element` (no props now); `useLanding` and `HeroShip` keep their exports.

- [ ] **Step 1: Write the failing tests** in `auth.spec.tsx`: (a) the landing shows the headings "Your ship is a puzzle of parts", "Different ships, different jobs", "Pick a job. Beat the field.", "A mission for every ship", "Not a game you can just leave running"; (b) `landing-facts` contains "220 parts to build with" (from the mock), "5 ship classes" and "8 kinds of mission"; (c) no heading "Four powers, one sector", no heading "Luna Authority" or "Pirates", and the page text does not match `/powers|free pilot/i`; (d) with `/v1/public/landing` answering 500 the five headings above still render and `landing-facts` is absent (keep the existing failure test and extend it); (e) "Create your pilot" still links to `/register`.
- [ ] **Step 2: Run them to verify they fail** — `npx vitest run src/features/auth/auth.spec.tsx`; expected FAIL.
- [ ] **Step 3: Rewrite `LandingStory`** as `<ShowcaseBlock id="build" />`, `<ShipClasses />`, `<ShowcaseBlock id="race" flip />`, `<MissionKinds />`, the "more" section with its three cards (economy, risk, read), then the call to action. Remove the steps and faction sections and the unused imports (`defaultFactionBannerUrl`, `pickLocalized`, the `landing` prop).
- [ ] **Step 4: Update the hero facts** in `login.page.tsx`: parts and places from the API (only when it answered), then `landing.facts.shipClasses` with `count: SHIP_CLASSES.length` and `landing.facts.missionKinds` with `count: MISSION_KINDS.length` (these two do not need the API; show them even when it failed, and keep the `data-testid="landing-facts"` list rendered whenever it has at least one item). Remove the factions fact. Call `<LandingStory />`.
- [ ] **Step 5: Delete the dead CSS** in `auth.css`: every rule for `.landing-factions`, `.landing-faction`, `.landing-steps` and `.landing-step-no`, including their mobile variants. Run `grep -rn "landing-faction\|landing-steps" apps/web/src` and expect no match.
- [ ] **Step 6: Run** `npx vitest run src/features/auth src/i18n`, `npx tsc --noEmit`, `npx eslint src/features/auth src/styles` — all clean.
- [ ] **Step 7: Commit** — `git commit -m "feat(landing): the sign-in page shows the game; the powers section is gone"`.

### Task 5: Real browser check, accessibility, deploy

**Files:** none new; fixes go where the problem is.

- [ ] **Step 1: Run the e2e suites that load these pages** from `apps/web`: `npx playwright test e2e/a11y.spec.ts e2e/widths.spec.ts e2e/motion.spec.ts --reporter=list` (the a11y spec visits `/login` and `/register`; the motion spec checks `/login`). Expected: all pass. If axe reports contrast on the pins or mono tags, fix the token use, not the test.
- [ ] **Step 2: Rebuild and look.** `docker compose --profile dev up -d --build web`; use the browser-smoke recipe in memory (`reference_browser_smoke_local`) to open `http://localhost:8080/login` at 1280 px and 390 px, in English and Brazilian Portuguese, and take a screenshot of each. Check: pins sit on the same parts of the screens as in `docs/design/landing-option-b.html`, no horizontal scroll, cards stack, pt-BR text is not clipped.
- [ ] **Step 3: Check the failure path** by pointing the page at a 500 for `/v1/public/landing` (block the request in the browser) and confirm the page still shows every block.
- [ ] **Step 4: Run the whole web unit suite** once: `npx vitest run` — expected all pass.
- [ ] **Step 5: Hand over.** Report the screenshots to the owner. Do not push or promote; the owner decides. Deploy needs only the `web` image (no migration, no API change). The shipped images are not content-hashed, so rename them if they are replaced later, or browsers keep the old ones.

## Out of scope (decide later)

- The public landing endpoint still returns `factions` and `counts.factions`; the page no longer reads them. Trimming the endpoint and the contract type is a separate change (API, contract and web together).
- Sign-in as a dialog behind two buttons (Option C): not part of this plan.

## Self-review notes

- Spec coverage: removed powers and free pilots (Task 4, tested); new bigShip image and callouts (Tasks 1-2); ship classes (Task 3); mission types with the game's own "needs" wording and equal borders (Task 3); copy in both languages (Task 1).
- Types: `ShowcaseBlock` takes `id: 'build' | 'race'` everywhere; `LandingStory` loses its prop in Task 4 and `login.page.tsx` is updated in the same task.
- Proportion: copy is listed once (Task 1); components are described by signature and tests.
