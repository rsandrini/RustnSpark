-- How the new-pilot opening ended (null = it has not; then played or skipped, and it never shows again).
ALTER TABLE "Player" ADD COLUMN "prologueOutcome" TEXT;
