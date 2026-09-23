-- Revision history is always read per entity (entityType, entityId), newest first.
CREATE INDEX "TuningRevision_entityType_entityId_id_idx" ON "TuningRevision"("entityType", "entityId", "id" DESC);
