-- A pilot can search on foot while the ship is out on a mission: the one-active-mission rule now holds
-- separately for scavenging jobs (one) and for every other mission (one). A scavenging job with the ship
-- still excludes a flight in code (the ship is locked by the flight).
DROP INDEX "MissionInstance_one_active_player_idx";
CREATE UNIQUE INDEX "MissionInstance_one_active_player_idx" ON "MissionInstance"("playerId") WHERE "playerId" IS NOT NULL AND "status" IN ('ACCEPTED', 'IN_TRANSIT', 'RESOLVING') AND "type" <> 'SCAVENGE';
CREATE UNIQUE INDEX "MissionInstance_one_active_scavenge_idx" ON "MissionInstance"("playerId") WHERE "playerId" IS NOT NULL AND "status" IN ('ACCEPTED', 'IN_TRANSIT', 'RESOLVING') AND "type" = 'SCAVENGE';
