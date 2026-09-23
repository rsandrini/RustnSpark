-- CreateEnum
CREATE TYPE "PartLocation" AS ENUM ('INVENTORY', 'INSTALLED');

-- CreateEnum
CREATE TYPE "ShipStatus" AS ENUM ('IN_PORT', 'ON_MISSION', 'ADRIFT');

-- CreateEnum
CREATE TYPE "ShipStance" AS ENUM ('DEFENSIVE', 'NEUTRAL', 'AGGRESSIVE');

-- CreateTable
CREATE TABLE "PartInstance" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "partType" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "condition" DOUBLE PRECISION NOT NULL,
    "location" "PartLocation" NOT NULL DEFAULT 'INVENTORY',
    "shipId" TEXT,
    "propRoll" JSONB,

    CONSTRAINT "PartInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ship" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "ownerPlayerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "fuel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ShipStatus" NOT NULL DEFAULT 'IN_PORT',
    "currentLocationId" TEXT NOT NULL,
    "stance" "ShipStance" NOT NULL DEFAULT 'NEUTRAL',

    CONSTRAINT "Ship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMaterial" (
    "playerId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlayerMaterial_pkey" PRIMARY KEY ("playerId","materialId")
);

-- CreateIndex
CREATE INDEX "PartInstance_ownerPlayerId_location_idx" ON "PartInstance"("ownerPlayerId", "location");

-- CreateIndex
CREATE INDEX "PartInstance_shipId_idx" ON "PartInstance"("shipId");

-- CreateIndex
CREATE UNIQUE INDEX "Ship_ownerPlayerId_key" ON "Ship"("ownerPlayerId");

-- CreateIndex
CREATE INDEX "Ship_currentLocationId_idx" ON "Ship"("currentLocationId");

-- AddForeignKey
ALTER TABLE "PartInstance" ADD CONSTRAINT "PartInstance_partType_fkey" FOREIGN KEY ("partType") REFERENCES "PartCatalog"("partType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartInstance" ADD CONSTRAINT "PartInstance_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartInstance" ADD CONSTRAINT "PartInstance_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ship" ADD CONSTRAINT "Ship_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ship" ADD CONSTRAINT "Ship_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMaterial" ADD CONSTRAINT "PlayerMaterial_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMaterial" ADD CONSTRAINT "PlayerMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheck
ALTER TABLE "PartInstance" ADD CONSTRAINT "PartInstance_condition_check" CHECK ("condition" BETWEEN 0 AND 100);
