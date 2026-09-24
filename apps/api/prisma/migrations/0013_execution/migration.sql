-- CreateTable
CREATE TABLE "MissionLog" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid(),
    "missionId" VARCHAR(36) NOT NULL,
    "playerId" VARCHAR(36) NOT NULL,
    "seed" VARCHAR(512) NOT NULL,
    "rulesHash" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "shipSnapshot" JSONB NOT NULL,
    "legs" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutePresence" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "missionId" TEXT NOT NULL,
    "shipId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "legIndex" INTEGER NOT NULL,
    "window" tstzrange NOT NULL,

    CONSTRAINT "RoutePresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "routeId" TEXT NOT NULL,
    "legIndex" INTEGER NOT NULL,
    "missionAId" TEXT NOT NULL,
    "missionBId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissionLog_missionId_key" ON "MissionLog"("missionId");

-- CreateIndex
CREATE INDEX "MissionLog_playerId_createdAt_idx" ON "MissionLog"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutePresence_window_idx" ON "RoutePresence" USING GIST ("window");

-- CreateIndex
CREATE INDEX "RoutePresence_missionId_idx" ON "RoutePresence"("missionId");

-- CreateIndex
CREATE INDEX "RoutePresence_shipId_idx" ON "RoutePresence"("shipId");

-- CreateIndex
CREATE INDEX "RoutePresence_routeId_idx" ON "RoutePresence"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_missionAId_missionBId_routeId_legIndex_key" ON "Encounter"("missionAId", "missionBId", "routeId", "legIndex");

-- CreateIndex
CREATE INDEX "Encounter_routeId_idx" ON "Encounter"("routeId");

-- AddForeignKey
ALTER TABLE "MissionLog" ADD CONSTRAINT "MissionLog_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "MissionInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionLog" ADD CONSTRAINT "MissionLog_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionLog" ADD CONSTRAINT "MissionLog_rulesHash_fkey" FOREIGN KEY ("rulesHash") REFERENCES "RulesSnapshot"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePresence" ADD CONSTRAINT "RoutePresence_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "MissionInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePresence" ADD CONSTRAINT "RoutePresence_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePresence" ADD CONSTRAINT "RoutePresence_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_missionAId_fkey" FOREIGN KEY ("missionAId") REFERENCES "MissionInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_missionBId_fkey" FOREIGN KEY ("missionBId") REFERENCES "MissionInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
