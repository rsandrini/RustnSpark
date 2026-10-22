-- Balance round 5c (2026-10-22): the r5b2 retest picked the softer pirate growth by bridge (Epic x1.2, Legendary x1.45;
-- the applied x1.35 / x1.7 left 20-26 of 32 runs stalled and nobody at Legendary). Rare and below stay at x1.
UPDATE "GameConfig"
SET "value" = '{"COMMON":1,"UNCOMMON":1,"RARE":1,"EPIC":1.2,"LEGENDARY":1.45}'::jsonb
WHERE "key" = 'encounter.pirate_strength_by_bridge';
