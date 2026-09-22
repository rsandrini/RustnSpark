-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "PartClass" AS ENUM ('ENGINE', 'TANK', 'BATTERY', 'REACTOR', 'WEAPON', 'DEFENSE', 'CARGO', 'SENSOR', 'UTILITY', 'BRIDGE');

-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('DELIVERY', 'TRANSPORT', 'ESCORT', 'MINING', 'RESCUE');

-- CreateTable
CREATE TABLE "GameConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "description" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "GameConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TuningRevision" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,

    CONSTRAINT "TuningRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulesSnapshot" (
    "hash" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulesSnapshot_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "color" TEXT NOT NULL,
    "playable" BOOLEAN NOT NULL DEFAULT false,
    "relations" JSONB NOT NULL,
    "starterKitHint" JSONB,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "level" INTEGER NOT NULL,
    "fuelMult" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "subsystemTarget" TEXT,
    "mitigatingPart" TEXT,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "zone" INTEGER NOT NULL,
    "factionId" TEXT NOT NULL,
    "isolation" DOUBLE PRECISION NOT NULL,
    "mood" DOUBLE PRECISION NOT NULL,
    "services" JSONB NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "nodeAId" TEXT NOT NULL,
    "nodeBId" TEXT NOT NULL,
    "distance" INTEGER NOT NULL,
    "danger" INTEGER NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteEnvironment" (
    "routeId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "RouteEnvironment_pkey" PRIMARY KEY ("routeId","environmentId","order")
);

-- CreateTable
CREATE TABLE "PartCatalog" (
    "partType" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "partClass" "PartClass" NOT NULL,
    "rarity" "Rarity" NOT NULL,
    "w" INTEGER NOT NULL,
    "h" INTEGER NOT NULL,
    "mass" DOUBLE PRECISION NOT NULL,
    "structureCost" INTEGER NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "scrapValue" INTEGER NOT NULL,
    "partHp" INTEGER NOT NULL,
    "pot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pdf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bli" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "esc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sen" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "min" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "energyCont" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "energyCombat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fuelCap" INTEGER,
    "fuelUse" DOUBLE PRECISION,
    "batCharge" DOUBLE PRECISION,
    "batOutput" DOUBLE PRECISION,
    "batInput" DOUBLE PRECISION,
    "specialProp" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PartCatalog_pkey" PRIMARY KEY ("partType")
);

-- CreateTable
CREATE TABLE "MissionTemplate" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "type" "MissionType" NOT NULL,
    "factionId" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "rewardCalc" JSONB NOT NULL,
    "deadlineCalc" JSONB NOT NULL,
    "encounterPolicy" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MissionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DropTable" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,

    CONSTRAINT "DropTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "rarity" "Rarity" NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RulesSnapshot_createdAt_idx" ON "RulesSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "Location_factionId_idx" ON "Location"("factionId");

-- CreateIndex
CREATE INDEX "Route_nodeBId_idx" ON "Route"("nodeBId");

-- CreateIndex
CREATE UNIQUE INDEX "Route_nodeAId_nodeBId_key" ON "Route"("nodeAId", "nodeBId");

-- CreateIndex
CREATE INDEX "RouteEnvironment_environmentId_idx" ON "RouteEnvironment"("environmentId");

-- CreateIndex
CREATE INDEX "MissionTemplate_factionId_idx" ON "MissionTemplate"("factionId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_nodeAId_fkey" FOREIGN KEY ("nodeAId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_nodeBId_fkey" FOREIGN KEY ("nodeBId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEnvironment" ADD CONSTRAINT "RouteEnvironment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEnvironment" ADD CONSTRAINT "RouteEnvironment_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionTemplate" ADD CONSTRAINT "MissionTemplate_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheck
ALTER TABLE "Location" ADD CONSTRAINT "Location_zone_check" CHECK ("zone" BETWEEN 0 AND 3);

-- AddCheck
ALTER TABLE "Route" ADD CONSTRAINT "Route_danger_check" CHECK ("danger" BETWEEN 0 AND 10);

-- AddCheck
ALTER TABLE "Material" ADD CONSTRAINT "Material_basePrice_check" CHECK ("basePrice" > 0);
