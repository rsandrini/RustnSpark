-- A part is INSTALLED exactly when it belongs to a ship. Previously only application code held this.
ALTER TABLE "PartInstance"
  ADD CONSTRAINT "PartInstance_location_ship_check"
  CHECK (("location" = 'INSTALLED') = ("shipId" IS NOT NULL));
