-- A new pilot starts with the money for a basic shield (400) and a small battery (150) on top of the
-- old 200, to spend as they like (the market tip recommends both). Only moves a database that still
-- has the old default, so a value tuned in the Admin is left alone.
UPDATE "GameConfig" SET "value" = '750'::jsonb
WHERE "key" = 'economy.start_credits' AND "value" = '200'::jsonb;
