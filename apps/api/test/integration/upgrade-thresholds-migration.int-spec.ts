import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  getTestPrismaClient,
  resetDatabase,
  closeTestPrismaClient,
} from '../../test/support/test-db.js';
import { seedGameConfig } from '../../prisma/seed-data/game-config.js';

const MIGRATION_SQL = readFileSync(
  new URL(
    '../../prisma/migrations/0008_lower_upgrade_cost_thresholds/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

const OLD_DEFAULT = { 2: 2500, 3: 7000, 4: 16000, 5: 32000 };
const NEW_DEFAULT = { 2: 1200, 3: 2000, 4: 2800, 5: 3800 };

describe('lower upgrade cost thresholds migration', () => {
  const prisma = getTestPrismaClient();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedGameConfig(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
  });

  it('updates the old factory default to the new default', async () => {
    await prisma.gameConfig.update({
      where: { key: 'economy.upgrade_costs' },
      data: { value: OLD_DEFAULT },
    });

    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    const row = await prisma.gameConfig.findUniqueOrThrow({
      where: { key: 'economy.upgrade_costs' },
    });
    expect(row.value).toEqual(NEW_DEFAULT);
  });

  it('does not overwrite a custom admin value', async () => {
    const custom = { 2: 500, 3: 1000, 4: 1500, 5: 2000 };
    await prisma.gameConfig.update({
      where: { key: 'economy.upgrade_costs' },
      data: { value: custom },
    });

    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    const row = await prisma.gameConfig.findUniqueOrThrow({
      where: { key: 'economy.upgrade_costs' },
    });
    expect(row.value).toEqual(custom);
  });
});
