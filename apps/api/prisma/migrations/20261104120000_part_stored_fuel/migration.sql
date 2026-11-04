-- Fuel that goes with a fuel tank when it is taken off the ship: it comes back aboard when the tank
-- is installed again (up to what the ship can hold).
ALTER TABLE "PartInstance" ADD COLUMN "storedFuel" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PartInstance" ADD CONSTRAINT "PartInstance_storedFuel_check" CHECK ("storedFuel" >= 0);
