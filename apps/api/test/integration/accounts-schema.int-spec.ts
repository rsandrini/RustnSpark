import { afterAll, describe, expect, it } from '@jest/globals';
import { closeTestPrismaClient, getTestPrismaClient } from '../support/test-db.js';

// Exact column sets from the plan's S2.1 field lists. Account's set IS the "PII limited to
// email" acceptance: any extra column (or missing one) fails this test mechanically.
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  Account: ['id', 'email', 'passwordHash', 'role', 'status', 'createdAt'],
  Player: ['id', 'accountId', 'name', 'credits', 'locale', 'factionId', 'createdAt'],
  RefreshToken: [
    'id',
    'accountId',
    'familyId',
    'tokenHash',
    'expiresAt',
    'revokedAt',
    'replacedById',
  ],
  PlayerEvent: ['id', 'playerId', 'at', 'type', 'payload', 'creditsDelta'],
  IdempotencyKey: [
    'key',
    'playerId',
    'route',
    'requestHash',
    'responseStatus',
    'responseBody',
    'expiresAt',
  ],
};

describe('accounts and events data model (S2.1)', () => {
  const prisma = getTestPrismaClient();

  afterAll(async () => {
    await closeTestPrismaClient();
  });

  it('creates each table with exactly the planned columns', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('Account', 'Player', 'RefreshToken', 'PlayerEvent', 'IdempotencyKey')
    `;

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
    const expected: Record<string, string[]> = {};
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      actual[table] = [...(columnsByTable.get(table) ?? [])].sort();
    }
    for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
      expected[table] = [...columns].sort();
    }

    expect(actual).toEqual(expected);
  });

  it('has the plan-required indexes on PlayerEvent(playerId, at) and RefreshToken(familyId)', async () => {
    // indexdef is the full CREATE INDEX statement; quotes stripped so camelCase column
    // lists match as plain text.
    const eventIndexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'PlayerEvent'
    `;
    const tokenIndexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'RefreshToken'
    `;

    const eventDefs = eventIndexes.map((row) => row.indexdef.replaceAll('"', ''));
    const tokenDefs = tokenIndexes.map((row) => row.indexdef.replaceAll('"', ''));

    expect(eventDefs.some((def) => def.includes('(playerId, at)'))).toBe(true);
    expect(tokenDefs.some((def) => def.includes('(familyId)'))).toBe(true);
  });
});
