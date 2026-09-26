-- Travel without a quest: a pilot-requested trip is a mission of its own type (no cargo, no
-- reward). Its template row is seeded by seed-data/mission-templates.ts (a new enum value
-- cannot be used in the transaction that adds it).
ALTER TYPE "MissionType" ADD VALUE IF NOT EXISTS 'TRAVEL';
