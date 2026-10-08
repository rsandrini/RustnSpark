-- MissionType.RACE: a competition against 3-5 generated rival ships (their speeds live in the
-- instance's cargo.race, frozen at generation); the player's finishing place decides the prize.
ALTER TYPE "MissionType" ADD VALUE IF NOT EXISTS 'RACE';
