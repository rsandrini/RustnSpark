-- Ship formats unlock by bridge size as well as rarity (2026-10-13 bridge 2x2 design): a format
-- only opens when the installed bridge's w AND h are both >= minBridgeSize. Rarity and size stay
-- orthogonal (a RARE 1x1 stays small; a COMMON 2x2 is large). The default of 1 keeps every
-- existing format valid against the free 1x1 starter bridge; the big grids below are backfilled
-- to 2 so they only open behind a 2x2 bridge.

ALTER TABLE "ShipFormat" ADD COLUMN "minBridgeSize" INTEGER NOT NULL DEFAULT 1;

UPDATE "ShipFormat" SET "minBridgeSize" = 2
WHERE "id" IN ('epic_1', 'epic_2_copy', 'rare_1', 'rare_2_copy', 'uncommon_rocket', 'uncommon_rocket_2', 'uncommon_rocket_3');
