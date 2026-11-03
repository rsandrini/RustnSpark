-- A random public address per pilot (the profile URL no longer carries the pilot name). The volatile default is
-- evaluated for every existing row, so current pilots get theirs too.
ALTER TABLE "Player" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12);

CREATE UNIQUE INDEX "Player_publicId_key" ON "Player"("publicId");
