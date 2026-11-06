-- An escort to a safe port: where it takes the ship and when it arrives (the ship is ON_MISSION meanwhile).
ALTER TABLE "Ship" ADD COLUMN "escortToId" TEXT;
ALTER TABLE "Ship" ADD COLUMN "escortArrivesAt" TIMESTAMP(3);
