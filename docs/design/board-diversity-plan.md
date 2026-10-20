# More diversity on the mission boards: 8 offers on big ports, 4 on small places (built, 2026-10-20)

Built as recommended: `missions.board_min_by_detail` (main 8, regional 6, local 4; a test pad holds 1), the type cap is
at most half the board, every type a place can post appears once before any type repeats (`preferTypes` in the
generator), and eight new templates (3 escorts, 2 rescues, 3 races; `prisma/seed-data/board-variety.ts`). The sim was
re-run to check the pace.

Owner (2026-10-20): "Missions need to have more diversity. We can raise missions to 8 on each big port and keep 4 in
small locations."

## 1. What exists today
- Every location tops its board up to `missions.board_min_per_location` (4) live offers when it is read
  (`board.service.ts`, one advisory lock per location), refreshed as offers expire (about 15 minutes).
- The generator picks a template at random among those that fit the place (`template.filler.ts`), at most
  `missions.board_max_same_type` (2) of one type and never two offers of the same type and destination
  (the "boards are a mix" rule).
- A place's size is already on the map as `detail` (main / regional / local): 18 main, 2 regional, 9 local (6 service
  stops, 3 test pads) after the map extension.
- The number of templates is small (42 in all, many tied to a faction or a place type), so a board of 4 shows the same
  few missions again and again.

## 2. Proposal
1. **The size of a board follows the size of the place**: `board_min_per_location` stops being one number and becomes
   one per detail level: **main 8**, regional 6 (recommended; the owner named only big and small), **local 4**. A test
   pad keeps its own rule (only its way back). New config: `missions.board_min_by_detail` (`{ main, regional, local }`),
   Admin-tunable; the old key stays as the fallback for places with no detail.
2. **Diversity rules scale with the board**: at 8 offers the cap of 2 per type would be too tight (5 types x 2 = 10 is
   fine, but a faction with few types would run out), so: `board_max_same_type` becomes a share (at most half the board,
   rounded up: 4 of 8, 2 of 4), and the existing "no same type and destination twice" stays.
3. **A new rule: every type the place can serve appears at least once** before any type repeats (a round-robin over
   the eligible types), so a big port always shows delivery, transport, escort, mining, rescue and race when it can.
4. **More templates** are needed for 8 offers to feel different: the audit lists which types and factions have the
   fewest templates (races only for explorers at Ziggy, escorts, rescues) and adds the missing ones. This is a content
   task, listed separately.
5. **The cost**: a board read at a big port generates up to 8 offers instead of 4 (a few milliseconds each); the
   per-location lock and the 15-minute expiry stay. The "every location has at least one offer" guarantee stays.

## 3. Work, in order
1. API: `board_min_by_detail` (config, schema, registry, defaults, test counts), the per-detail target in the top-up,
   the type cap as a share, the round-robin over the eligible types; tests (a main port reaches 8, a local stop 4,
   every eligible type appears once on a big board, no same type + destination twice, the pad rule unchanged).
2. Web: the board and the map's mission counts already read what the API returns; check the Missions screen at 8 rows
   (layout, scroll, the filter chips) and the map's per-place counts.
3. Content: the template audit and the new templates (a separate step, with your input on which mission types you want
   more of).
4. Sim: re-run the experiment (more offers per board means better picks for the bot; check the pace does not jump).

## 4. Decisions (recommendation first)
- Regional places get 6 (recommended); the alternative is to treat them as small (4).
- The type cap becomes "at most half the board" (recommended) rather than a fixed 2.
- Add the round-robin rule so a big board shows every type it can (recommended); without it 8 random offers can still
  be five deliveries.
