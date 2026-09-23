import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

// Exact column sets for every new table introduced by S3.1. These are the DB column names, which
// match the PascalCase model names because the project keeps the same convention as S2.
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  GameConfig: ['key', 'value', 'type', 'description', 'updatedAt', 'updatedBy'],
  TuningRevision: ['id', 'at', 'actor', 'entityType', 'entityId', 'before', 'after', 'reason'],
  RulesSnapshot: ['hash', 'rules', 'createdAt'],
  Faction: ['id', 'displayName', 'description', 'color', 'playable', 'relations', 'starterKitHint'],
  Environment: ['id', 'displayName', 'description', 'level', 'fuelMult', 'subsystemTarget', 'mitigatingPart'],
  Location: ['id', 'displayName', 'description', 'type', 'x', 'y', 'zone', 'factionId', 'isolation', 'mood', 'services'],
  Route: ['id', 'nodeAId', 'nodeBId', 'distance', 'danger'],
  RouteEnvironment: ['routeId', 'environmentId', 'order'],
  PartCatalog: [
    'partType',
    'displayName',
    'description',
    'partClass',
    'rarity',
    'w',
    'h',
    'mass',
    'structureCost',
    'basePrice',
    'scrapValue',
    'partHp',
    'pot',
    'pdf',
    'bli',
    'esc',
    'sen',
    'crg',
    'min',
    'energyCont',
    'energyCombat',
    'fuelCap',
    'fuelUse',
    'batCharge',
    'batOutput',
    'batInput',
    'specialProp',
    'active',
  ],
  MissionTemplate: ['id', 'displayName', 'description', 'type', 'factionId', 'requirements', 'rewardCalc', 'deadlineCalc', 'encounterPolicy', 'active'],
  DropTable: ['id', 'source', 'tiers'],
  Material: ['id', 'displayName', 'description', 'rarity', 'basePrice', 'active'],
};

const LOCALE_MAP = JSON.stringify({ en: 'English', 'pt-BR': 'Português' });

function sortedColumns(record: Record<string, readonly string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(record)) {
    result[table] = [...columns].sort();
  }
  return result;
}

describe('config and world data model (S3.1)', () => {
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

  it('rejects CHECK constraint violations', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Faction" (id, "displayName", "description", color, "relations")
       VALUES ('test_faction', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, '#000000', '{}'::jsonb)`,
    );

    const locationViolation = prisma.$executeRawUnsafe(
      `INSERT INTO "Location" (id, "displayName", "description", type, x, y, zone, "factionId", isolation, mood, services)
       VALUES ('bad_zone', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'port', 0, 0, 4, 'test_faction', 1.0, 1.0, '{}'::jsonb)`,
    );
    await expect(locationViolation).rejects.toThrow(/check constraint/i);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Location" (id, "displayName", "description", type, x, y, zone, "factionId", isolation, mood, services)
       VALUES ('loc_a', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'port', 0, 0, 0, 'test_faction', 1.0, 1.0, '{}'::jsonb)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Location" (id, "displayName", "description", type, x, y, zone, "factionId", isolation, mood, services)
       VALUES ('loc_b', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'port', 1, 1, 0, 'test_faction', 1.0, 1.0, '{}'::jsonb)`,
    );

    const routeViolation = prisma.$executeRawUnsafe(
      `INSERT INTO "Route" (id, "nodeAId", "nodeBId", distance, danger)
       VALUES ('a-b', 'loc_a', 'loc_b', 10, 11)`,
    );
    await expect(routeViolation).rejects.toThrow(/check constraint/i);

    const materialViolation = prisma.$executeRawUnsafe(
      `INSERT INTO "Material" (id, "displayName", "description", rarity, "basePrice")
       VALUES ('bad_price', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'COMMON', 0)`,
    );
    await expect(materialViolation).rejects.toThrow(/check constraint/i);
  });

  it('stores locale maps with both en and pt-BR keys for every player-visible row', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Faction" (id, "displayName", "description", color, "relations")
       VALUES ('locale_faction', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, '#ffffff', '{}'::jsonb)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Environment" (id, "displayName", "description", level, "fuelMult")
       VALUES ('locale_env', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 1, 1.0)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Location" (id, "displayName", "description", type, x, y, zone, "factionId", isolation, mood, services)
       VALUES ('locale_loc', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'port', 0, 0, 0, 'locale_faction', 1.0, 1.0, '{}'::jsonb)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Route" (id, "nodeAId", "nodeBId", distance, danger)
       VALUES ('locale_route', 'locale_loc', 'locale_loc', 5, 0)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RouteEnvironment" ("routeId", "environmentId", "order")
       VALUES ('locale_route', 'locale_env', 0)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PartCatalog" ("partType", "displayName", "description", "partClass", rarity, w, h, mass, "structureCost", "basePrice", "scrapValue", "partHp")
       VALUES ('locale_part', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'ENGINE', 'COMMON', 1, 1, 1.0, 1, 1, 1, 1)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MissionTemplate" (id, "displayName", "description", type, "factionId", requirements, "rewardCalc", "deadlineCalc", "encounterPolicy")
       VALUES ('locale_mission', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'DELIVERY', 'locale_faction', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Material" (id, "displayName", "description", rarity, "basePrice")
       VALUES ('locale_material', '${LOCALE_MAP}'::jsonb, '${LOCALE_MAP}'::jsonb, 'COMMON', 1)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GameConfig" (key, value, type, description, "updatedAt", "updatedBy")
       VALUES ('locale_test', '1'::jsonb, 'integer', '${LOCALE_MAP}'::jsonb, CURRENT_TIMESTAMP, 'test')`,
    );

    const tables = [
      { name: 'Faction', columns: ['displayName', 'description'], where: "id = 'locale_faction'" },
      { name: 'Environment', columns: ['displayName', 'description'], where: "id = 'locale_env'" },
      { name: 'Location', columns: ['displayName', 'description'], where: "id = 'locale_loc'" },
      { name: 'PartCatalog', columns: ['displayName', 'description'], where: "\"partType\" = 'locale_part'" },
      { name: 'MissionTemplate', columns: ['displayName', 'description'], where: "id = 'locale_mission'" },
      { name: 'Material', columns: ['displayName', 'description'], where: "id = 'locale_material'" },
      { name: 'GameConfig', columns: ['description'], where: "key = 'locale_test'" },
    ];

    for (const { name, columns, where } of tables) {
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ${columns.map((col) => `"${col}"`).join(', ')} FROM "${name}" WHERE ${where}`,
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`Expected a row for ${name} (${where})`);
      }
      for (const column of columns) {
        const value = row[column];
        expect(value).toEqual(expect.any(Object));
        const map = value as Record<string, unknown>;
        expect(map).toHaveProperty('en');
        expect(map).toHaveProperty('pt-BR');
      }
    }
  });
});
