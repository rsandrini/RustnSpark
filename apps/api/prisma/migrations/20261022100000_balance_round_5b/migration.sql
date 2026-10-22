-- Balance round 5b (2026-10-22): the first pass of round 5 was too hard and too dear (the sim retest: nobody reached
-- Legendary, repair took 70-85% of the income, Rare lost half its fights). Now:
-- 1. Pirates are what they always were (zones 0-3 as before); they grow with the BRIDGE instead
--    (encounter.pirate_strength_by_bridge, added by the seed's fill-what-is-missing step), so Rare stays comfortable and
--    Epic / Legendary pilots meet a real fight.
UPDATE "GameConfig"
SET "value" = '[0.55,0.7,0.8,0.85,1.0,1.1]'::jsonb
WHERE "key" = 'encounter.pirate_strength_options';
UPDATE "GameConfig"
SET "value" = '{"0":0.35,"1":0.5,"2":0.65,"3":1.0}'::jsonb
WHERE "key" = 'encounter.pirate_zone_strength';

-- 2. Epic parts x1.5 and Legendary x2 over round 4's prices (round 5's first pass made them x2 and x3 over them).
UPDATE "PartCatalog" SET "basePrice" = ROUND("basePrice" * 0.75), "scrapValue" = ROUND("scrapValue" * 0.75) WHERE "rarity" = 'EPIC';
UPDATE "PartCatalog" SET "basePrice" = ROUND("basePrice" * 2.0 / 3.0), "scrapValue" = ROUND("scrapValue" * 2.0 / 3.0) WHERE "rarity" = 'LEGENDARY';
