-- The far deep fields drop a mix of ores by their own row of mining.place_mix (v0.1.3), not only rare
-- crystals: the mining template no longer pins one. Only the seeded template is touched.
UPDATE "MissionTemplate"
  SET "requirements" = "requirements" - 'materialIds',
      "description" = '{"en": "Dig ore out of a far, hostile field. The trip is long, and the field gives the best share of rare crystals anywhere.", "pt-BR": "Escave minério em um campo distante e hostil. A viagem é longa, e o campo dá a maior parte de cristais raros de todos."}'::jsonb
  WHERE "id" = 'mining_far_crystals';
