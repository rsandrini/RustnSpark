import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  closeTestPrismaClient,
  getTestPrismaClient,
  resetDatabase,
} from '../../test/support/test-db.js';

const MIGRATION_SQL = readFileSync(
  new URL(
    '../../prisma/migrations/20261014160000_cores_become_fragments/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const STATEMENTS = MIGRATION_SQL.split(/;\s*\n/)
  .map((statement) =>
    statement
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((statement) => statement.length > 0);

describe('cores become fragments migration', () => {
  const prisma = getTestPrismaClient();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
  });

  const material = (id: string, rarity: 'EPIC' | 'LEGENDARY') =>
    prisma.material.create({
      data: {
        id,
        displayName: { en: id, 'pt-BR': id },
        description: { en: id, 'pt-BR': id },
        rarity,
        basePrice: 1,
        fixedPrice: true,
      },
    });

  it('turns held cores back into fragments, removes them and rewrites the tuned config', async () => {
    await material('core_fragment', 'EPIC');
    await material('prototype_core', 'EPIC');
    await material('ancient_core', 'LEGENDARY');
    const account = await prisma.account.create({
      data: {
        email: 'pilot@example.com',
        passwordHash: 'x',
        player: { create: { name: 'pilot', credits: 0, locale: 'en' } },
      },
      include: { player: true },
    });
    const playerId = account.player!.id;
    await prisma.playerMaterial.createMany({
      data: [
        { playerId, materialId: 'core_fragment', quantity: 2 },
        { playerId, materialId: 'prototype_core', quantity: 3 },
        { playerId, materialId: 'ancient_core', quantity: 1 },
      ],
    });
    const config = (key: string, value: object) => ({
      key,
      value,
      type: 'json',
      description: { en: key, 'pt-BR': key },
    });
    await prisma.gameConfig.createMany({
      data: [
        config('economy.upgrade_materials', {
          COMMON: [{ k: 5, mode: 'gap', material: 'scrap' }],
          RARE: [
            { k: 1, mode: 'size', material: 'prototype_core' },
            { k: 6, mode: 'gap', material: 'rare_crystals' },
          ],
          EPIC: [
            { k: 1, mode: 'size', material: 'ancient_core' },
            { k: 2, mode: 'size', material: 'prototype_core' },
          ],
        }),
        config('economy.core_drops', {
          mission: {
            '3': [
              { chance: 0.6, material: 'core_fragment', quantity: 2 },
              { chance: 0.02, material: 'ancient_core', quantity: 1 },
            ],
          },
        }),
        config('economy.core_fragments', { prototype_core: 5, ancient_core: 15 }),
      ],
    });

    for (const statement of STATEMENTS) await prisma.$executeRawUnsafe(statement);

    // 2 held + 3 x 5 + 1 x 15 fragments, and no core left anywhere.
    const fragments = await prisma.playerMaterial.findUniqueOrThrow({
      where: { playerId_materialId: { playerId, materialId: 'core_fragment' } },
    });
    expect(fragments.quantity).toBe(2 + 15 + 15);
    expect(
      await prisma.material.count({ where: { id: { in: ['prototype_core', 'ancient_core'] } } }),
    ).toBe(0);
    expect(
      await prisma.playerMaterial.count({
        where: { materialId: { in: ['prototype_core', 'ancient_core'] } },
      }),
    ).toBe(0);

    const upgrade = await prisma.gameConfig.findUniqueOrThrow({
      where: { key: 'economy.upgrade_materials' },
    });
    expect(upgrade.value).toEqual({
      COMMON: [{ k: 5, mode: 'gap', material: 'scrap' }],
      RARE: [
        { k: 5, mode: 'size', material: 'core_fragment' },
        { k: 6, mode: 'gap', material: 'rare_crystals' },
      ],
      EPIC: [
        { k: 15, mode: 'size', material: 'core_fragment' },
        { k: 10, mode: 'size', material: 'core_fragment' },
      ],
    });
    const drops = await prisma.gameConfig.findUniqueOrThrow({
      where: { key: 'economy.core_drops' },
    });
    expect(drops.value).toEqual({
      mission: {
        '3': [
          { chance: 0.6, material: 'core_fragment', quantity: 2 },
          { chance: 0.02, material: 'core_fragment', quantity: 15 },
        ],
      },
    });
    expect(await prisma.gameConfig.count({ where: { key: 'economy.core_fragments' } })).toBe(0);
  });
});
