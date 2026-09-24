-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('AVAILABLE', 'HELD', 'ACCEPTED', 'IN_TRANSIT', 'RESOLVING', 'DONE', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "MissionInstance" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "templateId" TEXT NOT NULL,
    "type" "MissionType" NOT NULL,
    "factionId" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "legs" JSONB NOT NULL,
    "cargo" JSONB NOT NULL,
    "reward" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'AVAILABLE',
    "playerId" TEXT,
    "shipId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "arrivalAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "seed" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MissionInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionInstance_originId_status_expiresAt_idx" ON "MissionInstance"("originId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MissionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written partial indexes (Prisma PSL has no WHERE syntax, so they live only here,
-- never in schema.prisma). IN_TRANSIT status sweeps read (status, arrivalAt). The partial
-- unique enforces one active mission per player across ACCEPTED/IN_TRANSIT/RESOLVING while
-- unlimited history (DONE/FAILED/EXPIRED), holds (HELD — hold_max is GameConfig-tunable and
-- enforced app-level in S6.4), and board rows (playerId IS NULL) stay unconstrained.
CREATE INDEX "MissionInstance_status_arrivalAt_in_transit_idx" ON "MissionInstance"("status", "arrivalAt") WHERE "status" = 'IN_TRANSIT';

CREATE UNIQUE INDEX "MissionInstance_one_active_player_idx" ON "MissionInstance"("playerId") WHERE "playerId" IS NOT NULL AND "status" IN ('ACCEPTED', 'IN_TRANSIT', 'RESOLVING');
