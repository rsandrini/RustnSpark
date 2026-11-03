-- CreateTable
CREATE TABLE "NameReport" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "reporterId" VARCHAR(36) NOT NULL,
    "targetId" VARCHAR(36) NOT NULL,
    "subject" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(16) NOT NULL,
    "note" VARCHAR(300),
    "reportedText" VARCHAR(80) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" VARCHAR(36),
    "reviewedAt" TIMESTAMP(3),
    "outcome" VARCHAR(24),
    "reviewNote" VARCHAR(300),

    CONSTRAINT "NameReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NameReport_status_createdAt_idx" ON "NameReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NameReport_targetId_idx" ON "NameReport"("targetId");

-- One open report per reporter, target and subject (a partial unique index; Prisma cannot declare it).
CREATE UNIQUE INDEX "NameReport_open_unique" ON "NameReport"("reporterId", "targetId", "subject") WHERE "status" = 'OPEN';

-- AddForeignKey
ALTER TABLE "NameReport" ADD CONSTRAINT "NameReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameReport" ADD CONSTRAINT "NameReport_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
