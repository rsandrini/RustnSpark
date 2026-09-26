-- More than one offer per port. The database owns tuning (Admin edits win): the value only moves
-- while it still holds the old factory default of 1.
UPDATE "GameConfig" SET "value" = '4'::jsonb
  WHERE "key" = 'missions.board_min_per_location' AND "value" = '1'::jsonb;
