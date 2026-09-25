import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app-factory.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/**
 * Behind the nginx proxy the client's address is in X-Forwarded-For. The app trusts that header
 * from a private-network peer (the proxy), so per-IP limits and the admin audit log see real
 * clients. supertest connects from 127.0.0.1, i.e. exactly such a trusted peer.
 */
describe('trust proxy', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('keys the per-IP throttle on the forwarded client, not on the proxy', async () => {
    const server = httpServer(testApp.app);
    const register = (clientIp: string) =>
      request(server).post('/v1/auth/register').set('X-Forwarded-For', clientIp).send({});

    // register allows 3 per minute per IP (auth policy): the 4th from ONE client is refused...
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await register('203.0.113.10')).status).toBe(400);
    }
    expect((await register('203.0.113.10')).status).toBe(429);
    // ...while a different client behind the same proxy still has its own budget.
    expect((await register('203.0.113.11')).status).toBe(400);
  });
});
