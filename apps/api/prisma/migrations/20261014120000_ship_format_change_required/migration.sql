-- A ship whose bridge changed (a different bridge installed, expanded, shrunk or upgraded) has to
-- pick its ship format again, from the new bridge's own level, before it can leave port. The ship
-- records the bridge type its format was last picked for; a pending change is "the installed
-- bridge is not that one", so it lives on the server and cannot be skipped from another device.

ALTER TABLE "Ship" ADD COLUMN "formatBridgeType" TEXT;

UPDATE "Ship" SET "formatBridgeType" = (
  SELECT p."partType" FROM "PartInstance" p
  JOIN "PartCatalog" c ON c."partType" = p."partType"
  WHERE p."shipId" = "Ship"."id" AND p."location" = 'INSTALLED' AND c."partClass" = 'BRIDGE'
  LIMIT 1
);
