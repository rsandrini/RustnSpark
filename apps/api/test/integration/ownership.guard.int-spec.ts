import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { OwnershipTestModule } from '../support/ownership-test.module.js';
import { OwnershipTestFixtures } from '../support/ownership-test.fixtures.js';
import { TokenService } from '../../src/auth/token.service.js';

// Proves OwnershipGuard's 403/404 behaviour through a real Nest HTTP pipeline (S2.4's controller
// rulings require this, not just a hand-built ExecutionContext mock), using the test-only widget
// resolver (test/support/ownership-test.module.ts) since no real ownable domain exists yet.

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('OwnershipGuard (real HTTP pipeline, test-only widget resource)', () => {
  let testApp: TestApp;
  let fixtures: OwnershipTestFixtures;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    testApp = await createTestApp({}, [OwnershipTestModule]);
    const tokenService = testApp.app.get(TokenService);
    fixtures = testApp.app.get(OwnershipTestFixtures);
    ownerToken = await tokenService.signAccessToken({
      accountId: 'account-owner',
      playerId: 'player-owner',
      role: 'PLAYER',
    });
    otherToken = await tokenService.signAccessToken({
      accountId: 'account-other',
      playerId: 'player-other',
      role: 'PLAYER',
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(() => {
    fixtures.clear();
    fixtures.setOwner('widget-owned', 'player-owner');
  });

  it('returns 200 when the current player owns the resource', async () => {
    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/widget-owned')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'widget-owned', requestedBy: 'player-owner' });
  });

  it('returns 403 when the resource belongs to another player', async () => {
    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/widget-owned')
      .set('Authorization', `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
  });

  it('returns 404 when the resource does not exist', async () => {
    const response = await request(httpServer(testApp.app))
      .get('/v1/test/widgets/does-not-exist')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(response.status).toBe(404);
  });

  it('returns 401 before ownership is ever checked when there is no token', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/test/widgets/widget-owned');
    expect(response.status).toBe(401);
  });
});
