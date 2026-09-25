-- D43: a private, start-safe mission per player. NULL = a normal shared board offer (D29);
-- set = only that player sees it and only that player can hold/accept it.
ALTER TABLE "MissionInstance" ADD COLUMN "privatePlayerId" TEXT;

-- Board reads filter (originId, status, expiresAt) and then privatePlayerId.
CREATE INDEX "MissionInstance_privatePlayerId_originId_status_idx"
  ON "MissionInstance"("privatePlayerId", "originId", "status");
