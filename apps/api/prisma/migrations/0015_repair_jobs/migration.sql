-- One PENDING repair per ship (partial unique; Prisma PSL cannot express WHERE).
-- Concurrent repair.start transactions that skip the Ship FOR UPDATE lock still
-- collide here; the API maps P2002 to 409 ALREADY_REPAIRING.
CREATE UNIQUE INDEX "RepairJob_one_pending_ship_idx"
  ON "RepairJob"("shipId")
  WHERE "status" = 'PENDING';
