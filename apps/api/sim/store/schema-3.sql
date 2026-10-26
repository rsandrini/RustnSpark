-- Simulation store schema, version 3: where the wear and the repair money go, by part.
-- `part_wear` was created in v1 but never written. A row is one part in one event:
-- kind 'wear' = condition points lost in a mission (seq = the mission count at that moment);
-- kind 'repair' = points restored and the credits that part's share of the bill came to
-- (seq = the repair action count); the port's maintenance fee is a 'repair' row of class MAINT.

ALTER TABLE part_wear ADD COLUMN kind TEXT NOT NULL DEFAULT 'wear';
ALTER TABLE part_wear ADD COLUMN cost INTEGER NOT NULL DEFAULT 0;
CREATE INDEX part_wear_run ON part_wear(run_id, kind);
