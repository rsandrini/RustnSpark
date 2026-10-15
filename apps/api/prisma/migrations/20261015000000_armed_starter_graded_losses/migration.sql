-- P2 simulation findings (2026-10-15): with the draw gone, a new pilot (no weapon) lost almost
-- every fight and a loss cost ~725 credits of repair. Two tuned values follow the new defaults,
-- only where they still hold the old default (an Admin-tuned value is left alone):
--   - the starter kit gets a basic ballistic weapon, so early fights can be won;
--   - a lost fight puts the bridge at risk only from zone 3 (was 2).

UPDATE "GameConfig"
SET "value" = '["bridge","engine_chem_small","tank_small","cargo","hull","weapon_ballistic"]'::jsonb
WHERE "key" = 'onboarding.starter_parts'
  AND "value" = '["bridge","engine_chem_small","tank_small","cargo","hull"]'::jsonb;

UPDATE "GameConfig"
SET "value" = '3'::jsonb
WHERE "key" = 'combat.loss_bridge_wear_min_zone' AND "value" = '2'::jsonb;
