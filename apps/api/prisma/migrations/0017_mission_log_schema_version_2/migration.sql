-- S9.0 / D36: enriched mission events bump the schema to 2. Only the default
-- changes — existing rows keep their stored schemaVersion (1) and stay readable.
ALTER TABLE "MissionLog" ALTER COLUMN "schemaVersion" SET DEFAULT 2;
