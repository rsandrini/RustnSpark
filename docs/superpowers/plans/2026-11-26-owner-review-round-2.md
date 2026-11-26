# Owner Review Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight complaints of the owner's second review: ship yard names, the ship sheet (overdrive mark, profile), part lists and the store (fit chips, filters, list view), the goods screen, turning parts into scrap, the repair and refuel bars, and the ranking screen.

**Architecture:** Mostly `apps/web` (React, kit components in `src/ui/kit`, CSS in `src/styles`). Item 2f also adds a server-side scrap action in `apps/api` (pure yield rule + two endpoints + four Admin keys) and two contract schemas in `packages/contract`.

**Tech Stack:** React + react-i18next, vitest + testing-library (web), NestJS + Prisma + jest (api), zod (contract).

**Spec:** the owner's review round 2 message (quoted in the Findings below). No separate spec doc.

## Findings (root cause per item)

1. **Yard names cut to the first line.** `blockTextLayout` (`apps/web/src/features/hangar/part-block-art.tsx:123`) caps a block shorter than 2 cells at ONE name line when it draws the type row (`n0 = height < 2 ? Math.min(nameLines, 1) : nameLines`), and `PartBlockArt` drops the other lines with no ellipsis (`lines.slice(0, layout.lineCount)`, :237). Evidence from the most active guest in the dev DB (26 missions, ship format `uncommon_rocket_2`, 30 cells, area factor 1), recomputed with the real formulas at zoom 1: of 11 installed parts, 5 show only their first line: `Compartimento de Carga Reforçado` 1x1 -> "Comparti…"; `Motor Químico Aprimorado` 1x1 (x3) -> "Motor"; `Painel Solar Avançado` 1x1 -> "Painel"; `Tanque de Combustível Médio` 2x1 -> "Tanque de"; `Plataforma de Mineração` 1x2 at rot 90 -> "Plataforma de". Not cut: the bridge (no row), 2-tall blocks, "Laser". At zoom 2.4 the 1x1 cargo and engine are still cut.
2a. **Warning mark on Condition.** `ship-sheet-panel.tsx:481-491` draws the soft-warning button (`⚠`, `hangar.warnings.open`, `onShowWarnings`) inside the Condition tile. It has nothing to do with condition; it shares the `--sun` colour with the overdrive badge `tile-push` on the Mobility tile (:450-463, `ship.css:1291`), which is a plain `<span>` with no action.
2b. **Profile overflows.** `.pb-row` (`ship.css:685`) is a 7-column grid with fixed tracks (`16px 4.6em 6.5em minmax(60px,1fr) auto 3em 2.6em` + 6 gaps ≈ 430px at 14px), wider than the sheet column, so the list overflows right. `.sheet-profile` is a one-column grid with `justify-items: center` (:658): the column grows to the list's min-content width, so the centred radar sits right of the visible panel too. `.pb-name` is a 4.6em ellipsis box, hence the short axis names (`Pax`, `Def`, `Veloc.`). The `x / Y` is `.pb-value` (`profile-breakdown.tsx:100`).
2c. **Obvious fit messages.** `fitView` (`features/parts/fit-view.ts:19`) returns an `ok` verdict for `full` and `partial`; it feeds `PartCard` (`part-card.tsx:116-121`, "✓ Todas as portas combinam…"), `PartRow` (`part-row.tsx:52-63`) and the tray chip "Encaixa {{count}}" (`tray-part-row.tsx:58-68`).
2d. **Filters and the list view.** The hangar "Parts" tab (`hangar.page.tsx:1006-1036`) has no filter at all; the store has a search box and the icon tabs on separate rows (`market-panel.tsx:292-363`) and its search does not match the type name. The list view crams everything into one nowrap flex line (`parts.css:739-800`: `.part-row-name` `white-space: nowrap; text-overflow: ellipsis`), so in the narrow hangar side panel the name shrinks to "…". The toggle is a text segment "Cards | List" (`store-view-toggle.tsx`).
2e. **Goods screen.** The materials heading is `port.materials` ("Mined materials" / "Materiais minerais", `port.page.tsx:910`), but the list holds ore, scrap and core fragments too (dev `Material`: `common_ore`, `uncommon_minerals`, `rare_crystals`, `scrap`, `core_fragment`; cores per memory). Descriptions are clamped to 3 lines by `.pcard-desc` (`port.css:38-44`) inside a price-crowded card header.
2f. **No scrap action.** Only `POST /v1/inventory/discard` (`parts.service.ts:215`) exists: it destroys loose parts under `economy.sell_min_condition` for a fixed `economy.discard_scrap_per_part`. Its confirm checkbox `discardSellScrap` defaults to `true` (`port.page.tsx:523`). TODO_v0.1.5 item 10 asks for scrapping any loose part with a bonus chance from condition and rarity.
2g. **Repair bar.** `ConditionSlider` paints the current level in the tone colour and the repair as a grey hatch (`kit.css:424-433`), so there is no colour for "after repair". The thumb is a 12x18 flat rectangle in paper colour (`kit.css:465-481`, `--thumb: 12px` at :400).
2h. **Refuel bar.** `.refuel-panel input[type='range'] { width: 100% }` (`port.css:343`, specificity 0,2,1) beats `.cslider-input { width: calc(100% - var(--from)) }` (0,1,0). Refuel sets `min = fuel`, so the input starts at `--from` and is still 100% wide: the thumb runs past the fill and the right end is clipped. The animation was the old `Gauge` fill transition (`components.css:503-507`, `transition: width 1s ease-out` under `prefers-reduced-motion: no-preference`); commit `afd15abb` replaced the `Gauge` with `TankChart` + `ConditionSlider`, which have no transition.
2f'. **Ranking scroll bar.** `.kit-tabs` has `overflow-x: auto` (`kit.css:265`), which makes `overflow-y` auto too, and `Tooltip` renders its absolute card inside the tablist (`IconTabs.tsx` comment, `Tooltip.tsx:88`): hovering or focusing a board tab makes a scroll bar. Six 40px tabs fit in 390px, so the scroll buys nothing there. The only names on screen are the selected board's name (`rankings.page.tsx:100`); no key for the icons, the faction badge or the highlighted row.

## Rulings (made here; ★ = the owner may want to overturn)

- R1 ★ A block shows every wrapped name line. When the type row and all the lines do not fit, the **row (icon) is dropped**, not the name. A cut line always ends in "…".
- R2 ★ The overdrive badge on Mobility becomes a button: it opens the warnings when there are any, else the engine tuning. The ⚠ leaves the Condition tile. Warnings with engines not pushed stay reachable from a "Warnings (N)" button on the status line under the class row.
- R3 ★ "Fogo" becomes **"Guerra"** in pt-BR and "War" in en (the owner wrote "War"). All axis names are written in full: Cargo/Carga, Passengers/Passageiros, War/Guerra, Defense/Defesa, Speed/Velocidade, Range/Alcance, Mining/Mineração.
- R4 A fit message shows only when the part does NOT fit (`none`, `noneFree`). The "Fits my free ports" filter chip stays: it filters, it does not announce anything. The "What joins what" legend stays.
- R5 ★ One `PartFilterBar` (search box + icon tabs on one row) goes in the hangar Parts tab and the store. Search ignores case and accents and matches the name, the description and the type name ("motor" finds engines).
- R6 ★ The list view becomes a two-line row (name wraps in full, then type · size · condition · price, with the actions on the right). The "Cards | List" text toggle becomes two icon buttons (grid / rows) with the same labels as accessible names.
- R7 Goods are grouped client-side by material id: `scrap` -> Scrap; `core_fragment` and ids ending in `_core` -> Cores; everything else -> Ore and minerals. Loose parts come first. Each group shows its total value. Descriptions are shown in full.
- R8 ★ Scrap yield: `base = scrap_yield_base[rarity] + floor((w*h - 1) * scrap_yield_per_cell)`; then `scrap_bonus_rolls` rolls, each a success with `p = scrap_bonus_chance[rarity] * condition/100`; `pieces = base + bonus`, capped for a sellable part (condition ≥ `sell_min_condition`) at `max(1, floor(bestSell / scrapUnitPrice))`, where `bestSell = floor(basePrice * conditionMultiplier(condition) * sell_ratio)`, the price at a port with no discount. So selling a healthy part always pays at least as much. The rng is seeded by `scrap:<partInstanceId>`, so a part's yield is fixed. Any loose (INVENTORY) part except a BRIDGE can be scrapped. Not allowed: in repair, ship ON_MISSION.
- R9 The confirm shows the min-max from a quote ("You get 2 to 5 scrap"), not the percentage. "Discard damaged" keeps its fixed yield (`discard_scrap_per_part`) and is unchanged apart from its checkbox, now "Turn into scrap and sell", **unchecked by default**.
- R10 The repair bar has two solid colours: the tone colour for now, `--info` for repair-to (fuel: `--brass` for now, `--info` for added). The thumb is a 16px round handle (`--thumb: 16px`). The fill animates (`width 1s ease-out`) and the tank fill animates (`transform 1s ease-out`), both only under `prefers-reduced-motion: no-preference`.
- R11 ★ `.kit-tabs` wraps (`flex-wrap: wrap; overflow: visible`) instead of scrolling. This changes the board and store icon tabs too: on a phone the store's many types take two rows instead of a side scroll. The ranking symbols are explained in a `HelpTip` beside the tabs (each board icon with its name, the faction badge, the highlighted row).
- Needs the owner: none blocking. The defaults above apply until the owner overturns them.

## Global Constraints

- All player strings in `apps/web/src/i18n/en.json` AND `pt-BR.json`; no hard-coded strings; `src/i18n/keys.spec.ts` requires every literal `t('…')` key to exist. Delete keys this plan stops using.
- Code and comments in English.
- Web tests: vitest + testing-library unit specs only. No browser/e2e tasks. A layout fix is asserted by class/structure/attribute, or by a CSS-text regex over the stylesheet (the pattern of `ConditionSlider.spec.tsx:90-101`: `readFileSync(join(__dirname, '../../styles/kit.css'), 'utf8')`).
- Run only the specs for touched files: `cd apps/web && npx vitest run <paths>`; api `cd apps/api && npm run test:unit -- <path>` and `npm run test:int -- <path>` (int stack per the targeted-tests memory).
- `apps/api/src` must not import `@rustandspark/contract`. Use local types there and parse the contract in the int-spec. New error codes need en + pt-BR under `error.<CODE>`.
- Admin owns tunables (config registry, en + pt-BR descriptions; DB wins over TS defaults). New keys need no migration. Do not change the default of an existing key.
- Reuse the kit (`IconTabs`, `HelpTip`, `ConditionSlider`, `TankChart`) before adding components. No horizontal overflow at 390px.
- Commit on `develop` only (`git branch --show-current` before every commit). Never on `release/*`, `main`, `master`.

## Review Focus

- A 1x1 block with a 3-line name now drops its icon: check that the connector dots on the top edge do not sit on the first text line (`blockTextLayout` classic centre is `gy + h/2 - 0.1`). The Task 1 test pins that the text block stays between `gy + 0.2` and `gy + h - 0.24`.
- The `.kit-tabs` wrap (Task 10) changes the store and mission board tabs too. Task 10's CSS test pins the rule; a reviewer should check the board's `.board-tab-count` badge still sits on its tab.
- Scrapping a part the pilot sold or scrapped a second ago (stale list): the server must answer 404 with no scrap granted. Pinned in Task 7's int-spec ("repeat with a new key is 404").
- Search with accents or capitals ("MINERACAO", "motor") must still match. Pinned in Task 5's `matchesPartSearch` tests.
- A refuel at `fuel = 0` (min = 0, `--from: 0%`) and at `fuel` close to full (`--span` near 0) must keep the thumb on the fill edge. Pinned in Task 9 by the `thumbCentre` cases and the CSS-text test that `.refuel-panel` no longer sets the range width.

---

### Task 1: Yard labels show the whole name (item 1)

**Files:**
- Modify: `apps/web/src/features/hangar/part-block-art.tsx:100-155, 234-237`
- Test: `apps/web/src/features/hangar/part-block-art.spec.tsx`

**Interfaces:**
- Produces: `blockTextLayout(...)` (same signature) and `export function clipNameLines(lines: readonly string[], count: number): string[]`.

- [ ] **Step 1: Write the failing tests** in `part-block-art.spec.tsx`. Replace the `if (height < 2) expect(layout.lineCount).toBe(1)` and `expect(layout.row).not.toBeNull()` lines of the `%s: the row never overlaps the name lines` table with the new rule:

```ts
it('drops the type row, not the name, when a short block cannot hold both (guest ship evidence)', () => {
  // "Compartimento de Carga Reforçado" on a 1x1 wraps to 3 lines at zoom 1
  const one = blockTextLayout(0, 1, 0.16, 3, true, 1, 'Cargo');
  expect(one.row).toBeNull();
  expect(one.lineCount).toBe(3);
  // "Tanque de Combustível Médio" on a 2x1: 2 lines, no row
  expect(blockTextLayout(0, 1, 0.16, 2, true, 2, 'Tank').lineCount).toBe(2);
  // a 1-line name keeps its icon ("Laser")
  expect(blockTextLayout(0, 1, 0.16, 1, true, 1, 'Weapon').row).not.toBeNull();
  // a 2-tall block holds the row and 3 lines ("Compartimento de Carga Grande" 1x2)
  const tall = blockTextLayout(0, 2, 0.16, 3, true, 1, 'Cargo');
  expect(tall.row).not.toBeNull();
  expect(tall.lineCount).toBe(3);
});
it('keeps the name text inside the block whenever the row is dropped', () => {
  const l = blockTextLayout(0, 1, 0.16, 3, true, 1, 'Cargo');
  const lh = l.nameFont * 1.15;
  expect(l.firstY - lh / 2).toBeGreaterThanOrEqual(0.2 - 1e-9);
  expect(l.firstY + (l.lineCount - 0.5) * lh).toBeLessThanOrEqual(1 - 0.24 + 1e-9);
});
it('clipNameLines ends a cut name with an ellipsis', () => {
  expect(clipNameLines(['Motor', 'Químico', 'Aprimorado'], 3)).toEqual(['Motor', 'Químico', 'Aprimorado']);
  expect(clipNameLines(['Motor', 'Químico', 'Aprimorado'], 1)).toEqual(['Motor…']);
  expect(clipNameLines(['Comparti…', 'de Carga'], 1)).toEqual(['Comparti…']);
});
it('draws every wrapped line of a 1x1 part', () => {
  const { container } = art({ lines: ['Motor', 'Químico', 'Aprimorado'], labelFont: 0.16 });
  expect(container.querySelectorAll('text.block-label tspan')).toHaveLength(3);
  expect(container.querySelector('[data-testid="block-kind-icon"]')).toBeNull();
});
```

(`art` is the spec's existing render helper; pass `lines`/`labelFont` through it.) If the "keeps inside" test fails with the classic centre, set `firstY` in `noRow()` to `Math.max(classic, gy + 0.2 + lh/2)` and pin that.

- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/features/hangar/part-block-art.spec.tsx`. Expected: FAIL on the row/lineCount asserts and on the missing `clipNameLines`.
- [ ] **Step 3: Implement.** In `blockTextLayout`, the attempts become `[[nameLines, labelFont]]` plus `[1, squeezed]` only when `nameLines === 1 && squeezed < labelFont`. If none fits, return `noRow()`. Drop `n0` and the `[1, labelFont]` step. Add `clipNameLines` (if `count < lines.length`, the last kept line gets "…" unless it already ends with one). In `PartBlockArt` use `clipNameLines(lines, layout.lineCount)` for the unbroken case and `[...clipNameLines(lines, layout.lineCount - 1), t('parts.broken')]` for broken parts. Update the file's doc comment on degradation.
- [ ] **Step 4: Run** the same command. Expected: PASS. Also run `npx vitest run src/features/hangar/ship-yard.spec.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(hangar): a yard block shows its whole name; the type icon gives way on short blocks`.

### Task 2: The overdrive badge is the button; no ⚠ on Condition (item 2a)

**Files:**
- Modify: `apps/web/src/features/hangar/ship-sheet-panel.tsx:61-64, 446-493, 509-513`; `apps/web/src/styles/ship.css:1291-1309`
- Test: `apps/web/src/features/hangar/ship-sheet-panel.spec.tsx:86-110, 233+`; `apps/web/src/features/hangar/hangar.spec.tsx:1600-1607` (testid kept)

**Interfaces:**
- Consumes: the existing props `warningCount`, `onShowWarnings`, `onTuneEngines`, `engineLevels`. No prop changes.

- [ ] **Step 1: Write the failing tests** (replace the test at :86 and update :104 and :233):
  - `it('has no warning mark on the Condition tile')`: render with `warningCount={2}` and `onShowWarnings`; `within(headlineTile('Condition')).queryByRole('button')` is null and the tile text has no `⚠`.
  - `it('the overdrive badge opens the warnings when there are any')`: `engineLevels={{ chem: 1.45, ion: 1 }}`, `warningCount={2}`; `screen.getByTestId('engines-pushed')` is a `BUTTON` with accessible name `Warnings (2)` and text `▲ 145%`; click -> `onShowWarnings` called once.
  - `it('the overdrive badge opens the engine tuning when there are no warnings')`: `warningCount={0}`; click -> `onTuneEngines` called once.
  - `it('warnings with engines not pushed are on the status line')`: `engineLevels` at 1/1, `warningCount={2}`; `within(container.querySelector('.sheet-status')!).getByRole('button', { name: 'Warnings (2)' })` calls `onShowWarnings`; no `engines-pushed`.
  - The Profile-view test at :233: the warnings button is found in `.sheet-status`, not on Condition.
- [ ] **Step 2: Run** `npx vitest run src/features/hangar/ship-sheet-panel.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete `WARN_GLYPH` and the Condition-tile button. The `tile-push` span becomes `<button type="button" className="tile-push" data-testid="engines-pushed" …>`: when `warningCount > 0 && onShowWarnings`, its `aria-label` is `t('hangar.warnings.open', { count })` and its click calls `onShowWarnings`; otherwise its `aria-label` is `t('hangar.headline.tuneEngines')` and its click calls `onTuneEngines`. Keep `title` = `hangar.headline.pushed`. When neither callback exists it stays a span. The `.sheet-status` div gains, when `warningCount > 0 && onShowWarnings` and the engines are not pushed, `<button type="button" className="link-btn sheet-status-warn">` with `t('hangar.warnings.open', { count })`. CSS: `.tile-push` gets `background: transparent; font: inherit; cursor: pointer;` plus a `:hover`/`:focus-visible` ring in `--sun`. Remove `.tile-icon-warn` and `.tile-icon-bare` if unused.
- [ ] **Step 4: Run** the sheet spec and `npx vitest run src/features/hangar/hangar.spec.tsx -t "pushed"`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(ship-sheet): the overdrive badge opens the warnings; no warning mark on the condition`.

### Task 3: Profile fits its panel, full names, no "x / max" (item 2b)

**Files:**
- Modify: `apps/web/src/features/hangar/profile-breakdown.tsx` (drop `detail` prop and `.pb-value`); `ship-sheet-panel.tsx:25,152,233-239` (drop `profileDetail` prop); `hangar.page.tsx:1485` (stop passing it); `apps/web/src/ui/kit/ShipRadar.tsx`; `apps/web/src/styles/ship.css:658-781`; `i18n/en.json` + `pt-BR.json` `hangar.profile.axis.*`
- Test: `profile-breakdown.spec.tsx`, `ui/kit/ShipRadar.spec.tsx`, `ship-sheet-panel.spec.tsx`

**Interfaces:**
- Produces: `ProfileBreakdown({ profile, ghost?, shipClass?, profileModifier? })`; `export function radarLabelBox(index: number, text: string): { left: number; right: number }` in `ShipRadar.tsx` (viewBox units, glyph width estimate `0.56 * 10` per char, the same estimate `fitKindLabel` uses).

- [ ] **Step 1: Write the failing tests:**
  - profile-breakdown: `it('shows no value over reference')`: no element matches `.pb-value`, and the defense row has no text `4.2 / 70`. Replace the old `'4.2 / 70'` assert at :44.
  - `it('writes axis names in full')` with i18n pt-BR: row names are `['Carga','Passageiros','Guerra','Defesa','Velocidade','Alcance','Mineração']`. In en: `['Cargo','Passengers','War','Defense','Speed','Range','Mining']`.
  - `it('lays the row out in tracks that shrink (no fixed em columns)')` (CSS-text over `styles/ship.css`): the `.pb-row` rule matches `/grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)/`, has no `4.6em` anywhere in the file, and `.pb-name` has no `text-overflow: ellipsis`. `.sheet-profile` matches `/grid-template-columns:\s*minmax\(0,\s*1fr\)/`.
  - ShipRadar: `it.each(RADAR_AXES.map((a, i) => [a.key, i]))('%s label stays inside the 200-unit view in both languages', …)`: for the longest en and pt-BR name of that axis, `radarLabelBox(i, name).left >= 0` and `.right <= 200`.
- [ ] **Step 2: Run** `npx vitest run src/features/hangar/profile-breakdown.spec.tsx src/ui/kit/ShipRadar.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - i18n `hangar.profile.axis` en: Cargo, Passengers, War, Defense, Speed, Range, Mining. pt-BR: Carga, Passageiros, Guerra, Defesa, Velocidade, Alcance, Mineração.
  - `.pb-row` grid: `grid-template-columns: 16px minmax(0, 1fr) auto 3em auto;` with areas `'icon name marks percent delta' '. bar bar bar bar' '. hint hint hint hint'`. `.pb-name` wraps (`overflow-wrap: anywhere`, no nowrap/ellipsis). Drop the `.pb-value` rule and the `@media (max-width: 480px)` block, since the new grid already fits. `.sheet-profile { grid-template-columns: minmax(0, 1fr); }`; `.profile-breakdown { min-width: 0; }`.
  - `ShipRadar`: if a label's box crosses 0 or 200, set `textAnchor` to `start`/`end` at that edge (use `radarLabelBox`). With the names above, the test shows whether any axis needs it.
  - Remove `detail` / `profileDetail` from the props and the call sites.
- [ ] **Step 4: Run** the step 2 command plus `npx vitest run src/features/hangar/ship-sheet-panel.spec.tsx src/i18n/keys.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(ship-sheet): the profile fits its panel, names the axes in full and drops the reference values`.

### Task 4: Fit messages only when a part does not fit (item 2c)

**Files:**
- Modify: `apps/web/src/features/parts/fit-view.ts`, `part-row.tsx:52-63`, `part-card.tsx:116-121`, `features/hangar/tray-part-row.tsx:58-68`; i18n: delete `connectors.fit.full`, `connectors.fit.partial`, `connectors.fit.chipJoins` (en + pt-BR)
- Test: `features/parts/part-card.spec.tsx:63-112`, `part-row.spec.tsx:59`, `features/hangar/tray-part-row.spec.tsx`, `features/market/market-panel.spec.tsx:114`, new `features/parts/fit-view.spec.ts`

**Interfaces:**
- Produces: `FitView` with `tone: 'bad'` only and `key: 'none' | 'noneFree'`; `fitView(fit): FitView | undefined` returns `undefined` for `full` and `partial`.

- [ ] **Step 1: Write the failing tests:** `fit-view.spec.ts`: `fitView({ level: 'full', matching: 2, total: 2 })` and `{ level: 'partial', matching: 1, total: 3 }` are `undefined`; `level: 'none'` gives `{ tone: 'bad', key: 'none' }`; `none-free` gives `key: 'noneFree'`. In the part-card/part-row/tray specs, the cases that expected an `ok` `part-fit` now expect `queryByTestId('part-fit')` to be null and no text matching `/Joins|Encaixa|All ports match/`. The `none` cases keep their asserts. market-panel :114: only listings that do not fit render `part-fit`.
- [ ] **Step 2: Run** `npx vitest run src/features/parts src/features/hangar/tray-part-row.spec.tsx src/features/market/market-panel.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `fitView` returns `undefined` unless the level is `none` or `none-free`. Narrow the `FitView` types. In `tray-part-row` the chip text is always `t('connectors.fit.chipNone')`. Delete the three i18n keys in both files.
- [ ] **Step 4: Run** the step 2 command plus `src/i18n/keys.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(parts): say only when a part does not fit; drop the obvious fit lines`.

### Task 5: Filter parts by icon and by name; a readable list view (item 2d)

**Files:**
- Create: `apps/web/src/features/parts/part-search.ts`, `apps/web/src/features/parts/part-filter-bar.tsx`
- Modify: `features/market/market-panel.tsx:187-214, 292-363` (use the bar), `features/hangar/hangar.page.tsx:1006-1036` (tray filter state + bar), `features/parts/part-row.tsx` (markup), `features/parts/store-view-toggle.tsx` (icon buttons), `styles/parts.css:734-805`; i18n `parts.filter.search`, `parts.filter.noMatch`
- Test: `features/parts/part-search.spec.ts`, `part-filter-bar.spec.tsx`, `part-row.spec.tsx`, `store-view-toggle.spec.tsx`, `market-panel.spec.tsx`, `hangar.spec.tsx`

**Interfaces:**
- Produces:
  - `export function foldText(text: string): string`: lower case, NFD, combining marks removed.
  - `export function matchesPartSearch(needle: string, texts: readonly string[]): boolean`: true for a blank needle, else every space-separated folded word of the needle is found in the folded texts joined.
  - `export interface PartFilterBarProps { groups: readonly string[]; group: string | null; onGroup: (group: string | null) => void; search: string; onSearch: (text: string) => void; }` and `PartFilterBar(props)`: `<div className="part-filter-bar" role="search">` holding a `type="search"` input (`aria-label` + placeholder `t('parts.filter.search')`) and the `IconTabs` built exactly as `market-panel.tsx:339-351` (moved here with `ALL_ICON`/`partClassIcon`).

- [ ] **Step 1: Write the failing tests:**
  - `part-search.spec.ts`: `matchesPartSearch('mineracao', ['Plataforma de Mineração'])` is true; `('MOTOR quim', ['Motor Químico Aprimorado'])` is true; `('motor', ['Laser', 'Motor'])` is true (type name as a text); `('tank', ['Laser'])` is false; `('  ', ['x'])` is true.
  - `part-filter-bar.spec.tsx`: typing "mot" calls `onSearch('mot')`; clicking the tab labelled the engine group calls `onGroup('ENGINE')`; the bar's first child is the search input and its second holds the `tablist` (one row).
  - hangar.spec: `it('filters the tray by type and by name')`: with the MSW inventory, typing an engine's name leaves only that `TrayPartRow`; picking a type with no match shows `parts.filter.noMatch`.
  - market-panel.spec: the search finds a listing by its type name (the en `hangar.partGroups` label).
  - part-row.spec: `it('puts the name on its own line, then the facts')`: the article has `.part-row-name` and `.part-row-facts`, and `.part-row-facts` contains the price and condition. CSS-text over `parts.css`: `.part-row` matches `/display:\s*grid/` and `/grid-template-areas/`, and the `.part-row-name` rule has no `nowrap`.
  - store-view-toggle.spec: two buttons named `Cards` and `List` (accessible names), each holding an `svg` and no visible text node; `aria-pressed` follows `value`.
- [ ] **Step 2: Run** `npx vitest run src/features/parts src/features/market/market-panel.spec.tsx src/features/hangar/hangar.spec.tsx -t "filter|search|row|toggle"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The market keeps its own `search`/`partClass` state but renders `PartFilterBar`. Its haystack becomes `matchesPartSearch(search, [name, description, groupLabel])`, where `groupLabel` is the localized `hangar.partGroups.<group>`.
  - Tray: `const [trayGroup, setTrayGroup] = useState<string | null>(null)` and `traySearch`. Groups come from `partGroupOf` over `trayParts`. The bar shows only when `trayParts.length > 1`.
  - `PartRow` markup: art | `.part-row-main` (`h2.part-row-name`, then `.part-row-facts` = MetaLine pieces + condition + price) | `.part-row-actions`. CSS: `.part-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; grid-template-areas: 'art main actions'; }`, the name wraps, and `.part-row-fit` sits under the facts. At `max-width: 480px` the actions take a second row (`'art main' '. actions'`).
  - Toggle: inline SVG glyphs (a 2x2 grid; three rows) on the same 20x20 grid as `board-icons.tsx`, with `aria-label={t('market.view.cards' | 'market.view.list')}` and a `title`.
  - i18n: `parts.filter.search` = "Search by name or type" / "Buscar por nome ou tipo"; `parts.filter.noMatch` = "No part matches this filter." / "Nenhuma peça bate com o filtro."
- [ ] **Step 4: Run** the step 2 command without `-t`, plus `src/i18n/keys.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(parts): filter parts by type and by name; a two-line list row and an icon view toggle`.

### Task 6: The goods screen in groups (item 2e)

**Files:**
- Create: `apps/web/src/features/port/goods-groups.ts`, `apps/web/src/features/port/material-group.tsx`
- Modify: `features/port/port.page.tsx:849-976`; `styles/port.css` (new `.goods-group`, `.goods-row` rules); i18n: delete `port.materials`; add `port.goods.*`
- Test: `features/port/goods-groups.spec.ts`, `features/port/port.spec.tsx`

**Interfaces:**
- Produces:
  - `export type GoodsGroup = 'ore' | 'scrap' | 'cores'`
  - `export function goodsGroupOf(materialId: string): GoodsGroup` (R7)
  - `export function groupGoods<T extends { materialId: string }>(holdings: readonly T[]): Array<{ group: GoodsGroup; items: T[] }>`: order ore, scrap, cores; empty groups left out.
  - `MaterialGroup({ group, holdings, money, sellAmountOf, onAmount, onSell }): ReactNode`: a `<section className="goods-group" data-testid={`goods-${group}`}>` with `<h3>` = `t(`port.goods.${group}`)` and a total `t('port.goods.worth', { value })`, then one `.goods-row` per holding: name × quantity, the full description (`.goods-row-desc`, no clamp), unit price, the amount slider and the Sell button (the existing markup from :933-970).

- [ ] **Step 1: Write the failing tests:**
  - `goods-groups.spec.ts`: `goodsGroupOf('scrap') === 'scrap'`; `'core_fragment'`, `'prototype_core'`, `'ancient_core'` give `'cores'`; `'common_ore'`, `'rare_crystals'`, `'uncommon_minerals'` give `'ore'`. `groupGoods` keeps the order and drops empty groups.
  - port.spec (goods tab, MSW materials with ore + scrap + core_fragment): sections `goods-ore`, `goods-scrap`, `goods-cores` exist in that order after the parts list. No text `Mined materials`. Each section header shows the sum of `unitPrice × quantity`. The ore description renders in full in `.goods-row-desc`. CSS-text over `port.css`: the `.goods-row-desc` rule has no `line-clamp`.
- [ ] **Step 2: Run** `npx vitest run src/features/port`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the `port.materials` heading and grid with `groupGoods(materials).map(...)` -> `<MaterialGroup>`. Loose parts stay first, under `h3` `t('port.goods.parts')`. i18n: `port.goods.parts` "Parts" / "Peças"; `port.goods.ore` "Ore and minerals" / "Minérios e minerais"; `port.goods.scrap` "Scrap" / "Sucata"; `port.goods.cores` "Cores" / "Núcleos"; `port.goods.worth` "Worth {{value}}" / "Vale {{value}}". The `.goods-row` grid is `minmax(0,1fr) auto` and wraps at 390px.
- [ ] **Step 4: Run** `npx vitest run src/features/port src/i18n/keys.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(port): your goods in groups (parts, ore, scrap, cores) with full descriptions`.

### Task 7: Scrap a loose part on the server (item 2f, api + contract)

**Files:**
- Create: `apps/api/src/economy/scrap-yield.ts`, `apps/api/src/parts/scrap-part.service.ts`, `apps/api/test/unit/economy/scrap-yield.spec.ts`, `apps/api/test/integration/scrap-part.int-spec.ts`
- Modify: `apps/api/src/parts/parts.controller.ts`, `parts/parts.module.ts` (provider), `config/game-config.defaults.ts`, `config/game-config.types.ts`, `config/game-rules.schema.ts`, `config/config-registry.ts`; `packages/contract/src/index.ts`; `apps/api/test/security/idempotency-matrix.spec.ts`; `apps/api/test/integration/contract.int-spec.ts`; web `i18n` `error.PART_INSTALLED`, `error.PART_NOT_SCRAPPABLE`

**Interfaces:**
- Produces (api, local types):
  - `export interface ScrapYieldInput { rarity: Rarity; cells: number; condition: number; basePrice: number }`
  - `export interface ScrapYieldRules { base: Record<Rarity, number>; perExtraCell: number; bonusRolls: number; bonusChance: Record<Rarity, number>; sellRatio: number; sellMinCondition: number; scrapUnitPrice: number }`
  - `export function scrapYieldRange(input: ScrapYieldInput, rules: ScrapYieldRules): { min: number; max: number; chance: number }`
  - `export function rollScrapYield(input: ScrapYieldInput, rules: ScrapYieldRules, rng: Rng): { base: number; bonus: number; pieces: number }` (R8; `conditionMultiplier` from `economy/price.calculator.ts`, `createRng` from `common/rng/rng.ts`)
  - `ScrapPartService.quote(playerId, partInstanceId): Promise<{ partInstanceId: string; min: number; max: number; chance: number }>` and `.scrap(playerId, partInstanceId): Promise<{ partInstanceId: string; base: number; bonus: number; pieces: number; scrapHeld: number }>`
  - Endpoints: `POST /v1/inventory/:id/scrap/quote` (read-shaped) and `POST /v1/inventory/:id/scrap` (`@Idempotent()`, `@HttpCode(200)`).
  - Contract: `ScrapQuoteResponseSchema` `{ partInstanceId, min, max, chance }` and `ScrapPartResponseSchema` `{ partInstanceId, base, bonus, pieces, scrapHeld }`, with their types. Web re-exports both through `src/api/generated.ts`.
  - Admin keys (new, no migration), each with en + pt-BR descriptions: `economy.scrap_yield_base` (json, 0..50, `{COMMON:1,UNCOMMON:2,RARE:3,EPIC:5,LEGENDARY:8}`), `economy.scrap_yield_per_cell` (number, 0..5, `0.5`), `economy.scrap_bonus_rolls` (integer, 0..10, `3`), `economy.scrap_bonus_chance` (json, 0..1, `{COMMON:0.15,UNCOMMON:0.25,RARE:0.35,EPIC:0.45,LEGENDARY:0.55}`).

- [ ] **Step 1: Write the failing unit tests** `scrap-yield.spec.ts`:
  - `scrapYieldRange({ rarity: 'COMMON', cells: 1, condition: 100, basePrice: 10000 }, R)` is `{ min: 1, max: 4, chance: 0.15 }`; a 2x2 RARE at 50% gives `min: 3 + 1 = 4`, `chance: 0.175`.
  - `condition: 0` gives `chance: 0` and `rollScrapYield(...).bonus === 0` for any seed.
  - Same seed, same result: `rollScrapYield(i, R, createRng('scrap:p1'))` deep-equals a second call.
  - Cap: for any seed of 200 and a sellable part (`condition >= 15`), `pieces * R.scrapUnitPrice <= Math.max(R.scrapUnitPrice, Math.floor(basePrice * conditionMultiplier(condition) * R.sellRatio))`. A part under `sellMinCondition` is not capped.
  - Order: the mean of 500 seeds for a RARE at 100% is greater than for a COMMON at 20%.
- [ ] **Step 2: Run** `cd apps/api && npm run test:unit -- test/unit/economy/scrap-yield.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `scrap-yield.ts`, then the four keys in defaults/types/schema/registry (following `economy.reward_by_bridge` for the json shape).
- [ ] **Step 4: Run** step 2's command plus `npm run test:unit -- test/unit/config`. Expected: PASS.
- [ ] **Step 5: Write the failing int-spec** `scrap-part.int-spec.ts`: quote for a loose part returns the range. Scrap destroys the part, adds `pieces` to `PlayerMaterial(scrap)`, writes one `PlayerEvent` of type `inventory.scrap` with payload `{ partInstanceId, partType, rarity, condition, base, bonus, pieces }`. A repeat with the same `Idempotency-Key` replays the same body. A repeat with a new key is 404. An installed part is 409 `PART_INSTALLED`, a bridge 409 `PART_NOT_SCRAPPABLE`, a part in repair 409 `PART_IN_REPAIR`, a ship on a mission 409 `SHIP_ON_MISSION`, another pilot's part 404. contract.int-spec parses both responses with the new schemas. idempotency-matrix: add `'POST /v1/inventory/:id/scrap/quote': 'read-shaped: no state change'`.
- [ ] **Step 6: Run** `npm run test:int -- test/integration/scrap-part.int-spec.ts test/integration/contract.int-spec.ts` and `npm run test:security -- test/security/idempotency-matrix.spec.ts`. Expected: FAIL.
- [ ] **Step 7: Implement** `ScrapPartService`, using one transaction, the `partsUnderRepair` helper and the ship-status check as in `discardDamaged`. The delete uses `deleteMany({ where: { id, ownerPlayerId, location: 'INVENTORY' } })` and gives 404 when count is 0, so a race cannot grant twice. Then upsert `scrap` and record the event. Wire the controller routes.
- [ ] **Step 8: Run** step 6's commands. Expected: PASS. Add en + pt-BR `error.PART_INSTALLED` ("Take the part off the ship first." / "Tire a peça da nave primeiro.") and `error.PART_NOT_SCRAPPABLE` ("This part cannot be turned into scrap." / "Esta peça não pode virar sucata."), then run `cd apps/web && npx vitest run src/i18n/keys.spec.ts`.
- [ ] **Step 9: Commit** `feat(scrap): turn a loose part into scrap with a bonus chance by condition and rarity (admin knobs)`.

### Task 8: Scrap in the goods screen; the discard box starts unchecked (item 2f, web)

**Files:**
- Modify: `apps/web/src/features/port/port.page.tsx` (parts actions :876-904, discard state :523, discard dialog :1951-1971); `apps/web/src/test/msw/handlers.ts`; i18n `port.scrap.*`, `port.discardSellScrap`
- Test: `apps/web/src/features/port/port.spec.tsx`

**Interfaces:**
- Consumes: Task 7's endpoints and `ScrapQuoteResponse` / `ScrapPartResponse` via `src/api/generated.ts`; `useIntentKey` (`api/intent-key.ts`).

- [ ] **Step 1: Write the failing tests** (port.spec, goods tab):
  - `it('offers Turn into scrap on every loose part but the bridge')`: the button `Turn into scrap` shows on each non-BRIDGE `PartCard`, including a too-damaged one, and is disabled on a part in repair.
  - `it('confirms with the odds and scraps the part')`: click -> the dialog reads `You get 1 to 4 scrap` (MSW quote); confirm -> one POST to `/v1/inventory/:id/scrap` carrying an `Idempotency-Key`; then the notice `… became 3 scrap.`, and `['inventory']` and `['materials']` are invalidated.
  - `it('the discard dialog leaves Turn into scrap and sell unchecked')`: open the discard dialog; the checkbox `Turn into scrap and sell` is not checked; confirming posts `{ sellScrap: false }`.
- [ ] **Step 2: Run** `npx vitest run src/features/port/port.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add MSW handlers for both endpoints. Add `scrapQuote` (useQuery, enabled while the dialog is open) and `scrapPart` (useMutation with `scrapKey.keyFor(partInstanceId)`). Use a `Popup` confirm with the title `port.scrap.confirmTitle` and the body `port.scrap.confirmBody`. `useState(false)` for `discardSellScrap`. i18n: `port.scrap.action` "Turn into scrap" / "Transformar em sucata"; `port.scrap.confirmTitle` "Turn {{name}} into scrap?" / "Transformar {{name}} em sucata?"; `port.scrap.confirmBody` "You get {{min}} to {{max}} scrap. The part is destroyed; this cannot be undone." / "Você recebe de {{min}} a {{max}} de sucata. A peça é destruída; não dá para desfazer."; `port.scrap.confirm` "Scrap it" / "Desmontar"; `port.scrap.done` "{{name}} became {{count}} scrap." / "{{name}} virou {{count}} de sucata."; `port.discardSellScrap` "Turn into scrap and sell" / "Transformar em sucata e vender".
- [ ] **Step 4: Run** `npx vitest run src/features/port src/i18n/keys.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(port): turn a loose part into scrap from your goods; selling the discard's scrap is opt-in`.

### Task 9: Repair and refuel bars: two colours, a real thumb, the fill follows it, the animation is back (items 2g, 2h)

**Files:**
- Modify: `apps/web/src/styles/kit.css:386-500, 532-534`; `apps/web/src/styles/port.css:343-345`; `apps/web/src/ui/kit/TankChart.tsx:72-81`
- Test: `apps/web/src/ui/kit/ConditionSlider.spec.tsx`, `apps/web/src/ui/kit/TankChart.spec.tsx`

**Interfaces:**
- Produces: the tank fill is a full-height rect scaled by `--level`, `<rect className="tank-fill" data-fraction={level} style={{ '--level': level }} …>`. `thumbCentre` is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - ConditionSlider.spec (CSS-text over `kit.css`): `--thumb:\s*16px`; the `.cslider-add` rule has a solid `background:\s*var\(--info\)` and no `repeating-linear-gradient`; the thumb rules (`::-webkit-slider-thumb`, `::-moz-range-thumb`) have `border-radius:\s*50%` and `height:\s*16px`; inside a `@media (prefers-reduced-motion: no-preference)` block there is `.cslider-fill` and `.cslider-add` with `transition:` covering width, left and `1s`. `thumbCentre(40, 0, 16, 300)` is `128` and `thumbCentre(0, 1, 16, 300)` is `292`. These pin the refuel cases at `fuel` = 40% and at 0.
  - Same spec (CSS-text over `port.css`): no rule `.refuel-panel input[type='range']` sets `width`.
  - TankChart.spec: `tank-fill` has `style` `--level` = `0.5` for fuel 50/100 and a `height` equal to the glyph's body height minus 2. CSS-text over `kit.css`: `.tank-fill` has `transform:\s*scaleY\(var\(--level` and `transform-box:\s*fill-box`, and a `prefers-reduced-motion: no-preference` block gives `.tank-fill` `transition: transform 1s ease-out`.
- [ ] **Step 2: Run** `npx vitest run src/ui/kit/ConditionSlider.spec.tsx src/ui/kit/TankChart.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `kit.css`: `--thumb: 16px`. The thumb becomes `width/height: var(--thumb)` / 16px, `border-radius: 50%`, `background: var(--paper)`, `border: 2px solid var(--ink)`, `box-shadow: 0 1px 3px color-mix(in oklab, var(--ink) 35%, transparent)`. `.cslider-add { background: var(--info); }` (solid; keep the inset outline). Add `.cslider.fuel .cslider-add { background: var(--info); }` with `.cslider.fuel .cslider-fill` staying `--brass`. Add the motion block. Delete the width rule at `port.css:343-345` (the `.cslider-input` geometry owns it). `TankChart`: the fill rect gets `y={MAX_HEIGHT + 1 - height}` and `height={height}` with `style={{ '--level': level } as CSSProperties}`. CSS: `.tank-fill { transform-box: fill-box; transform-origin: bottom; transform: scaleY(var(--level, 0)); }`.
- [ ] **Step 4: Run** the step 2 command plus `npx vitest run src/features/port/port.spec.tsx -t "refuel|repair"`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(ui): repair bar in two colours with a round thumb; refuel slider follows its fill; the fill animates again`.

### Task 10: Ranking without a scroll bar, with a key to the symbols (item 2, second "f")

**Files:**
- Modify: `apps/web/src/styles/kit.css:260-268`; `apps/web/src/features/rankings/rankings.page.tsx:88-102`; `apps/web/src/styles/rankings.css`; i18n `rankings.legend.*`
- Test: `apps/web/src/ui/kit/IconTabs.spec.tsx`, `apps/web/src/features/rankings/rankings.spec.tsx`

**Interfaces:**
- Consumes: `BOARD_ICON`/`boardIcon` (`board-icons.tsx`), `HelpTip` (`ui/kit/HelpTip.tsx`), `FactionBadge`.

- [ ] **Step 1: Write the failing tests:**
  - IconTabs.spec (CSS-text over `kit.css`): the `.kit-tabs` rule has `flex-wrap:\s*wrap` and does not match `/overflow-x:\s*auto/`.
  - rankings.spec: `it('explains the symbols in a help tip')`: the `.rankings-boards` row holds a `HelpTip` button. Opening it lists one item per board, each with that board's icon `svg` and its `rankings.board.<name>` text, plus the lines `rankings.legend.faction` and `rankings.legend.you`.
- [ ] **Step 2: Run** `npx vitest run src/ui/kit/IconTabs.spec.tsx src/features/rankings/rankings.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `.kit-tabs`: drop `overflow-x: auto`, add `flex-wrap: wrap`. `.rankings-boards` becomes a `help-row` (flex, gap 8px) with the `IconTabs` and `<HelpTip align="end">`. The tip content is `<ul className="rankings-legend">` with one `<li>` per `BOARDS` entry (icon + name), `<li>{t('rankings.legend.faction')}</li>` and `<li>{t('rankings.legend.you')}</li>`. i18n: `rankings.legend.faction` "The badge is the pilot's faction." / "O selo é a facção do piloto."; `rankings.legend.you` "Your own row is highlighted." / "Sua linha fica destacada." CSS: `.rankings-legend` is a plain list with 6px gap, and its icons are 16px.
- [ ] **Step 4: Run** the step 2 command plus `npx vitest run src/features/board src/features/market/market-panel.spec.tsx src/i18n/keys.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(rankings): icon tabs wrap instead of scrolling; a help tip explains the symbols`.

---

Out of scope (noted, not built): the guide entry and the sim's scrap supply for the new scrap action (TODO item 10 lists them; follow-up), and moving "Discard damaged" onto the new yield rule (R9).
