-- The armed starter's weapon drains power and the five-part kit had none to spare: the ship flew
-- with a cruise power shortfall. A small solar reactor joins the kit (only where the tuned value
-- still holds one of the two earlier defaults).

UPDATE "GameConfig"
SET "value" = '["bridge","engine_chem_small","tank_small","cargo","hull","weapon_ballistic","reactor_solar"]'::jsonb
WHERE "key" = 'onboarding.starter_parts'
  AND "value" IN (
    '["bridge","engine_chem_small","tank_small","cargo","hull"]'::jsonb,
    '["bridge","engine_chem_small","tank_small","cargo","hull","weapon_ballistic"]'::jsonb
  );
