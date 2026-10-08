-- Faction.art: admin-uploaded images by slot (banner, logo, background) -> stored file names.
-- NULL / a missing slot means the built-in static default is used.
ALTER TABLE "Faction" ADD COLUMN "art" JSONB;
