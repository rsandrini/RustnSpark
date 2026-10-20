-- Every credit amount of the game became ten times larger (2026-10-20, "big numbers"). The seed fills the
-- prices of a fresh database at the new scale, but the generic scrap row is created by an earlier migration
-- (20261014140000_generic_scrap) with the old price, so it moves here. Only a row still at the old price moves:
-- a price set in the Admin is left alone.
UPDATE "Material" SET "basePrice" = 100 WHERE "id" = 'scrap' AND "basePrice" = 10;
