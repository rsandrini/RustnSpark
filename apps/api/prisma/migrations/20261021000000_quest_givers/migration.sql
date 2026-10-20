-- Quest givers: the people behind the missions (docs/design/quest-givers-plan.md).
CREATE TYPE "GiverRole" AS ENUM ('GIVER', 'MENTOR');

CREATE TABLE "QuestGiver" (
    "id" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "role" "GiverRole" NOT NULL DEFAULT 'GIVER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "art" JSONB,
    "personality" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "locationIds" TEXT[],
    "weight" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "QuestGiver_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuestGiver_factionId_active_idx" ON "QuestGiver"("factionId", "active");

-- One active mentor per faction: the onboarding has a single recognisable voice.
CREATE UNIQUE INDEX "QuestGiver_one_active_mentor_idx" ON "QuestGiver"("factionId") WHERE "role" = 'MENTOR' AND "active";

ALTER TABLE "QuestGiver" ADD CONSTRAINT "QuestGiver_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MissionInstance" ADD COLUMN "giverId" TEXT;

CREATE INDEX "MissionInstance_giverId_idx" ON "MissionInstance"("giverId");

ALTER TABLE "MissionInstance" ADD CONSTRAINT "MissionInstance_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "QuestGiver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
