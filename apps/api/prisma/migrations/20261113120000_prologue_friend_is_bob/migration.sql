-- The opening's friend is Bob (a she), not Kite. The guide was created as 'Kite' by an earlier migration; a pilot who renamed
-- the guide in the Admin keeps their own name (only the original one is replaced).
UPDATE "QuestGiver" SET "name" = 'Bob' WHERE "id" = 'free_mentor_kite' AND "name" = 'Kite';
