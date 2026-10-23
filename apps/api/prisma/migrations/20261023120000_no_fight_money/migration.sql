-- A won fight no longer pays credits (owner 2026-10-23: pilots are not pirates; a fight is mostly bad news).
-- A scavenging job that met pirates paid 2000+ for the win, more than most missions. The knobs stay for later exceptions.
UPDATE "GameConfig" SET "value" = '0'::jsonb WHERE "key" IN ('economy.combat_win_base', 'economy.combat_win_per_tier');
