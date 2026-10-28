-- CreateTable
CREATE TABLE "RaceResult" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "playerId" VARCHAR(36) NOT NULL,
    "missionId" VARCHAR(36) NOT NULL,
    "routeKey" VARCHAR(96) NOT NULL,
    "originId" VARCHAR(48) NOT NULL,
    "destinationId" VARCHAR(48) NOT NULL,
    "seconds" INTEGER NOT NULL,
    "place" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RaceResult_missionId_key" ON "RaceResult"("missionId");

-- CreateIndex
CREATE INDEX "RaceResult_routeKey_seconds_idx" ON "RaceResult"("routeKey", "seconds");

-- CreateIndex
CREATE INDEX "RaceResult_routeKey_day_idx" ON "RaceResult"("routeKey", "day");

-- CreateIndex
CREATE INDEX "RaceResult_playerId_idx" ON "RaceResult"("playerId");

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
