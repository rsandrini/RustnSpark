-- v0.1.3 balance (sim screening round): pay per hour by ship tier lands in the target band when the
-- distance counts for less and the better bridges pay a milder bonus. Only rows that still hold the old
-- default are moved, so a value the owner edited in the Admin is left alone.
UPDATE "GameConfig" SET "value" = '4000'::jsonb
  WHERE "key" = 'economy.reward_distance_divisor' AND "value" = '1500'::jsonb;
UPDATE "GameConfig"
  SET "value" = '{"COMMON": 1, "UNCOMMON": 1, "RARE": 1.25, "EPIC": 1.8, "LEGENDARY": 2.2}'::jsonb
  WHERE "key" = 'economy.reward_by_bridge'
    AND "value" = '{"COMMON": 1, "UNCOMMON": 1, "RARE": 1.4, "EPIC": 2.5, "LEGENDARY": 3.25}'::jsonb;
