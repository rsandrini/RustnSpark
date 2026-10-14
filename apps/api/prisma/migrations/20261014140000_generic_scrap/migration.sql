-- Scrap becomes one generic material (2026-10-14 scrap review). Until now every part type had
-- its own scrap material ("scrap_<partType>") with its own price, which nobody could tell apart:
-- an upgrade took "any scrap" anyway. Everything a pilot holds of the old materials is added
-- up into the generic one and the old materials go away.

INSERT INTO "Material" ("id", "displayName", "description", "rarity", "basePrice", "fixedPrice", "active")
VALUES (
  'scrap',
  '{"en": "Scrap", "pt-BR": "Sucata"}'::jsonb,
  '{"en": "Worn-out remains of ship parts. Upgrades ask for it, and any port buys it for a fixed price.", "pt-BR": "Restos gastos de peças de nave. Melhorias pedem sucata, e qualquer porto compra por um preço fixo."}'::jsonb,
  'COMMON',
  10,
  true,
  true
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "PlayerMaterial" ("playerId", "materialId", "quantity")
SELECT "playerId", 'scrap', SUM("quantity")
FROM "PlayerMaterial"
WHERE "materialId" LIKE 'scrap\_%'
GROUP BY "playerId"
ON CONFLICT ("playerId", "materialId")
DO UPDATE SET "quantity" = "PlayerMaterial"."quantity" + EXCLUDED."quantity";

DELETE FROM "PlayerMaterial" WHERE "materialId" LIKE 'scrap\_%';
DELETE FROM "Material" WHERE "id" LIKE 'scrap\_%';
