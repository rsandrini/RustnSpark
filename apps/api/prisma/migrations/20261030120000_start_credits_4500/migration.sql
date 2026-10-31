-- A new pilot starts with 4500 credits, not 3000: 3000 did not cover the first repairs
-- (owner playtest 2026-10-30).
UPDATE "GameConfig" SET "value" = '4500'::jsonb WHERE "key" = 'economy.start_credits';
