-- Balance round 4 (sim experiment epic-v1, 2026-10-16). Owner steer: money must keep mattering up
-- to Legendary, the Rare -> Epic jump must be about half as long, early income and fuel a bit
-- better. Epic parts cost x2 and Legendary x3 (the sink: end wallets drop from 200-450k to 35-85k);
-- rare/epic bridges see epic parts more often (so money is the way past Rare: L4 at ~56-91 game
-- hours instead of 130-190, or never); early missions pay more, fuel is cheaper.
-- Set unconditionally: this database exists for balancing.

UPDATE "PartCatalog"
SET "basePrice" = round("basePrice" * 2), "scrapValue" = round("scrapValue" * 2)
WHERE "rarity" = 'EPIC';

UPDATE "PartCatalog"
SET "basePrice" = round("basePrice" * 3), "scrapValue" = round("scrapValue" * 3)
WHERE "rarity" = 'LEGENDARY';

UPDATE "GameConfig" SET "value" = '450'::jsonb  WHERE "key" = 'economy.reward_base';
UPDATE "GameConfig" SET "value" = '90'::jsonb   WHERE "key" = 'economy.reward_per_tier';
UPDATE "GameConfig" SET "value" = '0.45'::jsonb WHERE "key" = 'economy.fuel_price';
UPDATE "GameConfig"
SET "value" = jsonb_set(
      jsonb_set("value", '{RARE}', '{"COMMON": 1, "UNCOMMON": 0.7, "RARE": 0.4, "EPIC": 0.15, "LEGENDARY": 0}'::jsonb),
      '{EPIC}', '{"COMMON": 1, "UNCOMMON": 0.9, "RARE": 0.6, "EPIC": 0.4, "LEGENDARY": 0.08}'::jsonb)
WHERE "key" = 'economy.market_rarity_by_bridge';
