-- Balance round 2 (sim experiments 48-50, 2026-10-15). Zone 3 paid 18% more than zone 2 for four
-- times the wear and 2.5 times the failures (net about 40 credits a mission against about 670).
-- Danger pays more (divisor 8 -> 4) and a lost far fight is less ruinous (loss_wear_scale).
-- Set unconditionally: this database exists for balancing.

UPDATE "GameConfig" SET "value" = '4'::jsonb WHERE "key" = 'economy.reward_danger_divisor';
UPDATE "GameConfig"
SET "value" = '{"0": 0.1, "1": 0.3, "2": 0.4, "3": 0.7}'::jsonb
WHERE "key" = 'combat.loss_wear_scale';
