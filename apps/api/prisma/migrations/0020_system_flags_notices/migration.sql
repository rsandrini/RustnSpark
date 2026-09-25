-- S11.2: runtime feature flags (read per request, effective without restart) and
-- broadcast notices served to players while active. Change actors live in AdminAuditLog.
CREATE TABLE "SystemFlag" (
    "key" TEXT NOT NULL,
    "value" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemFlag_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SystemNotice" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "message" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "SystemNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemNotice_active_createdAt_idx" ON "SystemNotice"("active", "createdAt" DESC);
