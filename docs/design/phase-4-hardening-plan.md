# Phase 4: hardening (plan, nothing built yet)

No new features. The redesign (phase 3) rebuilt every screen except Admin; this phase makes it safe to leave that way.
Same rule as before: each step ships on its own, tests and CI green, the logic and the test ids do not change.
Admin stays out of scope (owner, from the start).

## 1. Where things stand (facts, 2026-10-17)

- **CI:** green on every commit from the tutorial onward; the one red run (`docs: Ship screen built`) was before the
  later fixes. The **browser smoke still does not gate** the aggregate (`continue-on-error: true` in `ci.yml`), the
  standing rule in `docs/TODO.md` is to promote it to required after a green week.
- **CSS:** 14 files, 7,934 lines. `index.css` is still **4,776 lines** (down from about 5,900); the per-screen files
  (`port`, `missions`, `map`, `ship`, `report`, `auth`, `profile`, `onboarding`, `guide`, `tutorial`, `shell`,
  `components`, `tokens`) hold the rebuilt screens. A quick scan finds 481 class names in `index.css`, 62 of them not
  written anywhere in the source; most of those 62 are built at run time (`ev-combat`, `cond-bad`, `rar-epic`,
  `pill-ok`...), so the true dead count is lower and has to be proven one rule at a time. The legacy sheet also still
  carries literal colours and old aliases (`--spark`, `--blue`, `--panel`) next to the Lumen tokens.
- **Accessibility:** one axe spec (`a11y/a11y.spec.tsx`) covering the screens as they were before phase 3, plus
  per-feature specs that check roles. New since: the Map side panel, the tutorial card, the Guide and its search,
  the segment controls, the Missions rows with their disclosures, the zoomable map.
- **Motion:** `prefers-reduced-motion` is handled in 3 places in the sheets; the newer animations (the Map pulse and
  ship marker, the landing ship drift, the yard) have not been audited.
- **Headers:** Profile, Report, Map and Guide use the shared `PageTitle`; Port, Missions and Ship get their title from
  the slim place stage, and the Map still builds its own title block.
- **Tests:** two known soft spots: the race e2e depends on the dev board having a race offer, and one flaky unit
  spec was fixed today (not proven gone).

## 2. Steps (each one shipped and green on its own)

### H1: CI health (done 2026-10-17: the other flaky drag spec found in CI and fixed, three web runs and a 4x parallel stress run green, the race e2e explains itself, smoke flip dated 2026-10-24)
- Read the last 10 CI runs, the smoke report included, and list anything red or retried.
- Make the **race e2e self-sufficient**: it creates (through the admin API it already uses for tuning) or waits for a
  race offer instead of relying on whatever the board holds, so it cannot fail on an empty board.
- Run the web and API suites three times in a row to find any other flaky spec; fix the cause, not the timeout.
- Decide, with you, when the **browser smoke becomes required** (a green week after H1 is the proposal) and flip
  `continue-on-error` then.
- *Done when:* three consecutive full runs are green locally and CI is green on the head.

### H2: Legacy CSS clean-up (done 2026-10-17: `index.css` 5,900 -> 447 lines; 51 unused rules deleted, the admin rules in `admin.css`, every screen's rules in its own file, the shared UI rules in `components.css`, the 14 colour aliases retired; checked pixel for pixel on 30 screen states at two widths with `apps/web/visual`)

Where the rules live now: `index.css` base only; `components.css` the kit and shared UI (buttons, badges, tabs, popups, forms, gauges, rows, wallet, language switch); `shell.css` top bar, tab bar, status strip; `ship.css` the yard, the sheet, the tray and Transit's ship parts; `parts.css` the part card, part details and market filters; `port.css` Port; `missions.css` Missions, the mission card and Transit; `map.css`; `report.css`; `profile.css`; `onboarding.css`; `auth.css`; `guide.css`; `tutorial.css`; `admin.css`. Legacy rules sit at the top of each file, the redesign rules after them (they were written to override them).

- Slice by area, not by file: Transit and the mission card (the `mcard` rules Missions shares), the part card and
  tray, the yard (`hangar-*`, `yard-*`), the market and Port leftovers, the admin shell (stays where it is), generic
  utilities (`.btn`, `.chip`, `.pill`, `.badge`, `.panel`, `.stack`, `.field`, `.input`).
- For each rule: prove it is used (search source and the generated class names), move it to the owning screen file
  re-expressed in the Lumen tokens, or delete it. Evidence is a screenshot pair (before and after) of the screen
  and the full web run, never a guess.
- Retire the legacy aliases (`--spark`, `--blue`, `--panel`, `--mut`...) once nothing uses them, and replace the
  remaining literal colours by tokens.
- Target: `index.css` under about 1,500 lines, holding only what is truly shared (reset, base elements, the admin
  shell, a few utilities), with no rule that a per-screen file overrides.
- *Done when:* no screen changed visually (screenshots at 1280 and 390), tests green, and a short note in
  `docs/design/` says where each family of rules now lives.

### H3: Accessibility (done 2026-10-17: a real-browser axe spec with colour contrast over 25 screens and states at both widths, clean; the findings fixed: landmarks for the status strip and the language switch, heading levels, solid gauge labels, the account menu as a disclosure; arrow-key tab lists with a roving tabindex; a keyboard spec)
- **Automated:** extend the axe spec to every redesigned screen and state: Ship (idle and with a mission), Port tabs,
  Missions (row, Details open, pinned row), Map (panel open, empty), Report (three views), Profile, Onboarding,
  Auth (login, register, forgot), Guide (topic, search results), the tutorial card (open and pill), the account menu.
- **Keyboard:** a pass by hand and a Playwright spec: tab order on each screen, visible focus rings (the kit's
  focus style on every control), Escape closes the account menu and popups, Enter and Space on map places, the
  map's zoom buttons, the Guide search (Enter, Escape), segment controls as proper tablists (arrow keys).
- **Contrast:** check the muted text on the paper tokens (the likeliest failure on the dark theme) and the coral and
  brass on the card surfaces; adjust the tokens, not individual rules.
- **Names and roles:** icon-only buttons and the `aria-hidden` decorations (yard callouts, tutorial ticks) reviewed
  so nothing important is hidden and nothing decorative is announced.
- *Done when:* axe reports no violations on the list above and the keyboard spec passes.

### H4: Motion, width and language (done 2026-10-17: one reduced-motion rule and a spec; six widths x two languages with no sideways scroll; controls at least 40 px on touch screens, enforced by the width spec; the Map header now uses `PageTitle`)
- **Reduced motion:** every animation (map pulse and ship marker, landing ship, stage scenes, the tutorial card, the
  yard rotate icon) respects `prefers-reduced-motion: reduce`; one shared rule in `components.css` plus any
  exceptions listed.
- **Width pass:** every screen at 320, 375, 414, 768, 1024 and 1280 px, in English and in Portuguese (longer words),
  with the tutorial pill present: no sideways scroll, no clipped text, tap targets at least 40 px on phones.
- **Header unification:** the Map's own title block moves onto `PageTitle`, and Port, Missions and Ship keep the stage
  header (documented as the deliberate difference).
- *Done when:* a scripted run (the screenshot and overflow scripts used during phase 3, promoted to a Playwright
  spec) passes at all six widths in both languages.

### H5: Close-out (done 2026-10-17: `frontend-rules.md` records the rules and the checks; the redesign plan is marked done)
- Update `docs/design/ux-audit-and-redesign-plan.md` with the final state, mark phase 4 done in `docs/TODO.md`, and
  record the rules a future screen must follow (tokens only, one stylesheet per screen, PageTitle or stage header,
  the keyboard and axe checklist).

## 3. Order and cost
H1 then H2 then H3 then H4 then H5. H1 is a few hours. H2 is the largest by far (about 4,700 lines to sort) and the
only step with real regression risk, which is why it is sliced and screenshot-checked; H3 and H4 are mostly specs and
small token or markup fixes. Nothing here changes game logic, the API or the database.

## 4. Decisions before I start
1. **Browser smoke as a required CI check:** flip it after H1 (proposal), or keep it advisory?
2. **H2 target:** `index.css` under about 1,500 lines (proposal), or go further and remove it entirely (the base
   styles and the Admin shell would then live in their own files)?
3. **Contrast fixes:** adjust the shared tokens where a check fails (proposal), even if that shifts the look slightly?
4. **Languages for the width pass:** English and Portuguese (proposal).
