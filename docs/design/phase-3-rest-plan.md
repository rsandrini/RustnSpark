# Phase 3, screens 4 to 7: Report, Auth, Onboarding, Profile (plan, nothing built yet)

Order set by the owner: these four first, **Ship last**. Same scope rule as before: the logic does not change
(same queries, same forms and validation, same flows, same test ids and roles). Markup, layout, styling.

## 1. What they are today (facts)

| screen | files | now |
|---|---|---|
| Auth (`/login`, `/register`, `/forgot-password`, `/reset-password`) | `landing.tsx` (101), `login.page.tsx` (119), `register-form.tsx` (98), `forgot-password.page.tsx`, `reset-password.page.tsx` | Landing hero (sky art, kicker, title, pitch, facts) with the auth card (Login / Register tabs, fields, errors). Old blue-and-orange look, legacy `.landing*`, `.panel`, `.auth-tab`, `.field`, `.input` rules. |
| Onboarding (`/onboarding`) | `onboarding.page.tsx` (115) | Old `topbar` header, title, two sub lines, a fieldset of four faction cards (name, blurb), error, one "Launch" button. Faction backdrop. |
| Profile (`/profile`) | `profile.page.tsx` (100) | Old `topbar` with wallet block, then a list of past missions (type pill, result, link to the report), links to Port and Map. |
| Report (`/report/:missionId`) | `report.page.tsx` (685), `report-overview.tsx` (182) | Old `topbar` title, a tab row (Overview, The story, Log), the debrief (verdict glyph and outcome, mission, credits, tiles, race standings, loot found, repair hint), the overview with the trip on a map and part damage bars, the story as event articles, the log as a table. |

All four use the old page chrome (`<main className="app">`, `.topbar`, legacy cards) inside the new top bar.

## 2. What changes

### Shared frame (Profile and Report)
The slim header of the other screens: serif title with one accent word ("*mission* report", "*pilot* profile"), one
mono line under it, then the content. The legacy `.topbar` and the profile's wallet block go (the wallet is in the
top bar already).

### Auth
- Same layout idea (hero left, card right on desktop; card under the hero on a phone), rebuilt on the kit: the
  serif title with an accent word, the mono kicker, facts as hairline chips, the card on the paper tokens, tabs as
  the Port-style segment control, inputs and buttons from `components.css`, errors as coral strips.
- Forgot and reset password: the same card, centred.
- The sky art stays (it is the one place the art earns its space).

### Onboarding
- Header: serif "choose your *faction*", one mono line. Four faction cards as hairline cards in a 2 x 2 grid (one
  column on a phone) with the faction colour as a thin top rule, name in serif, blurb in the body font, a brass
  ring on the selected one; "Launch" is the primary button, full width under the grid.
- The faction backdrop stays, dimmed.

### Profile
- Header as above. Past missions as **rows** like Missions (type pip, title, result chip, reward in mono, link
  "Report"), newest first; links to Port and Map become one quiet row of buttons. Empty state kept.

### Report
- Header as above, tabs as the Port segment control (same roles: `tab`, `tablist`, same names).
- Debrief: the verdict as a large serif word with the coloured glyph, mission and credits as mono tiles, the race
  standings, loot and repair hint as hairline cards. The overview map and damage bars restyled; the story events
  as a vertical timeline of hairline cards; the log table with mono numbers and a sticky head.
- No change to what is shown, its order, or the three views.

### Styles
Each screen gets its own file (`auth.css`, `onboarding.css`, `profile.css`, `report.css`); the matching rules
(about 120 selectors; the report is most of them) leave the legacy sheet as they are rebuilt. Anything another
screen still uses stays in `index.css`.

## 3. What does not change
Validation, error texts, the `me` / login / register / reset flows, the onboarding mutation, report data and
views, the report link from Profile and from the transit "last mission" link, the faction colours from the
database, all test ids and accessible names.

## 4. Decisions before I start
1. **Order:** Profile, Onboarding, Auth, Report (smallest and lowest-risk first; the report is the largest).
   *Recommended: yes.*
2. **Profile past missions as rows** (like Missions) instead of cards. *Recommended: yes.*
3. **Onboarding faction cards in a 2 x 2 grid** with a colour rule on top. *Recommended: yes.*
4. **Report story as a timeline.** *Recommended: yes, as a restyle only (no new data).*
5. **Auth hero art:** keep the current sky art. *Recommended: keep.*

## 5. Steps (each shipped, tested and green on its own)

| step | what | touches |
|---|---|---|
| R1 | Profile: header, mission rows, `profile.css` | `profile.page.tsx`, specs |
| R2 | Onboarding: header, faction grid, `onboarding.css` | `onboarding.page.tsx`, specs |
| R3 | Auth: landing, card, forms, forgot / reset, `auth.css` | `landing.tsx`, `login.page.tsx`, `register-form.tsx`, 2 pages, specs |
| R4 | Report frame, tabs, debrief, `report.css` | `report.page.tsx`, `report-overview.tsx` |
| R5 | Report story and log, then the 320 to 1280 px pass for all four, browser smoke, screenshots | specs, e2e |

## 6. Cost and risk
Auth and onboarding specs read roles and labels (they stay). The browser smoke goes through register, onboarding
and the report, so it exercises R2 to R5 for real on desktop and phone after each step. The risk is the report
(685 lines, race, loot and cascade variants): it is split in two steps so the debrief can be checked before the
story and the log change.
