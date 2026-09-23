import type { Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface CreateAdminArgs {
  email: string;
  password: string;
  name: string;
}

function runCreateAdmin(args: CreateAdminArgs): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    'pnpm',
    ['--filter', 'api', 'admin:create', '--email', args.email, '--password', args.password, '--name', args.name],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', env: process.env },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('admin access (S3.6)', () => {
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

  it('creates an admin via CLI and protects /v1/admin behind the ADMIN role', async () => {
    const server = httpServer(testApp.app);
    const player = await seedAccountWithPlayer(prisma, passwordService, {
      email: 'player@example.com',
      name: 'player_pilot',
    });

    const adminArgs = {
      email: 'admin@example.com',
      password: 'admin-password-1',
      name: 'admin_pilot',
    };
    const createResult = runCreateAdmin(adminArgs);
    expect(createResult.status).toBe(0);
    const idMatch = createResult.stdout.match(
      /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i,
    );
    expect(idMatch).not.toBeNull();
    const adminId = idMatch![0];

    const adminAccount = await prisma.account.findUnique({
      where: { id: adminId },
      include: { player: true },
    });
    expect(adminAccount).not.toBeNull();
    expect(adminAccount?.role).toBe('ADMIN');
    expect(adminAccount?.player).not.toBeNull();
    expect(adminAccount?.player?.name).toBe(adminArgs.name);
    expect(adminAccount?.player?.credits).toBe(0);
    expect(adminAccount?.player?.locale).toBe('en');

    const playerLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: player.email, password: player.password });
    expect(playerLogin.status).toBe(200);
    const playerToken = accessTokenFrom(playerLogin);

    const adminLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: adminArgs.email, password: adminArgs.password });
    expect(adminLogin.status).toBe(200);
    const adminToken = accessTokenFrom(adminLogin);

    const playerResponse = await request(server)
      .get('/v1/admin/health')
      .set('Authorization', `Bearer ${playerToken}`);
    expect(playerResponse.status).toBe(403);

    const adminResponse = await request(server)
      .get('/v1/admin/health')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toEqual({ status: 'ok' });

    const noAuthResponse = await request(server).get('/v1/admin/health');
    expect(noAuthResponse.status).toBe(401);
  }, 20_000);

  it('rejects CLI creation when the email is already in use', async () => {
    await seedAccountWithPlayer(prisma, passwordService, { email: 'taken@example.com' });

    const createResult = runCreateAdmin({
      email: 'taken@example.com',
      password: 'admin-password-1',
      name: 'admin_pilot',
    });

    expect(createResult.status).toBe(1);
  });
});
