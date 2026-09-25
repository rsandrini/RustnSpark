import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

// S6.1 acceptance: exact MissionInstance column set (plan line 407, plus the documented
// deadlineAt deviation for rescue completion deadlines), the eight-status MissionStatus enum,
// the board index, the IN_TRANSIT partial index, and the one-active-mission-per-player
// partial unique. HELD rows are deliberately outside that unique: hold_max is GameConfig-
// tunable and enforced app-level in S6.4, not frozen into a DB constraint here.
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  MissionInstance: [
    'id',
    'templateId',
    'type',
    'factionId',
    'originId',
    'destinationId',
    'legs',
    'cargo',
    'reward',
    'expiresAt',
    'status',
    'playerId',
    'shipId',
    'acceptedAt',
    'arrivalAt',
    'deadlineAt',
    'seed',
    'privatePlayerId',
    'version',
  ],
};

// Plan line 407: exact status set, in declaration order.
const EXPECTED_MISSION_STATUSES = [
  'AVAILABLE',
  'HELD',
  'ACCEPTED',
  'IN_TRANSIT',
  'RESOLVING',
  'DONE',
  'FAILED',
  'EXPIRED',
] as const;

const DEFAULT_LEGS = [
  { distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } },
];
const DEFAULT_CARGO = { kind: 'ore', quantity: 10 };
const DEFAULT_EXPIRES_AT = new Date('2026-10-01T12:00:00.000Z');
const DEFAULT_SEED = 'ceres|12|cfg-abc';

function sortedColumns(record: Record<string, readonly string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(record)) {
    result[table] = [...columns].sort();
  }
  return result;
}

interface Prerequisites {
  playerId: string;
  otherPlayerId: string;
  factionId: string;
  templateId: string;
  originId: string;
  destinationId: string;
}

interface MissionOverrides {
  status?:
    'AVAILABLE' | 'HELD' | 'ACCEPTED' | 'IN_TRANSIT' | 'RESOLVING' | 'DONE' | 'FAILED' | 'EXPIRED';
  originId?: string;
  destinationId?: string;
  playerId?: string;
  deadlineAt?: Date;
  seed?: string;
  legs?: Prisma.InputJsonValue;
  cargo?: Prisma.InputJsonValue;
}

describe('missions data model (S6.1)', () => {
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
      data: {
        email: 's6.1@example.com',
        passwordHash: 'hash',
      },
    });
    const player = await prisma.player.create({
      data: {
        accountId: account.id,
        name: 's6.1-player',
      },
    });
    const accountB = await prisma.account.create({
      data: {
        email: 's6.1-b@example.com',
        passwordHash: 'hash',
      },
    });
    const playerB = await prisma.player.create({
      data: {
        accountId: accountB.id,
        name: 's6.1-player-b',
      },
    });
    const faction = await prisma.faction.create({
      data: {
        id: 's6_1_faction',
        displayName: { en: 'Faction', 'pt-BR': 'Facção' },
        description: { en: 'desc', 'pt-BR': 'desc' },
        color: '#000000',
        relations: {},
      },
    });
    const template = await prisma.missionTemplate.create({
      data: {
        id: 's6_1_template',
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
        id: 's6_1_origin',
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
        id: 's6_1_dest',
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

    return {
      playerId: player.id,
      otherPlayerId: playerB.id,
      factionId: faction.id,
      templateId: template.id,
      originId: origin.id,
      destinationId: destination.id,
    };
  }

  // Explicit destructure + ?? defaults (never a Partial-spread): keeps every required
  // scalar visible and the TS error surface honest if the generated model changes.
  async function createMission(p: Prerequisites, overrides: MissionOverrides = {}) {
    return prisma.missionInstance.create({
      data: {
        templateId: p.templateId,
        type: 'DELIVERY',
        factionId: p.factionId,
        originId: overrides.originId ?? p.originId,
        destinationId: overrides.destinationId ?? p.destinationId,
        legs: overrides.legs ?? DEFAULT_LEGS,
        cargo: overrides.cargo ?? DEFAULT_CARGO,
        reward: 1000,
        expiresAt: DEFAULT_EXPIRES_AT,
        status: overrides.status ?? 'AVAILABLE',
        playerId: overrides.playerId ?? null,
        shipId: null,
        acceptedAt: null,
        arrivalAt: null,
        deadlineAt: overrides.deadlineAt ?? null,
        seed: overrides.seed ?? DEFAULT_SEED,
        version: 0,
      },
    });
  }

  it('creates MissionInstance with exactly the planned columns', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'MissionInstance'
    `;

    const actual = [...rows.map((row) => row.column_name)].sort();
    expect(actual).toEqual(sortedColumns(EXPECTED_COLUMNS).MissionInstance);
  });

  it('defines MissionStatus with exactly the eight planned values in order', async () => {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'MissionStatus'
      ORDER BY e.enumsortorder
    `;

    expect(rows.map((row) => row.enumlabel)).toEqual([...EXPECTED_MISSION_STATUSES]);
  });

  it('has the board index, the IN_TRANSIT partial index, and the one-active-player unique index', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'MissionInstance'
    `;
    const defs = new Map(rows.map((row) => [row.indexname, row.indexdef.replaceAll('"', '')]));

    const board = defs.get('MissionInstance_originId_status_expiresAt_idx') ?? '';
    expect(board).not.toBe('');
    expect(board).toContain('(originId, status, expiresAt)');
    expect(board).not.toContain('WHERE');

    const inTransit = defs.get('MissionInstance_status_arrivalAt_in_transit_idx') ?? '';
    expect(inTransit).not.toBe('');
    expect(inTransit).toContain('(status, arrivalAt)');
    expect(inTransit).toContain('WHERE');
    expect(inTransit).toContain('IN_TRANSIT');

    const oneActive = defs.get('MissionInstance_one_active_player_idx') ?? '';
    expect(oneActive).not.toBe('');
    expect(oneActive).toContain('CREATE UNIQUE INDEX');
    expect(oneActive).toContain('(playerId)');
    expect(oneActive).toContain('WHERE');
    expect(oneActive).toContain('ACCEPTED');
    expect(oneActive).toContain('IN_TRANSIT');
    expect(oneActive).toContain('RESOLVING');
    expect(oneActive).not.toContain('HELD');
  });

  it('allows at most one active mission per player while history, holds, and the board stay free', async () => {
    const p = await seedPrerequisites();

    await createMission(p, { playerId: p.playerId, status: 'ACCEPTED' });

    await expect(createMission(p, { playerId: p.playerId, status: 'ACCEPTED' })).rejects.toThrow(
      /unique constraint/i,
    );
    await expect(createMission(p, { playerId: p.playerId, status: 'IN_TRANSIT' })).rejects.toThrow(
      /unique constraint/i,
    );
    await expect(createMission(p, { playerId: p.playerId, status: 'RESOLVING' })).rejects.toThrow(
      /unique constraint/i,
    );

    // Terminal history rows are unlimited for the same player.
    await createMission(p, { playerId: p.playerId, status: 'DONE' });
    await createMission(p, { playerId: p.playerId, status: 'FAILED' });
    await createMission(p, { playerId: p.playerId, status: 'EXPIRED' });

    // HELD sits outside the partial unique (hold_max enforced app-level in S6.4).
    await createMission(p, { playerId: p.playerId, status: 'HELD' });

    // Another player may hold their own active mission.
    await createMission(p, { playerId: p.otherPlayerId, status: 'ACCEPTED' });

    // Board rows have no player: NULLs never collide in a unique index.
    await createMission(p);
    await createMission(p);
    await createMission(p);
  });

  it('applies planned defaults and round-trips legs, cargo, seed, and deadline', async () => {
    const p = await seedPrerequisites();
    const deadlineAt = new Date('2026-10-02T18:30:00.000Z');
    const legs = [
      { distance: 55, danger: 2, zone: 1, env: { id: 'deep', level: 2, fuelMult: 1.1 } },
    ];
    const cargo = { kind: 'passengers', quantity: 3 };

    const created = await createMission(p, { seed: 'vesta|7|cfg-xyz', deadlineAt, legs, cargo });
    const reloaded = await prisma.missionInstance.findUniqueOrThrow({ where: { id: created.id } });

    expect(reloaded.status).toBe('AVAILABLE');
    expect(reloaded.version).toBe(0);
    expect(reloaded.playerId).toBeNull();
    expect(reloaded.shipId).toBeNull();
    expect(reloaded.acceptedAt).toBeNull();
    expect(reloaded.arrivalAt).toBeNull();
    expect(reloaded.deadlineAt).toEqual(deadlineAt);
    expect(reloaded.seed).toBe('vesta|7|cfg-xyz');
    expect(reloaded.legs).toEqual(legs);
    expect(reloaded.cargo).toEqual(cargo);
    expect(reloaded.reward).toBe(1000);
    expect(reloaded.expiresAt).toEqual(DEFAULT_EXPIRES_AT);
    expect(reloaded.type).toBe('DELIVERY');
    expect(typeof reloaded.id).toBe('string');
  });

  it('rejects missions pointing at unknown origin or destination locations', async () => {
    const p = await seedPrerequisites();

    await expect(createMission(p, { originId: 'no_such_location' })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(createMission(p, { destinationId: 'no_such_location' })).rejects.toThrow(
      /foreign key/i,
    );
  });
});
