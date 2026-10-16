-- Balance round 3 (sim experiments 51-52, 2026-10-15): the owner wants a fast pace and a far zone
-- that pays for its risk. Early missions pay about 30% more (reward_base 200 -> 300), danger pays
-- more (divisor 4 -> 3), a lost far fight costs a bit less (zone 3 loss scale 0.7 -> 0.5) and
-- the far pirates are a notch weaker (1.1 -> 1.0). Zone 3 net per mission goes from ~1.0x to ~1.35x
-- zone 2; chem fuel falls from ~30% to ~20% of reward. Set unconditionally (balancing database).

UPDATE "GameConfig" SET "value" = '300'::jsonb WHERE "key" = 'economy.reward_base';
UPDATE "GameConfig" SET "value" = '3'::jsonb   WHERE "key" = 'economy.reward_danger_divisor';
UPDATE "GameConfig"
SET "value" = '{"0": 0.1, "1": 0.3, "2": 0.4, "3": 0.5}'::jsonb
WHERE "key" = 'combat.loss_wear_scale';
UPDATE "GameConfig"
SET "value" = '{"0": 0.35, "1": 0.5, "2": 0.65, "3": 1.0}'::jsonb
WHERE "key" = 'encounter.pirate_zone_strength';
