-- One-time data correction for databases seeded before the bridge structureCost change.
-- The old value (0) was a bug; the bridge is meant to provide structure budget.
UPDATE "PartCatalog"
SET "structureCost" = -100
WHERE "partType" = 'bridge' AND "structureCost" = 0;
