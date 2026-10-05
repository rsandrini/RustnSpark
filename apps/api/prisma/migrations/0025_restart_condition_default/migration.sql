-- D41: the restart kit's worst-case sell value must stay below the rescue cost, and the Admin
-- tuning layer refuses ANY config edit while it does not. The factory default was lowered from 50
-- to 30 for exactly that reason, but databases seeded earlier still hold 50 (the database wins
-- over factory defaults), which blocked every Admin edit. Move it only while it still holds the
-- old default: a value the owner chose themselves is left alone.
UPDATE "GameConfig" SET "value" = '30'::jsonb
  WHERE "key" = 'parts.restart_condition_max' AND "value" = '50'::jsonb;
