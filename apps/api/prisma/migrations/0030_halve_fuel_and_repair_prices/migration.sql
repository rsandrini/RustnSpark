-- Playtest round 2: fuel and repairs were too expensive, so both base prices are halved (a fresh
-- balancing round follows). The database wins over factory defaults, so move the stored values
-- only while they still hold the old defaults: a value the owner chose is left alone.
UPDATE "GameConfig" SET "value" = '1.5'::jsonb
  WHERE "key" = 'economy.fuel_price' AND "value" = '3'::jsonb;
UPDATE "GameConfig" SET "value" = '3'::jsonb
  WHERE "key" = 'economy.repair_price' AND "value" = '6'::jsonb;
