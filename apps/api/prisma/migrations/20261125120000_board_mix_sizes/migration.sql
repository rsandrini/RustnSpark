-- Slice 2.1 (the board mix): the board floor grows from 8/6/4 to 10/8/6 offers (main/regional/local).
-- The seed fills only empty tables, so an existing row needs this update. An Admin edit is kept:
-- only a row still holding the old default changes. The new board_* knobs get no INSERT (defaults merge).
UPDATE "GameConfig" SET "value" = '{"main":10,"regional":8,"local":6}'::jsonb WHERE "key" = 'missions.board_min_by_detail' AND "value" = '{"main":8,"regional":6,"local":4}'::jsonb;
