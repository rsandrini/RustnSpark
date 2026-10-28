-- CreateTable
CREATE TABLE "ShipRating" (
    "playerId" VARCHAR(36) NOT NULL,
    "shipId" VARCHAR(36) NOT NULL,
    "power" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "firepower" DOUBLE PRECISION NOT NULL,
    "armor" DOUBLE PRECISION NOT NULL,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipRating_pkey" PRIMARY KEY ("playerId")
);

-- CreateIndex
CREATE INDEX "ShipRating_power_idx" ON "ShipRating"("power");

-- CreateIndex
CREATE INDEX "ShipRating_speed_idx" ON "ShipRating"("speed");

-- AddForeignKey
ALTER TABLE "ShipRating" ADD CONSTRAINT "ShipRating_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
