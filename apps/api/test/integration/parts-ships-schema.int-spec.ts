import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  PartInstance: ['id', 'partType', 'ownerPlayerId', 'condition', 'location', 'shipId', 'propRoll'],
  Ship: ['id', 'ownerPlayerId', 'name', 'layout', 'fuel', 'status', 'currentLocationId', 'stance', 'energyMode', 'formatId'],
  PlayerMaterial: ['playerId', 'materialId', 'quantity'],
};

function sortedColumns(record: Record<string, readonly string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(record)) {
    result[table] = [...columns].sort();
  }
  return result;
}

describe('parts and ships data model (S4.1)', () => {
  const prisma = getTestPrismaClient();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
    process.env.NODE_ENV = originalNodeEnv;
  });

  async function seedPrerequisites(): Promise<{
    playerId: string;
    locationId: string;
    partType: string;
    materialId: string;
  }> {
    const account = await prisma.account.create({
      data: {
        email: 's4.1@example.com',
        passwordHash: 'hash',
      },
    });
    const player = await prisma.player.create({
      data: {
        accountId: account.id,
        name: 's4.1-player',
      },
    });
    const faction = await prisma.faction.create({
      data: {
        id: 's4_1_faction',
        displayName: { en: 'Faction', 'pt-BR': 'Facção' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        color: '#000000',
        relations: {},
      },
    });
    const location = await prisma.location.create({
      data: {
        id: 's4_1_loc',
        displayName: { en: 'Loc', 'pt-BR': 'Loc' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        type: 'port',
        x: 0,
        y: 0,
        zone: 0,
        factionId: faction.id,
        isolation: 1,
        mood: 1,
        services: {},
      },
    });
    const partCatalog = await prisma.partCatalog.create({
      data: {
        partType: 's4_1_engine',
        displayName: { en: 'Engine', 'pt-BR': 'Motor' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        partClass: 'ENGINE',
        rarity: 'COMMON',
        w: 1,
        h: 1,
        mass: 1,
        structureCost: 1,
        basePrice: 1,
        scrapValue: 1,
        partHp: 1,
      },
    });
    const material = await prisma.material.create({
      data: {
        id: 's4_1_iron',
        displayName: { en: 'Iron', 'pt-BR': 'Ferro' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        rarity: 'COMMON',
        basePrice: 1,
      },
    });

    return {
      playerId: player.id,
      locationId: location.id,
      partType: partCatalog.partType,
      materialId: material.id,
    };
  }

  it('creates each new table with exactly the planned columns', async () => {
    const tableList = Object.keys(EXPECTED_COLUMNS)
      .map((name) => `'${name}'`)
      .join(', ');
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN (${tableList})`,
    );

    const columnsByTable = new Map<string, string[]>();
    for (const row of rows) {
      const existing = columnsByTable.get(row.table_name);
      if (existing) {
        existing.push(row.column_name);
      } else {
        columnsByTable.set(row.table_name, [row.column_name]);
      }
    }

    const actual: Record<string, string[]> = {};
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      actual[table] = [...(columnsByTable.get(table) ?? [])].sort();
    }

    expect(actual).toEqual(sortedColumns(EXPECTED_COLUMNS));
  });

  it('rejects PartInstance condition outside 0-100', async () => {
    const { playerId, partType } = await seedPrerequisites();

    const tooLow = prisma.partInstance.create({
      data: {
        partType,
        ownerPlayerId: playerId,
        condition: -0.1,
      },
    });
    await expect(tooLow).rejects.toThrow(/check constraint/i);

    const tooHigh = prisma.partInstance.create({
      data: {
        partType,
        ownerPlayerId: playerId,
        condition: 100.1,
      },
    });
    await expect(tooHigh).rejects.toThrow(/check constraint/i);

    const valid = await prisma.partInstance.create({
      data: {
        partType,
        ownerPlayerId: playerId,
        condition: 100,
      },
    });
    expect(valid.condition).toBe(100);
  });

  it('links a PartInstance to at most one Ship', async () => {
    const { playerId, locationId, partType } = await seedPrerequisites();

    const accountB = await prisma.account.create({
      data: {
        email: 's4.1-b@example.com',
        passwordHash: 'hash',
      },
    });
    const playerB = await prisma.player.create({
      data: {
        accountId: accountB.id,
        name: 's4.1-player-b',
      },
    });

    const shipA = await prisma.ship.create({
      data: {
        ownerPlayerId: playerId,
        name: 'Ship A',
        layout: [],
        currentLocationId: locationId,
      },
    });

    const part = await prisma.partInstance.create({
      data: {
        partType,
        ownerPlayerId: playerId,
        condition: 75,
        location: 'INSTALLED',
        shipId: shipA.id,
      },
    });

    const reloaded = await prisma.partInstance.findUnique({
      where: { id: part.id },
      include: { ship: true },
    });
    expect(reloaded?.ship?.id).toBe(shipA.id);

    const shipB = await prisma.ship.create({
      data: {
        ownerPlayerId: playerB.id,
        name: 'Ship B',
        layout: [],
        currentLocationId: locationId,
      },
    });

    const moved = await prisma.partInstance.update({
      where: { id: part.id },
      data: {
        shipId: shipB.id,
      },
    });
    expect(moved.shipId).toBe(shipB.id);

    const final = await prisma.partInstance.findUnique({
      where: { id: part.id },
      include: { ship: true },
    });
    expect(final?.ship?.id).toBe(shipB.id);
    expect(final?.ship?.id).not.toBe(shipA.id);
  });

  it('requires INSTALLED parts to have a ship and INVENTORY parts to have none', async () => {
    const { playerId, partType } = await seedPrerequisites();

    await expect(
      prisma.partInstance.create({
        data: { partType, ownerPlayerId: playerId, condition: 80, location: 'INSTALLED' },
      }),
    ).rejects.toThrow(/check constraint/i);

    const ship = await prisma.ship.create({
      data: {
        ownerPlayerId: playerId,
        name: 'S',
        layout: [],
        currentLocationId: (await prisma.location.findFirstOrThrow()).id,
      },
    });
    await expect(
      prisma.partInstance.create({
        data: {
          partType,
          ownerPlayerId: playerId,
          condition: 80,
          location: 'INVENTORY',
          shipId: ship.id,
        },
      }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('allows several Ships per player (schema supports N; the UI limits it to one)', async () => {
    const { playerId, locationId } = await seedPrerequisites();

    await prisma.ship.create({
      data: {
        ownerPlayerId: playerId,
        name: 'First Ship',
        layout: [],
        currentLocationId: locationId,
      },
    });

    await prisma.ship.create({
      data: {
        ownerPlayerId: playerId,
        name: 'Second Ship',
        layout: [],
        currentLocationId: locationId,
      },
    });
    expect(await prisma.ship.count({ where: { ownerPlayerId: playerId } })).toBe(2);
  });

  it('uses a composite primary key on PlayerMaterial and upserts quantity', async () => {
    const { playerId, materialId } = await seedPrerequisites();

    await prisma.playerMaterial.create({
      data: {
        playerId,
        materialId,
        quantity: 5,
      },
    });

    const duplicate = prisma.playerMaterial.create({
      data: {
        playerId,
        materialId,
        quantity: 3,
      },
    });
    await expect(duplicate).rejects.toThrow(/unique constraint/i);

    await prisma.playerMaterial.update({
      where: {
        playerId_materialId: { playerId, materialId },
      },
      data: {
        quantity: { increment: 4 },
      },
    });

    const row = await prisma.playerMaterial.findUnique({
      where: {
        playerId_materialId: { playerId, materialId },
      },
    });
    expect(row?.quantity).toBe(9);
  });
});
