-- Owner debug switch, per account (round-2 playtest follow-up: a global flag would speed up
-- every player's jobs, which the owner explicitly rejected). Off for everyone by default.
ALTER TABLE "Player" ADD COLUMN "debugFastOps" BOOLEAN NOT NULL DEFAULT false;
