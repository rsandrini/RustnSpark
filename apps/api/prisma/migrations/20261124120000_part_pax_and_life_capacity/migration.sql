-- Passenger seats (pax) on the cabin tiers and the people a life-support module keeps alive (lifeCap). The seed only
-- fills empty tables, so existing parts get the defaults here. Idempotent, and a value an admin already set is kept.
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('pax', 2) WHERE "partType" = 'passenger_cabin' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'pax');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('pax', 3) WHERE "partType" = 'passenger_cabin_uncommon' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'pax');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('pax', 4) WHERE "partType" = 'passenger_cabin_rare' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'pax');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('pax', 6) WHERE "partType" = 'passenger_cabin_epic' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'pax');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('pax', 8) WHERE "partType" = 'passenger_cabin_legendary' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'pax');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('lifeCap', 3) WHERE "partType" = 'life_support' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'lifeCap');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('lifeCap', 4) WHERE "partType" = 'life_support_uncommon' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'lifeCap');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('lifeCap', 6) WHERE "partType" = 'life_support_rare' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'lifeCap');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('lifeCap', 8) WHERE "partType" = 'life_support_epic' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'lifeCap');
UPDATE "PartCatalog" SET "specialProp" = COALESCE("specialProp", '{}'::jsonb) || jsonb_build_object('lifeCap', 10) WHERE "partType" = 'life_support_legendary' AND NOT (COALESCE("specialProp", '{}'::jsonb) ? 'lifeCap');
