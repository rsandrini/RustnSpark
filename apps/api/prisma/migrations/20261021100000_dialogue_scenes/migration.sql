-- The mentor's dialogue scenes (docs/design/mentor-dialogue-plan.md).
CREATE TYPE "DialogueStatus" AS ENUM ('OPEN', 'SKIPPED', 'DONE', 'REPLAY');

ALTER TABLE "Player" ADD COLUMN "dialogueEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "QuestGiver" ADD COLUMN "scenes" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "PlayerDialogue" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "playerId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "status" "DialogueStatus" NOT NULL DEFAULT 'OPEN',
    "nodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerDialogue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerDialogue_playerId_sceneId_key" ON "PlayerDialogue"("playerId", "sceneId");

ALTER TABLE "PlayerDialogue" ADD CONSTRAINT "PlayerDialogue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
