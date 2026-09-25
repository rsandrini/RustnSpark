-- CreateTable
CREATE TABLE "ScavengeCounter" (
    "playerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "ScavengeCounter_pkey" PRIMARY KEY ("playerId", "locationId")
);

-- AddForeignKey
ALTER TABLE "ScavengeCounter" ADD CONSTRAINT "ScavengeCounter_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScavengeCounter" ADD CONSTRAINT "ScavengeCounter_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: existing scavenges live in PlayerEvent — carry each (player, location)
-- pair's attempt count and last attempt over so live cooldowns and drop seeds (the
-- rolls are seeded by attempt number) don't reset when the counter takes over.
INSERT INTO "ScavengeCounter" ("playerId", "locationId", "attemptCount", "lastAttemptAt")
SELECT
    pe."playerId",
    pe.payload ->> 'locationId',
    COUNT(*),
    MAX(pe."at")
FROM "PlayerEvent" pe
WHERE pe."type" = 'scavenge'
  AND pe.payload ->> 'locationId' IS NOT NULL
GROUP BY pe."playerId", pe.payload ->> 'locationId'
ON CONFLICT DO NOTHING;
