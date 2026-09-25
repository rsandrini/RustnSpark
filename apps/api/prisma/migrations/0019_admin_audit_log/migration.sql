-- S11.1: audit trail for every non-tuning admin write (support actions, flags,
-- broadcast, maintenance). Tuning writes stay on TuningRevision (S3.7/S3.8).
CREATE TABLE "AdminAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_action_id_idx" ON "AdminAuditLog"("action", "id" DESC);
CREATE INDEX "AdminAuditLog_target_id_idx" ON "AdminAuditLog"("target", "id" DESC);
