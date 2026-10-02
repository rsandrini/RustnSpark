import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

// S7.1 acceptance (plan line 431): MissionLog carries no TEXT column anywhere (D19 replay
// rows are bounded strings), the RoutePresence window is a tstzrange whose GiST index the
// overlap query actually uses, and Encounter's unique key is what makes "exactly one row"
// (D1) enforceable at the database, not just in application code. Migration number is
// 0013_execution (the plan's "0006_execution" name predates the shipped sequence).
const EXPECTED_COLUMNS = {
  MissionLog: [
    'id',
    'missionId',
    'playerId',
    'seed',
    'rulesHash',
    'outcome',
    'shipSnapshot',
    'legs',
    'schemaVersion',
    'createdAt',
  ],
  RoutePresence: ['id', 'missionId', 'shipId', 'routeId', 'legIndex', 'window'],
  Encounter: [
    'id',
    'routeId',
    'legIndex',
    'missionAId',
    'missionBId',
    'seed',
    'result',
    'resolvedAt',
  ],
} as const satisfies Record<string, readonly string[]>;

function sorted(columns: readonly string[]): string[] {
  return [...columns].sort();
}

interface Prerequisites {
  playerId: string;
  shipId: string;
  routeId: string;
  missionAId: string;
  missionBId: string;
  rulesHash: string;
}

describe('execution data model (S7.1)', () => {
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

  async function seedPrerequisites(): Promise<Prerequisites> {
    const account = await prisma.account.create({
      data: { email: 's7.1@example.com', passwordHash: 'hash' },
    });
    const player = await prisma.player.create({
      data: { accountId: account.id, name: 's7.1-player' },
    });
    const faction = await prisma.faction.create({
      data: {
        id: 's7_1_faction',
        displayName: { en: 'Faction', 'pt-BR': 'Facção' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        color: '#000000',
        relations: {},
      },
    });
    const template = await prisma.missionTemplate.create({
      data: {
        id: 's7_1_template',
        displayName: { en: 'Delivery', 'pt-BR': 'Entrega' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        type: 'DELIVERY',
        factionId: faction.id,
        requirements: {},
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy: {},
      },
    });
    const origin = await prisma.location.create({
      data: {
        id: 's7_1_origin',
        displayName: { en: 'Origin', 'pt-BR': 'Origem' },
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
    const destination = await prisma.location.create({
      data: {
        id: 's7_1_dest',
        displayName: { en: 'Dest', 'pt-BR': 'Destino' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        type: 'port',
        x: 1,
        y: 1,
        zone: 1,
        factionId: faction.id,
        isolation: 1,
        mood: 1,
        services: {},
      },
    });
    const route = await prisma.route.create({
      data: {
        id: 's7_1_route',
        nodeAId: origin.id,
        nodeBId: destination.id,
        distance: 40,
        danger: 1,
      },
    });
    // Ship Format (2026-10-02): Ship.formatId's FK target — the Ship created below relies on
    // the column's own DB default ('classic_square'), which needs this row to exist.
    await prisma.shipFormat.create({
      data: {
        id: 'classic_square',
        displayName: { en: 'Classic Square', 'pt-BR': 'Quadrado Clássico' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        cells: [[0, 0]],
        minRarity: 'COMMON',
      },
    });
    const ship = await prisma.ship.create({
      data: {
        ownerPlayerId: player.id,
        name: 's7-1-ship',
        layout: {},
        currentLocationId: origin.id,
      },
    });
    const rulesSnapshot = await prisma.rulesSnapshot.create({
      data: { hash: 's7.1-rules-hash', rules: {} },
    });
    const createMission = (id: string) =>
      prisma.missionInstance.create({
        data: {
          id,
          templateId: template.id,
          type: 'DELIVERY',
          factionId: faction.id,
          originId: origin.id,
          destinationId: destination.id,
          legs: [{ distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } }],
          cargo: { kind: 'ore', quantity: 10 },
          reward: 1000,
          expiresAt: new Date('2026-10-01T12:00:00.000Z'),
          status: 'AVAILABLE',
          seed: 'ceres|12|cfg-abc',
        },
      });
    const missionA = await createMission('s7_1_mission_a');
    const missionB = await createMission('s7_1_mission_b');

    return {
      playerId: player.id,
      shipId: ship.id,
      routeId: route.id,
      missionAId: missionA.id,
      missionBId: missionB.id,
      rulesHash: rulesSnapshot.hash,
    };
  }

  async function columnsOf(table: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `;
    return rows.map((row) => row.column_name).sort();
  }

  async function columnTypesOf(table: string): Promise<Map<string, string>> {
    const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `;
    return new Map(rows.map((row) => [row.column_name, row.data_type]));
  }

  async function insertMissionLog(p: Prerequisites, id = randomUUID()): Promise<string> {
    await prisma.$executeRaw`
      INSERT INTO "MissionLog"
        ("id", "missionId", "playerId", "seed", "rulesHash", "outcome", "shipSnapshot", "legs")
      VALUES
        (${id}, ${p.missionAId}, ${p.playerId}, 'ceres|12|cfg-abc', ${p.rulesHash},
         'SUCCESS', '{}'::jsonb, '[]'::jsonb)
    `;
    return id;
  }

  async function insertPresence(
    p: Prerequisites,
    id: string,
    missionId: string,
    from: string,
    to: string,
  ): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "RoutePresence" ("id", "missionId", "shipId", "routeId", "legIndex", "window")
      VALUES (
        ${id}, ${missionId}, ${p.shipId}, ${p.routeId}, 0,
        tstzrange(${from}::timestamptz, ${to}::timestamptz)
      )
    `;
  }

  it('creates MissionLog with exactly the planned columns and no TEXT data type anywhere', async () => {
    expect(await columnsOf('MissionLog')).toEqual(sorted(EXPECTED_COLUMNS.MissionLog));

    const types = await columnTypesOf('MissionLog');
    const textColumns = [...types.entries()]
      .filter(([, dataType]) => dataType === 'text')
      .map(([name]) => name);
    expect(textColumns).toEqual([]);

    expect(types.get('id')).toBe('character varying');
    expect(types.get('missionId')).toBe('character varying');
    expect(types.get('playerId')).toBe('character varying');
    expect(types.get('seed')).toBe('character varying');
    expect(types.get('rulesHash')).toBe('character varying');
    expect(types.get('outcome')).toBe('character varying');
    expect(types.get('shipSnapshot')).toBe('jsonb');
    expect(types.get('legs')).toBe('jsonb');
    expect(types.get('schemaVersion')).toBe('integer');
    expect(types.get('createdAt')).toBe('timestamp without time zone');
  });

  it('enforces MissionLog.missionId uniqueness and foreign keys to MissionInstance, Player and RulesSnapshot', async () => {
    const p = await seedPrerequisites();

    const uniqueIndexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'MissionLog' AND indexdef LIKE '%UNIQUE%'
    `;
    expect(uniqueIndexes.map((row) => row.indexname)).toContain('MissionLog_missionId_key');

    const fks = await prisma.$queryRaw<Array<{ conname: string; refTable: string }>>`
      SELECT c.conname, ref.relname AS "refTable"
      FROM pg_constraint c
      JOIN pg_class cls ON cls.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      WHERE cls.relname = 'MissionLog' AND c.contype = 'f'
    `;
    const byName = new Map(fks.map((row) => [row.conname, row.refTable]));
    expect(byName.get('MissionLog_missionId_fkey')).toBe('MissionInstance');
    expect(byName.get('MissionLog_playerId_fkey')).toBe('Player');
    expect(byName.get('MissionLog_rulesHash_fkey')).toBe('RulesSnapshot');

    await insertMissionLog(p);
    await expect(
      insertMissionLog({ ...p, missionAId: p.missionBId }, randomUUID()),
    ).resolves.toBeDefined();
    // Raw inserts surface Postgres' own 23505 text, not Prisma's "Unique constraint failed".
    await expect(insertMissionLog(p)).rejects.toThrow(/already exists|unique constraint/i);
  });

  it('creates RoutePresence with a tstzrange window, the planned columns, and matching foreign keys', async () => {
    expect(await columnsOf('RoutePresence')).toEqual(sorted(EXPECTED_COLUMNS.RoutePresence));

    const types = await columnTypesOf('RoutePresence');
    expect(types.get('window')).toBe('tstzrange');

    const windowType = await prisma.$queryRaw<Array<{ udt_name: string }>>`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'RoutePresence' AND column_name = 'window'
    `;
    expect(windowType[0]?.udt_name).toBe('tstzrange');

    const fks = await prisma.$queryRaw<Array<{ conname: string; refTable: string }>>`
      SELECT c.conname, ref.relname AS "refTable"
      FROM pg_constraint c
      JOIN pg_class cls ON cls.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      WHERE cls.relname = 'RoutePresence' AND c.contype = 'f'
    `;
    const byName = new Map(fks.map((row) => [row.conname, row.refTable]));
    expect(byName.get('RoutePresence_missionId_fkey')).toBe('MissionInstance');
    expect(byName.get('RoutePresence_shipId_fkey')).toBe('Ship');
    expect(byName.get('RoutePresence_routeId_fkey')).toBe('Route');
  });

  it('answers the presence overlap query from the GiST index on the window', async () => {
    const p = await seedPrerequisites();
    await insertPresence(
      p,
      randomUUID(),
      p.missionAId,
      '2026-01-01 00:00+00',
      '2026-01-02 00:00+00',
    );
    await insertPresence(
      p,
      randomUUID(),
      p.missionBId,
      '2026-01-01 12:00+00',
      '2026-01-03 00:00+00',
    );

    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'RoutePresence'
    `;
    const gist = indexes.find((row) => row.indexdef.includes('USING gist'));
    expect(gist?.indexdef).toContain('"window"');

    const planLines = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      const rows = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN
        SELECT "id" FROM "RoutePresence"
        WHERE "missionId" <> ${p.missionAId}
          AND "window" && tstzrange(
            ${'2026-01-01 00:30:00+00'}::timestamptz, ${'2026-01-01 13:00:00+00'}::timestamptz
          )
      `;
      return rows.map((row) => row['QUERY PLAN']);
    });
    const plan = planLines.join('\n');
    expect(plan).toMatch(/Index Scan/);
    expect(plan).toContain('RoutePresence_window_idx');

    const overlap = await prisma.$queryRaw<Array<{ missionId: string }>>`
      SELECT "missionId" FROM "RoutePresence"
      WHERE "missionId" <> ${p.missionAId}
        AND "window" && tstzrange(
          ${'2026-01-01 00:30:00+00'}::timestamptz, ${'2026-01-01 13:00:00+00'}::timestamptz
        )
    `;
    expect(overlap.map((row) => row.missionId)).toEqual([p.missionBId]);
  });

  it('creates Encounter with the planned columns and a unique key per pair, route and leg', async () => {
    expect(await columnsOf('Encounter')).toEqual(sorted(EXPECTED_COLUMNS.Encounter));

    const uniqueIndexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Encounter' AND indexdef LIKE '%UNIQUE%'
    `;
    expect(uniqueIndexes.map((row) => row.indexname)).toContain(
      'Encounter_missionAId_missionBId_routeId_legIndex_key',
    );

    const p = await seedPrerequisites();
    const insertEncounter = () =>
      prisma.$executeRaw`
        INSERT INTO "Encounter"
          ("id", "routeId", "legIndex", "missionAId", "missionBId", "seed", "result")
        VALUES
          (${randomUUID()}, ${p.routeId}, 0, ${p.missionAId}, ${p.missionBId}, 'seed', '{}'::jsonb)
      `;

    await insertEncounter();
    await expect(insertEncounter()).rejects.toThrow(/already exists|unique constraint/i);
  });

  it('rejects execution rows that point at unknown references', async () => {
    const p = await seedPrerequisites();
    const bogus = randomUUID();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "MissionLog"
          ("id", "missionId", "playerId", "seed", "rulesHash", "outcome", "shipSnapshot", "legs")
        VALUES
          (${randomUUID()}, ${bogus}, ${p.playerId}, 's', ${p.rulesHash}, 'SUCCESS', '{}'::jsonb, '[]'::jsonb)
      `,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "MissionLog"
          ("id", "missionId", "playerId", "seed", "rulesHash", "outcome", "shipSnapshot", "legs")
        VALUES
          (${randomUUID()}, ${p.missionAId}, ${bogus}, 's', ${p.rulesHash}, 'SUCCESS', '{}'::jsonb, '[]'::jsonb)
      `,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "MissionLog"
          ("id", "missionId", "playerId", "seed", "rulesHash", "outcome", "shipSnapshot", "legs")
        VALUES
          (${randomUUID()}, ${p.missionAId}, ${p.playerId}, 's', ${bogus}, 'SUCCESS', '{}'::jsonb, '[]'::jsonb)
      `,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "RoutePresence" ("id", "missionId", "shipId", "routeId", "legIndex", "window")
        VALUES (
          ${randomUUID()}, ${bogus}, ${p.shipId}, ${p.routeId}, 0,
          tstzrange(now(), now() + interval '1 hour')
        )
      `,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Encounter"
          ("id", "routeId", "legIndex", "missionAId", "missionBId", "seed", "result")
        VALUES
          (${randomUUID()}, ${bogus}, 0, ${p.missionAId}, ${p.missionBId}, 's', '{}'::jsonb)
      `,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Encounter"
          ("id", "routeId", "legIndex", "missionAId", "missionBId", "seed", "result")
        VALUES
          (${randomUUID()}, ${p.routeId}, 0, ${bogus}, ${p.missionBId}, 's', '{}'::jsonb)
      `,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Encounter"
          ("id", "routeId", "legIndex", "missionAId", "missionBId", "seed", "result")
        VALUES
          (${randomUUID()}, ${p.routeId}, 0, ${p.missionAId}, ${bogus}, 's', '{}'::jsonb)
      `,
    ).rejects.toThrow(/foreign key/i);
  });
});
