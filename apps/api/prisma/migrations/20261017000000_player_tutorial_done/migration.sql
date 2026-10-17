-- Newcomer tutorial: one flag per player, set when the tutorial is skipped or finished.
ALTER TABLE "Player" ADD COLUMN "tutorialDone" BOOLEAN NOT NULL DEFAULT false;

-- Established players (they already finished a mission) never see it.
UPDATE "Player" SET "tutorialDone" = true
WHERE EXISTS (SELECT 1 FROM "MissionLog" WHERE "MissionLog"."playerId" = "Player"."id");
