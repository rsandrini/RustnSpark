-- GDD §8: delivery and transport missions flee an attacker when they can (and fight only when the
-- escape fails). The seeded templates carried an empty policy, so nothing ever fled. Only empty
-- policies are filled: a policy an owner edited is left alone.
UPDATE "MissionTemplate" SET "encounterPolicy" = '{"missionForcesFlee": true}'::jsonb
  WHERE "type" IN ('DELIVERY', 'TRANSPORT') AND "encounterPolicy" = '{}'::jsonb;
