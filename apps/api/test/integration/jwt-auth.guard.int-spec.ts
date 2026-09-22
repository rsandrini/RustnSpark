import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { createTestApp, testEnv, type TestApp } from '../support/app-factory.js';
import { OwnershipTestModule } from '../support/ownership-test.module.js';
import { OwnershipTestFixtures } from '../support/ownership-test.fixtures.js';
import { TokenService } from '../../src/auth/token.service.js';

// Proves the global JwtAuthGuard (registered as APP_GUARD, R28) actually rejects unauthenticated
// requests through a real Nest HTTP pipeline, not just a hand-built ExecutionContext mock.
// Uses the test-only widget route (test/support/ownership-test.controller.ts) as a stand-in
// protected endpoint, since no real authenticated route exists yet (S2.3's job).

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('JwtAuthGuard (global, real HTTP pipeline)', () => {
  let testApp: TestApp;
  let tokenService: TokenService;
  let fixtures: OwnershipTestFixtures;
  const playerId = 'player-jwt-1';
  const accountId = 'account-jwt-1';

  beforeAll(async () => {
    testApp = await createTestApp({}, [OwnershipTestModule]);
    // TokenService is provided directly on AppModule (app.module.ts) for the global guard's own
    // DI needs; fetching it from the compiled app reuses that exact instance and its secret.
    tokenService = testApp.app.get(TokenService);
    fixtures = testApp.app.get(OwnershipTestFixtures);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(() => {
    fixtures.clear();
    fixtures.setOwner('widget-1', playerId);
  });

  it('rejects with 401 when no Authorization header is present', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/test/widgets/widget-1');
    expect(response.status).toBe(401);
  });

  it('rejects with 401 for a non-Bearer Authorization header', async () => {
    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/widget-1')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(response.status).toBe(401);
  });

  it('rejects with 401 for a tampered (bad signature) token', async () => {
    const token = await tokenService.signAccessToken({ accountId, playerId, role: 'PLAYER' });
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/widget-1')
      .set('Authorization', `Bearer ${tampered}`);
    expect(response.status).toBe(401);
  });

  it('rejects with 401 for an expired token', async () => {
    const secret = new TextEncoder().encode(testEnv().JWT_ACCESS_SECRET);
    const expired = await new SignJWT({ pid: playerId, role: 'PLAYER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId)
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(secret);

    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/widget-1')
      .set('Authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
  });

  it('allows a valid token through to the route handler', async () => {
    const token = await tokenService.signAccessToken({ accountId, playerId, role: 'PLAYER' });

    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/widget-1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'widget-1', requestedBy: playerId });
  });
});
