-- Add ship energy distribution mode (battery-only / full / override).
-- Default is FULL so every existing ship keeps behaving as if reactor surplus
-- can also feed combat systems.
ALTER TABLE "Ship" ADD COLUMN "energyMode" TEXT NOT NULL DEFAULT 'FULL';
