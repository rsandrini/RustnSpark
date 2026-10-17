-- Map detail level (phase 5): the map shows `main` places when it is fully zoomed out, `regional` ones when
-- zoomed in and `local` ones when zoomed in close. Every place that exists today is main, except the remote
-- outpost, which is regional.
ALTER TABLE "Location" ADD COLUMN "detail" TEXT NOT NULL DEFAULT 'main';
UPDATE "Location" SET "detail" = 'regional' WHERE "id" = 'ziggy';
