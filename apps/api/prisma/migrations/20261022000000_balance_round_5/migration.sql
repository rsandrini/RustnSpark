-- Balance round 5 (2026-10-22, docs/design/balance-round-5-plan.md): Rare stays comfortable; Epic and Legendary
-- become expensive, slower and dangerous. The sim check of 2026-10-22 showed the whole ladder in about 70 game hours,
-- money piling up at the top (a mission paid 11x more at Legendary than at Common, a whole Legendary ship cost 16
-- missions) and combat falling to a 5% loss rate. Values are set unconditionally (this database is for balancing).

-- 1. A flatter reward at the top, and a slower tier part.
UPDATE "GameConfig" SET "value" = '700'::jsonb WHERE "key" = 'economy.reward_per_tier';
UPDATE "GameConfig"
SET "value" = '{"COMMON":1,"UNCOMMON":1,"RARE":1.4,"EPIC":1.9,"LEGENDARY":2.5}'::jsonb
WHERE "key" = 'economy.reward_by_bridge';

-- 2. Pirates above parity in zones 2 and 3 (they are built from the player's own sheet), zones 0-1 still easy.
UPDATE "GameConfig"
SET "value" = '[0.7,0.85,1.0,1.1,1.25,1.4]'::jsonb
WHERE "key" = 'encounter.pirate_strength_options';
UPDATE "GameConfig"
SET "value" = '{"0":0.7,"1":0.9,"2":1.1,"3":1.4}'::jsonb
WHERE "key" = 'encounter.pirate_zone_strength';

-- 3. Epic parts cost twice as much again, Legendary three times (scrap value follows, so the repair floor and the
-- sell price keep their relation to the price).
UPDATE "PartCatalog" SET "basePrice" = "basePrice" * 2, "scrapValue" = "scrapValue" * 2 WHERE "rarity" = 'EPIC';
UPDATE "PartCatalog" SET "basePrice" = "basePrice" * 3, "scrapValue" = "scrapValue" * 3 WHERE "rarity" = 'LEGENDARY';
