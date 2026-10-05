-- Scavenging becomes a timed job with a report: a mission of its own type (no reward, same place),
-- and scrap is a material with a fixed price. The template and the scrap materials are seeded by
-- seed-data (a new enum value cannot be used in the transaction that adds it).
ALTER TYPE "MissionType" ADD VALUE IF NOT EXISTS 'SCAVENGE';
ALTER TABLE "Material" ADD COLUMN "fixedPrice" BOOLEAN NOT NULL DEFAULT false;
