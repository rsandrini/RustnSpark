-- A mission that is accepted but not started no longer blocks a search or a mining job, and a job under way never
-- runs beside a flight: one mission IN PROGRESS per player (a flight or a job), and one mission WAITING (accepted) per
-- player. The jobs (scavenging, free mining) pass through ACCEPTED for a moment before they are dispatched, so they
-- have their own one-waiting slot and do not take the real mission's.
DROP INDEX "MissionInstance_one_active_player_idx";
DROP INDEX "MissionInstance_one_active_scavenge_idx";
CREATE UNIQUE INDEX "MissionInstance_one_in_progress_idx" ON "MissionInstance"("playerId") WHERE "playerId" IS NOT NULL AND "status" IN ('IN_TRANSIT', 'RESOLVING');
CREATE UNIQUE INDEX "MissionInstance_one_waiting_idx" ON "MissionInstance"("playerId") WHERE "playerId" IS NOT NULL AND "status" = 'ACCEPTED' AND "templateId" NOT IN ('scavenge_generic', 'mining_job_generic');
CREATE UNIQUE INDEX "MissionInstance_one_waiting_job_idx" ON "MissionInstance"("playerId") WHERE "playerId" IS NOT NULL AND "status" = 'ACCEPTED' AND "templateId" IN ('scavenge_generic', 'mining_job_generic');
