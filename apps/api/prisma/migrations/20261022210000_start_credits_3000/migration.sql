-- A new pilot starts with 3000 credits, not 7500 (owner playtest 2026-10-22: far too much for a first flight).
-- Enough for a first tank and a little over; the first real mission pays the rest.
UPDATE "GameConfig" SET "value" = '3000'::jsonb WHERE "key" = 'economy.start_credits';
