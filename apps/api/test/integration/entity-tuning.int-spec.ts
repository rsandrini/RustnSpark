import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { registerConfigRegistryEntry } from '../../src/config/config-registry.js';
import {
  registerEntitySchemaField,
  type EntitySchemaField,
} from '../../src/admin/tuning/entity-schemas.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AdminCredentials {
  email: string;
  password: string;
  name: string;
}

async function createAdmin(
  prisma: PrismaService,
  passwordService: PasswordService,
  overrides: Partial<AdminCredentials> = {},
): Promise<AdminCredentials> {
  const email = overrides.email ?? `admin-${crypto.randomUUID()}@example.com`;
  const password = overrides.password ?? 'admin-password-1';
  const name = overrides.name ?? `admin_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`;
  await prisma.account.create({
    data: {
      email,
      passwordHash: await passwordService.hash(password),
      role: 'ADMIN',
      player: { create: { name, credits: 0, locale: 'en' } },
    },
  });
  return { email, password, name };
}

async function loginAdmin(server: Server, creds: AdminCredentials): Promise<string> {
  const response = await request(server)
    .post('/v1/auth/login')
    .send({ email: creds.email, password: creds.password });
  expect(response.status).toBe(200);
  return accessTokenFrom(response);
}

interface SchemaResponse {
  entity: string;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    enumValues?: string[];
    min?: number;
    max?: number;
    description?: { en: string; 'pt-BR': string };
    configKey?: string;
  }>;
}

interface EntityWriteResponse {
  row: Record<string, unknown>;
  revision: { id: string; entityType: string; entityId: string; reason: string };
}

interface ErrorResponse {
  error: string;
  code?: string;
  issues?: Array<{ key: string; message: string }>;
}

function validPartPayload(partType: string): Record<string, unknown> {
  return {
    partType,
    displayName: { en: 'Test Part', 'pt-BR': 'Peça de Teste' },
    description: { en: 'A test part.', 'pt-BR': 'Uma peça de teste.' },
    partClass: 'WEAPON',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 3,
    basePrice: 100,
    scrapValue: 25,
    partHp: 20,
    pot: 0,
    pdf: 2,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
  };
}

function validShipFormatPayload(id: string): Record<string, unknown> {
  return {
    id,
    displayName: { en: 'Test Format', 'pt-BR': 'Formato de Teste' },
    description: { en: 'A test format.', 'pt-BR': 'Um formato de teste.' },
    cells: [[0, 0], [1, 0]],
    minRarity: 'COMMON',
  };
}

function validRoutePayload(id: string, nodeAId: string, nodeBId: string): Record<string, unknown> {
  return {
    id,
    nodeAId,
    nodeBId,
    distance: 500,
    danger: 3,
  };
}

describe('entity tuning (S3.8)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  it('GET /v1/admin/tuning/schema/parts returns metadata including partType, displayName, mass, basePrice', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .get('/v1/admin/tuning/schema/parts')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const body = response.body as SchemaResponse;
    expect(body.entity).toBe('parts');
    const names = body.fields.map((f) => f.name);
    expect(names).toContain('partType');
    expect(names).toContain('displayName');
    expect(names).toContain('mass');
    expect(names).toContain('basePrice');

    const displayName = body.fields.find((f) => f.name === 'displayName');
    expect(displayName?.type).toBe('locale-map');
    expect(displayName?.required).toBe(true);
  });

  it('creates a new part and it appears in the list and is retrievable', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const createResponse = await request(server)
      .post('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: validPartPayload('test_part_1'), reason: 'add test part' });
    expect(createResponse.status).toBe(201);
    const createBody = createResponse.body as EntityWriteResponse;
    expect(createBody.row.partType).toBe('test_part_1');
    expect(createBody.row.active).toBe(true);
    expect(createBody.revision.entityType).toBe('parts');
    expect(createBody.revision.entityId).toBe('test_part_1');

    const listResponse = await request(server)
      .get('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    const partTypes = (listResponse.body as Array<Record<string, unknown>>).map((r) => r.partType);
    expect(partTypes).toContain('test_part_1');

    const getResponse = await request(server)
      .get('/v1/admin/tuning/parts/test_part_1')
      .set('Authorization', `Bearer ${token}`);
    expect(getResponse.status).toBe(200);
    expect((getResponse.body as Record<string, unknown>).partType).toBe('test_part_1');
  });

  it('retires a non-starter part and creates a revision', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const deleteResponse = await request(server)
      .delete('/v1/admin/tuning/parts/weapon_ballistic')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'retire test weapon' });
    expect(deleteResponse.status).toBe(200);
    const body = deleteResponse.body as EntityWriteResponse;
    expect(body.row.active).toBe(false);
    expect(body.revision.entityId).toBe('weapon_ballistic');

    const part = await prisma.partCatalog.findUnique({ where: { partType: 'weapon_ballistic' } });
    expect(part?.active).toBe(false);
  });

  it('rejects retiring a starter part with 400 STARTER_PART_REQUIRED', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .delete('/v1/admin/tuning/parts/bridge')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'try to retire bridge' });
    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.code).toBe('STARTER_PART_REQUIRED');

    const part = await prisma.partCatalog.findUnique({ where: { partType: 'bridge' } });
    expect(part?.active).toBe(true);
  });

  it('rejects creating a route that references a missing location', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .post('/v1/admin/tuning/routes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data: validRoutePayload('bad-route', 'missing_a', 'missing_b'),
        reason: 'bad route',
      });
    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects deleting a route that would disconnect the graph', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    // Create an isolated leaf location connected by a single bridge route.
    await prisma.location.create({
      data: {
        id: 'leaf_test',
        displayName: { en: 'Leaf Test', 'pt-BR': 'Teste Folha' },
        description: { en: 'A leaf location.', 'pt-BR': 'Um local folha.' },
        type: 'outpost',
        x: 0,
        y: 0,
        zone: 1,
        factionId: 'luna',
        isolation: 1,
        mood: 1,
        services: {},
      },
    });
    await request(server)
      .post('/v1/admin/tuning/routes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data: validRoutePayload('leaf-bridge', 'ceres', 'leaf_test'),
        reason: 'connect leaf',
      });

    const response = await request(server)
      .delete('/v1/admin/tuning/routes/leaf-bridge')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'try disconnect' });
    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.code).toBe('ROUTE_WOULD_DISCONNECT');
  });

  it('rejects asymmetric faction relation updates', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .patch('/v1/admin/tuning/factions/luna')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data: {
          relations: { luna: 'neutral', sun: 'hostile', explorers: 'neutral', pirates: 'hostile' },
        },
        reason: 'make luna hostile to sun asymmetrically',
      });
    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown fields in the payload', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const payload = validPartPayload('unknown_field_part');
    payload.unknownField = 'unexpected';

    const response = await request(server)
      .post('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: payload, reason: 'unknown field test' });
    expect(response.status).toBe(400);
    const body = response.body as ErrorResponse;
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('rejects non-admin requests with 403', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const player = await seedAccountWithPlayer(prisma, passwordService, {
      email: 'player@example.com',
      name: 'player_pilot',
    });
    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email: player.email, password: player.password });
    const token = accessTokenFrom(login);

    const response = await request(server)
      .get('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('rejects deactivating a starter part through PATCH with STARTER_PART_REQUIRED', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const token = await loginAdmin(server, await createAdmin(prisma, passwordService));

    const response = await request(server)
      .patch('/v1/admin/tuning/parts/bridge')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: { active: false }, reason: 'sneak past the guard' });

    expect(response.status).toBe(400);
    expect((response.body as ErrorResponse).code).toBe('STARTER_PART_REQUIRED');
    expect((await prisma.partCatalog.findUnique({ where: { partType: 'bridge' } }))?.active).toBe(
      true,
    );
  });

  it('rejects renaming a part id through PATCH', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const token = await loginAdmin(server, await createAdmin(prisma, passwordService));

    const response = await request(server)
      .patch('/v1/admin/tuning/parts/weapon_ballistic')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: { partType: 'renamed_weapon' }, reason: 'rename' });

    expect(response.status).toBe(400);
    expect(
      await prisma.partCatalog.findUnique({ where: { partType: 'weapon_ballistic' } }),
    ).not.toBeNull();
  });

  it('rejects onboarding config that points at a missing or inactive part or a missing location', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const token = await loginAdmin(server, await createAdmin(prisma, passwordService));

    const badParts = await request(server)
      .patch('/v1/admin/tuning/config/onboarding.starter_parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: ['bridge', 'no_such_part'], reason: 'bad ref', expectedRevision: 0 });
    expect(badParts.status).toBe(400);
    expect(JSON.stringify(badParts.body)).toContain('STARTER_PART_NOT_ACTIVE');

    const badHome = await request(server)
      .patch('/v1/admin/tuning/config/onboarding.home_locations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        value: { luna: 'no_such_location', sun: 'no_such_location' },
        reason: 'bad ref',
        expectedRevision: 0,
      });
    expect(badHome.status).toBe(400);
    expect(JSON.stringify(badHome.body)).toContain('HOME_LOCATION_NOT_FOUND');
  });

  it('reverting the retirement of a route recreates it instead of failing', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const token = await loginAdmin(server, await createAdmin(prisma, passwordService));
    const ids = (await prisma.location.findMany({ orderBy: { id: 'asc' } })).map((l) => l.id);
    const taken = new Set((await prisma.route.findMany()).map((r) => `${r.nodeAId}|${r.nodeBId}`));
    const pair = ids
      .flatMap((x, i) => ids.slice(i + 1).map((y) => [x, y] as const))
      .find(([x, y]) => !taken.has(`${x}|${y}`));
    const [a, b] = pair!;

    const created = await request(server)
      .post('/v1/admin/tuning/routes')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: validRoutePayload('extra_route_for_revert', a, b), reason: 'extra route' });
    expect(created.status).toBe(201);

    const retired = await request(server)
      .delete('/v1/admin/tuning/routes/extra_route_for_revert')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'retire route' });
    expect(retired.status).toBe(200);
    expect(await prisma.route.findUnique({ where: { id: 'extra_route_for_revert' } })).toBeNull();

    const reverted = await request(server)
      .post(
        `/v1/admin/tuning/revisions/${(retired.body as EntityWriteResponse).revision.id}/revert`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'undo retire' });
    expect(reverted.status).toBe(200);
    expect(
      await prisma.route.findUnique({ where: { id: 'extra_route_for_revert' } }),
    ).not.toBeNull();
  });

  it('reverts an entity revision and restores the prior state', async () => {
    await seed(prisma);
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const createResponse = await request(server)
      .post('/v1/admin/tuning/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: validPartPayload('revert_part'), reason: 'create for revert' });
    expect(createResponse.status).toBe(201);

    const updateResponse = await request(server)
      .patch('/v1/admin/tuning/parts/revert_part')
      .set('Authorization', `Bearer ${token}`)
      .send({
        data: { basePrice: 9999 },
        reason: 'update for revert',
      });
    expect(updateResponse.status).toBe(200);
    const updateRevisionId = (updateResponse.body as EntityWriteResponse).revision.id;

    const beforeRevert = await prisma.partCatalog.findUnique({
      where: { partType: 'revert_part' },
    });
    expect(beforeRevert?.basePrice).toBe(9999);

    const revertResponse = await request(server)
      .post(`/v1/admin/tuning/revisions/${updateRevisionId}/revert`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'undo price change' });
    expect(revertResponse.status).toBe(200);

    const afterRevert = await prisma.partCatalog.findUnique({ where: { partType: 'revert_part' } });
    expect(afterRevert?.basePrice).toBe(100);
  });

  it('schema-driven test: new field and config key appear without UI code changes', async () => {
    const fakeField: EntitySchemaField = {
      name: 'fake_test_field',
      type: 'string',
      required: false,
      description: {
        en: 'Fake field for schema test',
        'pt-BR': 'Campo falso para teste de schema',
      },
      configKey: 'test.fake_key',
    };
    registerEntitySchemaField('parts', fakeField);
    registerConfigRegistryEntry({
      key: 'test.fake_key',
      group: 'test',
      type: 'integer',
      min: 0,
      max: 100,
      factoryDefault: 42,
      description: { en: 'Fake config key', 'pt-BR': 'Chave de config falsa' },
    });

    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .get('/v1/admin/tuning/schema/parts')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const body = response.body as SchemaResponse;
    const fake = body.fields.find((f) => f.name === 'fake_test_field');
    expect(fake).toBeDefined();
    expect(fake?.configKey).toBe('test.fake_key');
  });

  describe('ship-formats entity (Ship Format, round 11)', () => {
    it('creates a format with a valid cell list', async () => {
      await seed(prisma);
      const server = httpServer(testApp.app);
      const admin = await createAdmin(prisma, passwordService);
      const token = await loginAdmin(server, admin);

      const response = await request(server)
        .post('/v1/admin/tuning/ship-formats')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: validShipFormatPayload('cross_test'), reason: 'test' });
      expect(response.status).toBe(201);
    });

    it('rejects a cell list missing [0,0]', async () => {
      await seed(prisma);
      const server = httpServer(testApp.app);
      const admin = await createAdmin(prisma, passwordService);
      const token = await loginAdmin(server, admin);

      const payload = validShipFormatPayload('no_origin');
      payload.cells = [[1, 0], [2, 0]];
      const response = await request(server)
        .post('/v1/admin/tuning/ship-formats')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: payload, reason: 'test' });
      expect(response.status).toBe(400);
    });

    it('rejects a cell beyond the +/-15 drawing ceiling', async () => {
      await seed(prisma);
      const server = httpServer(testApp.app);
      const admin = await createAdmin(prisma, passwordService);
      const token = await loginAdmin(server, admin);

      const payload = validShipFormatPayload('too_big');
      payload.cells = [[0, 0], [20, 0]];
      const response = await request(server)
        .post('/v1/admin/tuning/ship-formats')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: payload, reason: 'test' });
      expect(response.status).toBe(400);
    });
  });
});
