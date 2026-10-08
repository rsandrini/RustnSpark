-- Location.art: admin-uploaded images by slot (wide, square, icon) -> stored file names.
-- NULL / a missing slot means the built-in static default is used.
ALTER TABLE "Location" ADD COLUMN "art" JSONB;
