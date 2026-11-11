-- New accounts start in Brazilian Portuguese (existing players keep their own language).
ALTER TABLE "Player" ALTER COLUMN "locale" SET DEFAULT 'pt-BR';
