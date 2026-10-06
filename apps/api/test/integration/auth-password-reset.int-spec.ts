import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { EmailService } from '../../src/email/email.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('password reset flow', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let sentResetUrl: string | undefined;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);

    // Mock EmailService so no real emails are sent, but capture the reset URL.
    const emailService = testApp.app.get(EmailService);
    emailService.sendPasswordReset = (_email: string, resetUrl: string): Promise<void> => {
      sentResetUrl = resetUrl;
      return Promise.resolve();
    };
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    sentResetUrl = undefined;
  });

  it('sends a reset link and lets the user set a new password', async () => {
    const server = httpServer(testApp.app);
    const seeded = await seedAccountWithPlayer(prisma, passwordService, {
      email: 'reset-me@example.com',
      password: 'old-password-1',
    });

    const forgotResponse = await request(server)
      .post('/v1/auth/forgot-password')
      .send({ email: seeded.email });
    expect(forgotResponse.status).toBe(204);

    expect(sentResetUrl).toBeDefined();
    const token = new URL(sentResetUrl!).searchParams.get('token');
    expect(token).not.toBeNull();

    const resetResponse = await request(server)
      .post('/v1/auth/reset-password')
      .send({ token, newPassword: 'new-password-2' });
    expect(resetResponse.status).toBe(204);

    const oldLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: 'new-password-2' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body).toMatchObject({ accessToken: expect.any(String) });
  });

  it('returns 204 for unknown emails to avoid enumeration', async () => {
    const server = httpServer(testApp.app);
    const response = await request(server)
      .post('/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(response.status).toBe(204);
    expect(sentResetUrl).toBeUndefined();
  });

  it('rejects invalid or expired reset tokens', async () => {
    const server = httpServer(testApp.app);
    const response = await request(server)
      .post('/v1/auth/reset-password')
      .send({ token: 'totally-invalid', newPassword: 'new-password-2' });
    expect(response.status).toBe(400);
  });
});
