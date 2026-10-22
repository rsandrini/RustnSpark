-- Balance round 6 (2026-10-22), from the r6 retest (wear 30% / 50% lower, repair factor 0.45):
-- repair took 70-77% of the income and Legendary came at ~100 h. The lever is wear, not the repair price.
-- 1. 30% less wear (the middle variant: it clears the stalls without making Legendary trivial).
UPDATE "GameConfig" SET "value" = '0.7'::jsonb WHERE "key" = 'wear.base_min';
UPDATE "GameConfig" SET "value" = '1.2'::jsonb WHERE "key" = 'wear.base_max';
UPDATE "GameConfig" SET "value" = '0.2'::jsonb WHERE "key" = 'wear.hull_to_condition';
-- 2. Pirates grow with the bridge again at Epic x1.35 and Legendary x1.7 (the stalls that made round 5c soften them
--    came from the wear cut above).
UPDATE "GameConfig"
SET "value" = '{"COMMON":1,"UNCOMMON":1,"RARE":1,"EPIC":1.35,"LEGENDARY":1.7}'::jsonb
WHERE "key" = 'encounter.pirate_strength_by_bridge';
-- 3. Epic parts x1.5 and Legendary x2 on top of round 5b's prices, to slow the two top tiers.
UPDATE "PartCatalog" SET "basePrice" = ROUND("basePrice" * 1.5), "scrapValue" = ROUND("scrapValue" * 1.5) WHERE "rarity" = 'EPIC';
UPDATE "PartCatalog" SET "basePrice" = ROUND("basePrice" * 2.0), "scrapValue" = ROUND("scrapValue" * 2.0) WHERE "rarity" = 'LEGENDARY';
