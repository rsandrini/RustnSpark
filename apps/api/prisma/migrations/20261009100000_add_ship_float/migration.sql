-- A ship that ran out of fuel floats where it stopped: on a route, between the node it left and the
-- next one, `floatProgress` of the way along (0..1). `rescueAt` is when a waiting rescue arrives.
ALTER TABLE "Ship" ADD COLUMN "floatRouteId" TEXT;
ALTER TABLE "Ship" ADD COLUMN "floatFromId" TEXT;
ALTER TABLE "Ship" ADD COLUMN "floatProgress" DOUBLE PRECISION;
ALTER TABLE "Ship" ADD COLUMN "rescueAt" TIMESTAMP(3);
