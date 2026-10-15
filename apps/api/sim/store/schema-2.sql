-- Simulation store schema, version 2: what the first runs could not answer afterwards.
-- The final kit, where the seconds went, what scavenged parts were worth and how often the ship
-- was repaired are per-run facts the analysis needs; the archetype was only inside the cell name.

ALTER TABLE runs ADD COLUMN archetype TEXT NOT NULL DEFAULT 'chem';
ALTER TABLE runs ADD COLUMN final_parts TEXT;
ALTER TABLE runs ADD COLUMN action_seconds TEXT;
ALTER TABLE runs ADD COLUMN finds_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN foot_scavenges INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN repair_actions INTEGER NOT NULL DEFAULT 0;
