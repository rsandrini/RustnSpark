-- Lower the default tier thresholds so they match the current catalog prices.
-- This only updates rows that still have the old factory default;
-- any admin-tuned value is preserved.
UPDATE "GameConfig"
SET "value" = '{"2": 1200, "3": 2000, "4": 2800, "5": 3800}'::jsonb
WHERE "key" = 'economy.upgrade_costs'
  AND "value" = '{"2": 2500, "3": 7000, "4": 16000, "5": 32000}'::jsonb;
