import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  closeTestPrismaClient,
  getTestPrismaClient,
  resetDatabase,
} from '../../test/support/test-db.js';

const MIGRATION_SQL = readFileSync(
  new URL('../../prisma/migrations/20261014140000_generic_scrap/migration.sql', import.meta.url),
  'utf8',
);

// The migration is several statements; Postgres runs one per call.
const STATEMENTS = MIGRATION_SQL.split(/;\s*\n/)
  .map((statement) =>
    statement
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((statement) => statement.length > 0);

describe('generic scrap migration', () => {
  const prisma = getTestPrismaClient();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
  });

  async function player(name: string): Promise<string> {
    const account = await prisma.account.create({
      data: {
        email: `${name}@example.com`,
        passwordHash: 'x',
        player: { create: { name, credits: 0, locale: 'en' } },
      },
      include: { player: true },
    });
    return account.player!.id;
  }

  async function oldScrap(id: string, basePrice: number): Promise<void> {
    await prisma.material.create({
      data: {
        id,
        displayName: { en: id, 'pt-BR': id },
        description: { en: id, 'pt-BR': id },
        rarity: 'COMMON',
        basePrice,
        fixedPrice: true,
      },
    });
  }

  it('adds every old scrap a pilot holds into the generic one and removes the old materials', async () => {
    await oldScrap('scrap_hull', 25);
    await oldScrap('scrap_cargo', 20);
    await prisma.material.create({
      data: {
        id: 'common_ore',
        displayName: { en: 'Ore', 'pt-BR': 'Minério' },
        description: { en: 'Ore', 'pt-BR': 'Minério' },
        rarity: 'COMMON',
        basePrice: 4,
      },
    });
    const first = await player('first');
    const second = await player('second');
    await prisma.playerMaterial.createMany({
      data: [
        { playerId: first, materialId: 'scrap_hull', quantity: 3 },
        { playerId: first, materialId: 'scrap_cargo', quantity: 2 },
        { playerId: first, materialId: 'common_ore', quantity: 7 },
        { playerId: second, materialId: 'scrap_cargo', quantity: 4 },
      ],
    });

    for (const statement of STATEMENTS) await prisma.$executeRawUnsafe(statement);

    const held = async (playerId: string, materialId: string) =>
      (
        await prisma.playerMaterial.findUnique({
          where: { playerId_materialId: { playerId, materialId } },
        })
      )?.quantity;
    expect(await held(first, 'scrap')).toBe(5);
    expect(await held(second, 'scrap')).toBe(4);
    // Anything else a pilot holds is untouched.
    expect(await held(first, 'common_ore')).toBe(7);
    expect(await prisma.material.count({ where: { id: { startsWith: 'scrap_' } } })).toBe(0);
    expect(
      await prisma.playerMaterial.count({ where: { materialId: { startsWith: 'scrap_' } } }),
    ).toBe(0);
    const generic = await prisma.material.findUniqueOrThrow({ where: { id: 'scrap' } });
    expect(generic.fixedPrice).toBe(true);
  });

  it('keeps an existing generic scrap and what is already held of it', async () => {
    await oldScrap('scrap_hull', 25);
    await prisma.material.create({
      data: {
        id: 'scrap',
        displayName: { en: 'Scrap', 'pt-BR': 'Sucata' },
        description: { en: 'Scrap', 'pt-BR': 'Sucata' },
        rarity: 'COMMON',
        basePrice: 99,
        fixedPrice: true,
      },
    });
    const pilot = await player('pilot');
    await prisma.playerMaterial.createMany({
      data: [
        { playerId: pilot, materialId: 'scrap', quantity: 2 },
        { playerId: pilot, materialId: 'scrap_hull', quantity: 3 },
      ],
    });

    for (const statement of STATEMENTS) await prisma.$executeRawUnsafe(statement);

    const row = await prisma.playerMaterial.findUniqueOrThrow({
      where: { playerId_materialId: { playerId: pilot, materialId: 'scrap' } },
    });
    expect(row.quantity).toBe(5);
    // An admin-tuned price on the generic material is not overwritten.
    expect((await prisma.material.findUniqueOrThrow({ where: { id: 'scrap' } })).basePrice).toBe(
      99,
    );
  });
});
