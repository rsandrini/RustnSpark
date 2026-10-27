-- CreateTable
CREATE TABLE "PlayerStats" (
    "playerId" VARCHAR(36) NOT NULL,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "records" JSONB NOT NULL DEFAULT '{}',
    "firstMissionAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerStats_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "PlayerStatsDaily" (
    "playerId" VARCHAR(36) NOT NULL,
    "day" DATE NOT NULL,
    "totals" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PlayerStatsDaily_pkey" PRIMARY KEY ("playerId","day")
);

-- CreateIndex
CREATE INDEX "PlayerStatsDaily_day_idx" ON "PlayerStatsDaily"("day");

-- AddForeignKey
ALTER TABLE "PlayerStats" ADD CONSTRAINT "PlayerStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStatsDaily" ADD CONSTRAINT "PlayerStatsDaily_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
