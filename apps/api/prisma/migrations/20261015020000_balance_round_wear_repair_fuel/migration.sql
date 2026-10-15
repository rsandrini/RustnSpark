-- Balance round (sim experiments 41-47, 2026-10-15). The economy math showed repair growing with
-- ship value (about 33x from tier 1 to 5) while reward grows about 6x, so a richer ship paid up
-- to 100%+ of its reward in repairs. Wear per mission falls from ~60 to ~20-30 points, repair
-- gets a little cheaper (never below the buy-used/repair/sell exploit floor, ~0.6), fuel gets
-- cheaper and the early pirates are weaker in zones 0-2 (zone 3 keeps full strength).
--
-- Owner request: this database exists for balancing, so these values are SET, not "only where
-- still default": whatever was tuned by hand is replaced by the round's numbers.

UPDATE "GameConfig" SET "value" = '0.62'::jsonb WHERE "key" = 'economy.repair_factor';
UPDATE "GameConfig" SET "value" = '60'::jsonb   WHERE "key" = 'economy.maintenance_per_tier';
UPDATE "GameConfig" SET "value" = '0.65'::jsonb WHERE "key" = 'economy.fuel_price';

-- The base wear roll is a real number now (1 to 1.7), not a whole one.
UPDATE "GameConfig" SET "value" = '1'::jsonb,   "type" = 'number' WHERE "key" = 'wear.base_min';
UPDATE "GameConfig" SET "value" = '1.7'::jsonb, "type" = 'number' WHERE "key" = 'wear.base_max';
UPDATE "GameConfig" SET "value" = '1'::jsonb    WHERE "key" = 'wear.environment_damage_factor';
UPDATE "GameConfig" SET "value" = '0.3'::jsonb  WHERE "key" = 'wear.hull_to_condition';

UPDATE "GameConfig"
SET "value" = '{"0": 0.35, "1": 0.5, "2": 0.65, "3": 1.1}'::jsonb
WHERE "key" = 'encounter.pirate_zone_strength';
