-- Every part family now has all five rarity tiers, the COMMON one under the bare name
-- (`hull`, `hull_uncommon`, `hull_rare`, ...). Eight families used to start higher up under the
-- bare name; move those first tiers to their suffixed name so the new COMMON row can take the bare
-- one (the seed adds it). PartInstance follows the rename (the foreign key cascades on update).
UPDATE "PartCatalog" SET "partType" = 'battery_large_uncommon'
  WHERE "partType" = 'battery_large' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'battery_large_uncommon');
UPDATE "PartCatalog" SET "partType" = 'armor_plate_uncommon'
  WHERE "partType" = 'armor_plate' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'armor_plate_uncommon');
UPDATE "PartCatalog" SET "partType" = 'shield_basic_uncommon'
  WHERE "partType" = 'shield_basic' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'shield_basic_uncommon');
UPDATE "PartCatalog" SET "partType" = 'engine_chem_large_uncommon'
  WHERE "partType" = 'engine_chem_large' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'engine_chem_large_uncommon');
UPDATE "PartCatalog" SET "partType" = 'mining_rig_uncommon'
  WHERE "partType" = 'mining_rig' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'mining_rig_uncommon');
UPDATE "PartCatalog" SET "partType" = 'weapon_laser_uncommon'
  WHERE "partType" = 'weapon_laser' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'weapon_laser_uncommon');
UPDATE "PartCatalog" SET "partType" = 'reactor_nuclear_rare'
  WHERE "partType" = 'reactor_nuclear' AND "rarity" = 'RARE'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'reactor_nuclear_rare');
UPDATE "PartCatalog" SET "partType" = 'weapon_missile_rare'
  WHERE "partType" = 'weapon_missile' AND "rarity" = 'RARE'
    AND NOT EXISTS (SELECT 1 FROM "PartCatalog" WHERE "partType" = 'weapon_missile_rare');

-- Each part's scrap is its own material (`scrap_<partType>`): rename the same eight (the player's
-- holdings follow, the foreign key cascades).
UPDATE "Material" SET "id" = 'scrap_battery_large_uncommon'
  WHERE "id" = 'scrap_battery_large' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_battery_large_uncommon');
UPDATE "Material" SET "id" = 'scrap_armor_plate_uncommon'
  WHERE "id" = 'scrap_armor_plate' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_armor_plate_uncommon');
UPDATE "Material" SET "id" = 'scrap_shield_basic_uncommon'
  WHERE "id" = 'scrap_shield_basic' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_shield_basic_uncommon');
UPDATE "Material" SET "id" = 'scrap_engine_chem_large_uncommon'
  WHERE "id" = 'scrap_engine_chem_large' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_engine_chem_large_uncommon');
UPDATE "Material" SET "id" = 'scrap_mining_rig_uncommon'
  WHERE "id" = 'scrap_mining_rig' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_mining_rig_uncommon');
UPDATE "Material" SET "id" = 'scrap_weapon_laser_uncommon'
  WHERE "id" = 'scrap_weapon_laser' AND "rarity" = 'UNCOMMON'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_weapon_laser_uncommon');
UPDATE "Material" SET "id" = 'scrap_reactor_nuclear_rare'
  WHERE "id" = 'scrap_reactor_nuclear' AND "rarity" = 'RARE'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_reactor_nuclear_rare');
UPDATE "Material" SET "id" = 'scrap_weapon_missile_rare'
  WHERE "id" = 'scrap_weapon_missile' AND "rarity" = 'RARE'
    AND NOT EXISTS (SELECT 1 FROM "Material" WHERE "id" = 'scrap_weapon_missile_rare');

-- Settings: the tier table was named like part-upgrade prices; and six keys that nothing read live
-- (or only at the first seeding) are gone. Values are kept as they are.
UPDATE "GameConfig" SET "key" = 'economy.ship_tier_thresholds'
  WHERE "key" = 'economy.upgrade_costs'
    AND NOT EXISTS (SELECT 1 FROM "GameConfig" WHERE "key" = 'economy.ship_tier_thresholds');
DELETE FROM "GameConfig" WHERE "key" IN (
  'economy.rarity_base_price',
  'economy.mood_min',
  'economy.mood_max',
  'mining.material_price',
  'missions.active_max',
  'ship.cruise_deficit_floor'
);

-- The start yard the Admin designed (25 cells) replaces the original 20x20 square; a yard the Admin
-- has already edited (anything but the 400-cell original) is left alone.
UPDATE "ShipFormat"
  SET "cells" = '[[-4,-1],[-4,0],[-4,1],[-3,-2],[-3,-1],[-3,0],[-3,1],[-3,2],[-2,-2],[-2,-1],[-2,0],[-2,1],[-2,2],[-1,-2],[-1,-1],[-1,0],[-1,1],[-1,2],[0,-1],[0,0],[0,1],[1,-1],[1,0],[1,1],[2,0]]'::jsonb,
      "cellTarget" = 26,
      "description" = '{"en": "The original start pack", "pt-BR": "Grade basica 1"}'::jsonb
  WHERE "id" = 'classic_square' AND jsonb_array_length("cells") = 400;
