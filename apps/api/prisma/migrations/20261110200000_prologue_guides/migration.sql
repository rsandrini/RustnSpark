-- The non-playable 'free' faction and its three mentor guides for the new-pilot opening.
-- The 'free' faction is allowed more than one active MENTOR so Kite, Dara and Oren can coexist.
DROP INDEX IF EXISTS "QuestGiver_one_active_mentor_idx";
CREATE UNIQUE INDEX "QuestGiver_one_active_mentor_idx" ON "QuestGiver"("factionId") WHERE "role" = 'MENTOR' AND "active" = true AND "factionId" <> 'free';

-- The free faction: pilots with no flag yet.
INSERT INTO "Faction" ("id", "displayName", "description", "color", "playable", "relations")
VALUES (
  'free',
  '{"en": "Free pilots", "pt-BR": "Pilotos livres"}',
  '{"en": "Pilots who fly under no flag, until the moment they choose one.", "pt-BR": "Pilotos que voam sob nenhuma bandeira, até o momento de escolher uma."}',
  '#9ca3af',
  false,
  '{"luna": "neutral", "sun": "neutral", "explorers": "neutral", "pirates": "neutral", "free": "neutral"}'
)
ON CONFLICT ("id") DO NOTHING;

-- The three prologue guides. They have no locations, so they never appear on ordinary mission boards.
INSERT INTO "QuestGiver" (
  "id", "factionId", "role", "active", "name", "title",
  "personality", "lines", "locationIds", "weight", "scenes"
)
VALUES
  (
    'free_mentor_kite', 'free', 'MENTOR', true, 'Kite',
    '{"en": "Free pilot", "pt-BR": "Piloto livre"}',
    '{"types": {"RACE": 1}, "minZone": 0, "maxZone": 0, "tone": "friendly"}',
    '{}', '{}', 10, '[]'
  ),
  (
    'free_mentor_dara', 'free', 'MENTOR', true, 'Dara Voss',
    '{"en": "Rescue crew chief", "pt-BR": "Chefe da equipe de resgate"}',
    '{"types": {"RESCUE": 1}, "minZone": 0, "maxZone": 0, "tone": "calm"}',
    '{}', '{}', 10, '[]'
  ),
  (
    'free_mentor_oren', 'free', 'MENTOR', true, 'Marshal Oren',
    '{"en": "Harbour office", "pt-BR": "Escritório portuário"}',
    '{"types": {"DELIVERY": 1}, "minZone": 0, "maxZone": 0, "tone": "formal"}',
    '{}', '{}', 10, '[]'
  )
ON CONFLICT ("id") DO NOTHING;
