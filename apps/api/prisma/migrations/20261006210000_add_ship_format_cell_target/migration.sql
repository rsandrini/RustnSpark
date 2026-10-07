-- ShipFormat.cellTarget (admin request): designer-declared target cell count for a format —
-- a soft budget the admin editor shows as "drawn / target" (extras highlighted in red).
-- Never a hard validation limit: saving a format over budget still succeeds.
ALTER TABLE "ShipFormat" ADD COLUMN "cellTarget" INTEGER;
