-- CreateEnum
CREATE TYPE "RepairJobStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "RepairJob" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "shipId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "cost" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "status" "RepairJobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairJob_status_completesAt_idx" ON "RepairJob"("status", "completesAt");

-- CreateIndex
CREATE INDEX "RepairJob_shipId_status_idx" ON "RepairJob"("shipId", "status");

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
