-- Guest accounts: a pilot with no email and password, signed in again by a key the browser keeps.
-- FROZEN is where an idle unclaimed guest rests (nothing is deleted).
ALTER TYPE "AccountStatus" ADD VALUE 'FROZEN';

ALTER TABLE "Account" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN "guestKeyHash" TEXT;
CREATE UNIQUE INDEX "Account_guestKeyHash_key" ON "Account"("guestKeyHash");
