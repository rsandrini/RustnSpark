-- Add connector layout storage for Connectors v0.1 (topology).
-- Both columns are nullable JSONB: catalog holds admin-authored candidate layouts;
-- instances hold the single rolled layout chosen at creation time.
ALTER TABLE "PartCatalog" ADD COLUMN "connectorLayouts" JSONB;
ALTER TABLE "PartInstance" ADD COLUMN "connectors" JSONB;
