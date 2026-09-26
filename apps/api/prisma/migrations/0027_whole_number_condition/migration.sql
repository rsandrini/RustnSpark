-- Part condition is a whole percent from now on (the resolve service rounds when it stores wear).
-- A stored 79.6 that the screen showed as 80 made "no change" repairs cost money; existing rows are
-- rounded once here so the old fractions stop showing up.
UPDATE "PartInstance" SET "condition" = ROUND("condition") WHERE "condition" <> ROUND("condition");
