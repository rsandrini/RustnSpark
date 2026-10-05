-- Ship Format: an admin-drawn set of grid cells a player picks independently of their bridge,
-- gated by that bridge's rarity (2026-10-02-ship-format-design.md). Purely spatial — no stats
-- of its own. classic_square reproduces today's exact 20x20 grid so no existing ship changes
-- shape; every existing Ship is backfilled onto it by its new column's own default.
--
-- classic_square's row is inserted HERE, not left to seed-data: this database already has
-- existing Ship rows (this is a running dev environment, not a fresh install), and Postgres
-- validates a new FOREIGN KEY constraint against every existing row in the same statement —
-- the ADD CONSTRAINT below would fail immediately if classic_square didn't already exist by
-- then. seed-data/ship-formats.ts (Step 3) still runs this same insert, idempotently, purely
-- so a from-scratch `prisma migrate deploy && prisma db seed` on a fresh database documents
-- the format the same way every other seeded catalog row is documented in seed-data/ — but
-- the migration itself cannot depend on seed-data having already run.

CREATE TABLE "ShipFormat" (
    "id" TEXT NOT NULL,
    "displayName" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "cells" JSONB NOT NULL,
    "minRarity" "Rarity" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShipFormat_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ShipFormat" ("id", "displayName", "description", "cells", "minRarity", "active")
VALUES (
    'classic_square',
    '{"en": "Classic Square", "pt-BR": "Quadrado Clássico"}',
    '{"en": "The original 20x20 assembly grid, unlocked from the start.", "pt-BR": "A grade de montagem 20x20 original, disponível desde o início."}',
    (
        SELECT jsonb_agg(jsonb_build_array(x.n, y.n))
        FROM generate_series(-10, 9) AS x(n), generate_series(-10, 9) AS y(n)
    ),
    'COMMON',
    true
);

ALTER TABLE "Ship" ADD COLUMN "formatId" TEXT NOT NULL DEFAULT 'classic_square';

ALTER TABLE "Ship" ADD CONSTRAINT "Ship_formatId_fkey"
    FOREIGN KEY ("formatId") REFERENCES "ShipFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
