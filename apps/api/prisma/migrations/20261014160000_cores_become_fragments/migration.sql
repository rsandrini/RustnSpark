-- Cores are gone (2026-10-14 P0 review): they were one more thing to manage. Upgrades ask for core
-- fragments directly (a prototype core was 5 fragments, an ancient core 15) and nothing is crafted
-- any more. What a pilot holds is converted back to fragments, the two core materials are removed
-- and the tuned config that named them is rewritten in fragments.

-- 1) Holdings: prototype core -> 5 fragments, ancient core -> 15, added to what is already held.
INSERT INTO "PlayerMaterial" ("playerId", "materialId", "quantity")
SELECT "playerId", 'core_fragment',
       SUM(CASE "materialId" WHEN 'prototype_core' THEN "quantity" * 5 ELSE "quantity" * 15 END)
FROM "PlayerMaterial"
WHERE "materialId" IN ('prototype_core', 'ancient_core')
GROUP BY "playerId"
ON CONFLICT ("playerId", "materialId")
DO UPDATE SET "quantity" = "PlayerMaterial"."quantity" + EXCLUDED."quantity";

DELETE FROM "PlayerMaterial" WHERE "materialId" IN ('prototype_core', 'ancient_core');
DELETE FROM "Material" WHERE "id" IN ('prototype_core', 'ancient_core');

-- 2) economy.upgrade_materials: a core need becomes the same need in fragments (k x 5 or x 15).
UPDATE "GameConfig"
SET "value" = (
  SELECT jsonb_object_agg(
    rarity.key,
    (
      SELECT jsonb_agg(
        CASE rule->>'material'
          WHEN 'prototype_core' THEN
            jsonb_set(jsonb_set(rule, '{material}', '"core_fragment"'), '{k}', to_jsonb((rule->>'k')::numeric * 5))
          WHEN 'ancient_core' THEN
            jsonb_set(jsonb_set(rule, '{material}', '"core_fragment"'), '{k}', to_jsonb((rule->>'k')::numeric * 15))
          ELSE rule
        END
        ORDER BY ordinality
      )
      FROM jsonb_array_elements(rarity.value) WITH ORDINALITY AS rules(rule, ordinality)
    )
  )
  FROM jsonb_each("GameConfig"."value") AS rarity
)
WHERE "key" = 'economy.upgrade_materials'
  AND "value"::text ~ '(prototype_core|ancient_core)';

-- 3) economy.core_drops: a core drop becomes a drop of the fragments it was worth.
UPDATE "GameConfig"
SET "value" = (
  SELECT jsonb_object_agg(
    source.key,
    (
      SELECT jsonb_object_agg(
        zone.key,
        (
          SELECT jsonb_agg(
            CASE drop->>'material'
              WHEN 'prototype_core' THEN
                jsonb_set(jsonb_set(drop, '{material}', '"core_fragment"'), '{quantity}', to_jsonb((drop->>'quantity')::numeric * 5))
              WHEN 'ancient_core' THEN
                jsonb_set(jsonb_set(drop, '{material}', '"core_fragment"'), '{quantity}', to_jsonb((drop->>'quantity')::numeric * 15))
              ELSE drop
            END
            ORDER BY ordinality
          )
          FROM jsonb_array_elements(zone.value) WITH ORDINALITY AS drops(drop, ordinality)
        )
      )
      FROM jsonb_each(source.value) AS zone
    )
  )
  FROM jsonb_each("GameConfig"."value") AS source
)
WHERE "key" = 'economy.core_drops'
  AND "value"::text ~ '(prototype_core|ancient_core)';

-- 4) The crafting recipe has nothing left to say.
DELETE FROM "GameConfig" WHERE "key" = 'economy.core_fragments';
