-- Playtest calibration: fuel was irrelevant. A chemical engine burned 0.7 fuel per 100 distance from
-- a 1000-unit tank, so a 950-distance trip cost 7 units (about 21 credits) against a reward of
-- ~500. Engine fuel use is now 10x (7 / 12 / 25 per 100 distance): a trip burns a few percent of
-- a tank and costs a real slice of its reward, as the economy notes intended.
-- The database owns part data (Admin edits win): a row moves only while it still holds the old
-- factory value.
UPDATE "PartCatalog" SET "fuelUse" = 7  WHERE "partType" = 'engine_chem_small'  AND "fuelUse" = 0.7;
UPDATE "PartCatalog" SET "fuelUse" = 12 WHERE "partType" = 'engine_chem_medium' AND "fuelUse" = 1.2;
UPDATE "PartCatalog" SET "fuelUse" = 25 WHERE "partType" = 'engine_chem_large'  AND "fuelUse" = 2.5;
