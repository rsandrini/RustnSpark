-- Ship.chemLevel / ionLevel: engine tuning set on the bridge. 1 = the engines as listed;
-- below throttles down (saves fuel and power), above pushes (faster, dearer, can fail).
ALTER TABLE "Ship" ADD COLUMN "chemLevel" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "Ship" ADD COLUMN "ionLevel" DOUBLE PRECISION NOT NULL DEFAULT 1;
