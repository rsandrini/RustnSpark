# Front-end rules for a new screen (end of the redesign, 2026-10-17)

What the redesign (phases 1 to 4) settled. A new screen follows these, so nothing has to be redone later.

## Look
- **Tokens only.** Colours, type, radius, shadow and motion come from `styles/tokens.css` (Lumen "Night Foundry": paper,
  brass, coral, hairline rules; Instrument Serif for titles, Geist for text, Geist Mono for numbers and labels). No
  literal colours, no legacy aliases (they are gone).
- **One stylesheet per screen**, named after it (`ship.css`, `port.css`...), imported in `main.tsx`. Shared pieces
  (buttons, chips, badges, tabs, popups, forms, gauges, rows) live in `components.css`; `index.css` is only the base.
  Admin has its own `admin.css` and is not part of the redesign.
- **Page header:** `PageTitle` (lowercase serif, one brass word, one mono line), or the slim place stage on Ship, Port
  and Missions. Never a hand-built title block.
- **Numbers** are mono and tabular; labels are small mono capitals; text is Geist.

## Behaviour
- Logic, API calls and test ids do not change in a restyle. Text in `en` and `pt-BR`, never hard-coded.
- Live numbers in text come from the server (see the Guide: `GET /v1/guide/rules`), never typed in.
- Tab lists use `role="tablist"` with `tablistKeys` (arrow keys, Home, End) and a roving `tabIndex`.
- A control is at least 40 px on touch screens (the `components.css` touch block covers the kit's classes).
- Everything that animates respects `prefers-reduced-motion` (one global rule in `components.css`).

## Checks a screen must pass (all automated)
- `e2e/a11y.spec.ts`: axe with colour contrast, both widths: add the screen's states to the list.
- `e2e/keyboard.spec.ts`: tab order, focus rings, Escape, arrow keys.
- `e2e/widths.spec.ts`: six widths x two languages, no sideways scroll, controls >= 40 px: add the path.
- Web specs (`pnpm test` in `apps/web`), the browser smoke, and for a CSS change the local visual harness
  (`apps/web/visual`, see its README) to prove nothing else moved.
