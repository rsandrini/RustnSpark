-- S11.3: analytics time windows (dashboard/economy/world) query by date range, so every
-- windowed column gets its own index and MissionInstance learns the creation time it
-- never recorded (generation-vs-consumption per zone needs "when was this offer made").
ALTER TABLE "MissionInstance" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: no creation timestamp existed; accepted missions show their accept instant,
-- pending/expired offers their deadline (offer creation = deadline − TTL, same epoch).
UPDATE "MissionInstance" SET "createdAt" = COALESCE("acceptedAt", "expiresAt");

CREATE INDEX "MissionInstance_createdAt_idx" ON "MissionInstance"("createdAt");
CREATE INDEX "MissionInstance_acceptedAt_idx" ON "MissionInstance"("acceptedAt");
CREATE INDEX "MissionLog_createdAt_idx" ON "MissionLog"("createdAt");
CREATE INDEX "PlayerEvent_at_idx" ON "PlayerEvent"("at");
CREATE INDEX "PlayerEvent_type_at_idx" ON "PlayerEvent"("type", "at");
CREATE INDEX "Player_createdAt_idx" ON "Player"("createdAt");
