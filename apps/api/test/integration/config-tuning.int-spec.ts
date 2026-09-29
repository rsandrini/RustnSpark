import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface ConfigEntry {
  key: string;
  group: string;
  type: string;
  min: number;
  max: number;
  unit?: string;
  description: { en: string; 'pt-BR': string };
  currentValue: unknown;
  factoryDefault: unknown;
  modified: boolean;
}

interface TuningRevisionResponse {
  id: string;
  entityId: string;
  after: unknown;
  reason: string;
}

interface ValidationErrorResponse {
  error: 'VALIDATION_ERROR';
  issues: Array<{ key: string; message: string }>;
}

interface RevisionMismatchResponse {
  error: 'REVISION_MISMATCH';
  currentRevision: number;
}

interface BundleDiff {
  key: string;
  before: unknown;
  after: unknown;
}

interface BundleDryRunResponse {
  valid: true;
  diffs: BundleDiff[];
}

interface BundleImportResponse {
  revisions: TuningRevisionResponse[];
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

async function getCurrentRevision(prisma: PrismaService): Promise<number> {
  const latest = await prisma.tuningRevision.findFirst({ orderBy: { id: 'desc' } });
  return Number(latest?.id ?? 0n);
}

function findEntry(body: ConfigEntry[], key: string): ConfigEntry {
  const entry = body.find((e) => e.key === key);
  if (!entry) throw new Error(`expected entry ${key}`);
  return entry;
}

describe('config tuning (S3.7)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let gameConfigService: GameConfigService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    gameConfigService = testApp.app.get(GameConfigService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  // The restart-kit guard reads PartCatalog base prices; the rest of this suite runs on a
  // truncated (unseeded) world, so the invariant tests seed it first.
  async function freshSeeded(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await gameConfigService.refresh();
  }

  it('GET /v1/admin/tuning/config as admin returns all keys with factory defaults and modified: false', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const body = response.body as ConfigEntry[];
    expect(body.length).toBeGreaterThan(0);

    const startCredits = findEntry(body, 'economy.start_credits');
    expect(startCredits.currentValue).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
    expect(startCredits.factoryDefault).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
    expect(startCredits.modified).toBe(false);
    expect(startCredits.group).toBe('economy');
    expect(startCredits.type).toBe('integer');
    expect(startCredits.description).toEqual({
      en: expect.any(String),
      'pt-BR': expect.any(String),
    });
  });

  it('PATCH /v1/admin/tuning/config/:key with valid value creates revision and shows modified: true', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);
    const expectedRevision = await getCurrentRevision(prisma);

    const response = await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 500, expectedRevision, reason: 'increase starting credits' });
    expect(response.status).toBe(200);
    const revision = response.body as TuningRevisionResponse;
    expect(revision.entityId).toBe('economy.start_credits');
    expect(revision.after).toBe(500);

    const listResponse = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const entry = findEntry(listResponse.body as ConfigEntry[], 'economy.start_credits');
    expect(entry.currentValue).toBe(500);
    expect(entry.modified).toBe(true);
  });

  it('rejects an out-of-range value with 400 and does not write a revision or change the cache', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);
    const expectedRevision = await getCurrentRevision(prisma);
    const before = gameConfigService.snapshot();

    const response = await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 999999, expectedRevision, reason: 'bad value' });
    expect(response.status).toBe(400);
    const body = response.body as ValidationErrorResponse;
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.issues).toEqual([{ key: 'economy.start_credits', message: expect.any(String) }]);

    const after = gameConfigService.snapshot();
    expect(after.version).toBe(before.version);
    expect(after.rules.economy.start_credits).toBe(before.rules.economy.start_credits);

    const revisions = await prisma.tuningRevision.findMany({
      where: { entityId: 'economy.start_credits' },
    });
    expect(revisions).toHaveLength(0);
  });

  it('rejects a restart kit that would sell for rescue_cost or more (S8.6, review item 4)', async () => {
    await freshSeeded();
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);
    const expectedRevision = await getCurrentRevision(prisma);
    const before = gameConfigService.snapshot();

    // At 60 the worst-case kit sells for 995¢ ≥ rescue_cost 800¢.
    const condition = await request(server)
      .patch('/v1/admin/tuning/config/parts.restart_condition_max')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 60, expectedRevision, reason: 'easier restarts' });
    expect(condition.status).toBe(400);
    expect(condition.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      issues: [
        { key: 'parts.restart_condition_max', message: 'RESTART_KIT_NOT_WORTH_LESS_THAN_RESCUE' },
      ],
    });

    // Lowering rescue_cost below the kit's worst-case 499¢ is the same violation.
    const rescue = await request(server)
      .patch('/v1/admin/tuning/config/economy.rescue_cost')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 490, expectedRevision, reason: 'cheaper rescue' });
    expect(rescue.status).toBe(400);
    expect(rescue.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      issues: [{ key: 'economy.rescue_cost', message: 'RESTART_KIT_NOT_WORTH_LESS_THAN_RESCUE' }],
    });

    // 499 < 510 still holds, so the same key accepts a safe value.
    const allowed = await request(server)
      .patch('/v1/admin/tuning/config/economy.rescue_cost')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 510, expectedRevision, reason: 'slightly cheaper rescue' });
    expect(allowed.status).toBe(200);

    const after = gameConfigService.snapshot();
    expect(after.rules.parts.restart_condition_max).toBe(before.rules.parts.restart_condition_max);
    expect(after.rules.economy.rescue_cost).toBe(510);
    const conditionRevisions = await prisma.tuningRevision.findMany({
      where: { entityId: 'parts.restart_condition_max' },
    });
    expect(conditionRevisions).toHaveLength(0);
  });

  it('returns 409 when expectedRevision does not match the current latest revision', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 500, expectedRevision: -1, reason: 'stale write' });
    expect(response.status).toBe(409);
    const body = response.body as RevisionMismatchResponse;
    expect(body.error).toBe('REVISION_MISMATCH');
    expect(typeof body.currentRevision).toBe('number');
  });

  it('reverts a revision and restores the prior value as a new revision', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const first = await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 999, expectedRevision: 0, reason: 'set high' });
    expect(first.status).toBe(200);

    const revert = await request(server)
      .post(`/v1/admin/tuning/revisions/${(first.body as TuningRevisionResponse).id}/revert`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'undo increase' });
    expect(revert.status).toBe(200);
    const revertedRevision = revert.body as TuningRevisionResponse;
    expect(revertedRevision.entityId).toBe('economy.start_credits');
    expect(revertedRevision.after).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);

    const listResponse = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const entry = findEntry(listResponse.body as ConfigEntry[], 'economy.start_credits');
    expect(entry.currentValue).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
  });

  it('GET /revisions returns revisions newest first with serializable ids', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 400, expectedRevision: 0, reason: 'first' });
    await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 500, expectedRevision: 1, reason: 'second' });

    const response = await request(server)
      .get(
        '/v1/admin/tuning/revisions?entityType=GameConfig&entityId=economy.start_credits&limit=10',
      )
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const body = response.body as Array<Record<string, unknown>>;
    expect(body.length).toBe(2);
    expect(typeof body[0]!.id).toBe('string');
    expect(body[0]!.after).toBe(500);
    expect(body[1]!.after).toBe(400);
  });

  it('rejects non-admin requests with 403', async () => {
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
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('bundle dry-run returns diffs without writing', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const response = await request(server)
      .post('/v1/admin/tuning/bundle?dryRun=true')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entries: [
          { key: 'economy.start_credits', value: 777 },
          { key: 'combat.dc_base', value: 15 },
        ],
      });
    expect(response.status).toBe(200);
    const body = response.body as BundleDryRunResponse;
    expect(body.valid).toBe(true);
    expect(body.diffs).toHaveLength(2);

    const startCreditsDiff = body.diffs.find((d) => d.key === 'economy.start_credits');
    if (!startCreditsDiff) throw new Error('expected start_credits diff');
    expect(startCreditsDiff.before).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
    expect(startCreditsDiff.after).toBe(777);

    const listResponse = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const entry = findEntry(listResponse.body as ConfigEntry[], 'economy.start_credits');
    expect(entry.modified).toBe(false);
  });

  it('bundle import atomically updates multiple keys; an invalid entry rejects all writes', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const validResponse = await request(server)
      .post('/v1/admin/tuning/bundle')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entries: [
          { key: 'economy.start_credits', value: 888 },
          { key: 'combat.dc_base', value: 14 },
        ],
      });
    expect(validResponse.status).toBe(200);
    const validBody = validResponse.body as BundleImportResponse;
    expect(validBody.revisions).toHaveLength(2);

    const listResponse = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const body = listResponse.body as ConfigEntry[];
    expect(findEntry(body, 'economy.start_credits').currentValue).toBe(888);
    expect(findEntry(body, 'combat.dc_base').currentValue).toBe(14);

    const invalidResponse = await request(server)
      .post('/v1/admin/tuning/bundle')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entries: [
          { key: 'economy.start_credits', value: 111 },
          { key: 'combat.dc_base', value: 999 },
        ],
      });
    expect(invalidResponse.status).toBe(400);
    const invalidBody = invalidResponse.body as ValidationErrorResponse;
    expect(invalidBody.error).toBe('VALIDATION_ERROR');

    const listAfter = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const afterBody = listAfter.body as ConfigEntry[];
    expect(findEntry(afterBody, 'economy.start_credits').currentValue).toBe(888);
    expect(findEntry(afterBody, 'combat.dc_base').currentValue).toBe(14);
  });

  it('bundle dry-run and import apply the restart-kit invariant to the whole bundle (S8.6)', async () => {
    await freshSeeded();
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    const alone = await request(server)
      .post('/v1/admin/tuning/bundle?dryRun=true')
      .set('Authorization', `Bearer ${token}`)
      .send({ entries: [{ key: 'parts.restart_condition_max', value: 50 }] });
    expect(alone.status).toBe(400);
    expect(alone.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      issues: [{ key: 'bundle', message: 'RESTART_KIT_NOT_WORTH_LESS_THAN_RESCUE' }],
    });

    // The same condition paired with a rescue_cost that still covers the kit (1227¢ at 50)
    // is evaluated as a whole and stays valid.
    const paired = await request(server)
      .post('/v1/admin/tuning/bundle?dryRun=true')
      .set('Authorization', `Bearer ${token}`)
      .send({
        entries: [
          { key: 'parts.restart_condition_max', value: 50 },
          { key: 'economy.rescue_cost', value: 1500 },
        ],
      });
    expect(paired.status).toBe(200);
    expect((paired.body as BundleDryRunResponse).valid).toBe(true);

    const rejected = await request(server)
      .post('/v1/admin/tuning/bundle')
      .set('Authorization', `Bearer ${token}`)
      .send({ entries: [{ key: 'economy.rescue_cost', value: 490 }] });
    expect(rejected.status).toBe(400);

    const listResponse = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const body = listResponse.body as ConfigEntry[];
    // Nothing was written by either rejected call.
    expect(findEntry(body, 'economy.rescue_cost').currentValue).toBe(
      GAME_CONFIG_DEFAULTS.economy.rescue_cost,
    );
    expect(findEntry(body, 'parts.restart_condition_max').currentValue).toBe(
      GAME_CONFIG_DEFAULTS.parts.restart_condition_max,
    );
  });

  it('POST /v1/admin/tuning/config/:key/reset restores the factory default and sets modified: false', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 1234, expectedRevision: 0, reason: 'override' });

    const resetResponse = await request(server)
      .post('/v1/admin/tuning/config/economy.start_credits/reset')
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedRevision: 1, reason: 'restore factory default' });
    expect(resetResponse.status).toBe(200);
    const resetRevision = resetResponse.body as TuningRevisionResponse;
    expect(resetRevision.entityId).toBe('economy.start_credits');
    expect(resetRevision.after).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);

    const listResponse = await request(server)
      .get('/v1/admin/tuning/config')
      .set('Authorization', `Bearer ${token}`);
    const entry = findEntry(listResponse.body as ConfigEntry[], 'economy.start_credits');
    expect(entry.currentValue).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
    expect(entry.modified).toBe(false);
  });

  it('reflects the new start_credits in the live rules within 2 s (D33 immediate effect)', async () => {
    const server = httpServer(testApp.app);
    const admin = await createAdmin(prisma, passwordService);
    const token = await loginAdmin(server, admin);

    await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 3333, expectedRevision: 0, reason: 'live tuning test' });

    const deadline = Date.now() + 2000;
    let current = gameConfigService.snapshot();
    while (current.rules.economy.start_credits !== 3333 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      current = gameConfigService.snapshot();
    }

    expect(current.rules.economy.start_credits).toBe(3333);
  });
});
