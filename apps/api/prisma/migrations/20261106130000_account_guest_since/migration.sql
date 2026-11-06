-- When the account began as a guest. It stays after the guest claims the pilot, so the daily count of new guests is true.
ALTER TABLE "Account" ADD COLUMN "guestSince" TIMESTAMP(3);
