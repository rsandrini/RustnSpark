-- A player may own several ships (schema and services assume N; the UI limits it to one in v0.1).
DROP INDEX "Ship_ownerPlayerId_key";

CREATE INDEX "Ship_ownerPlayerId_idx" ON "Ship"("ownerPlayerId");
