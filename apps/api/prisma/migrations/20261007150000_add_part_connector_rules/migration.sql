-- PartCatalog.connectorRules (connector ports spec rev 5): admin-defined rules used only at part
-- generation time (weighted kinds per side, caps, blacklist). The generated, concrete layout is
-- stored on PartInstance.connectors and never changes. NULL = never configured = universal
-- fallback. The older connectorLayouts candidate list is retired from admin but kept in the DB.
ALTER TABLE "PartCatalog" ADD COLUMN "connectorRules" JSONB;
