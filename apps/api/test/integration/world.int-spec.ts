import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface WorldLocationBody {
  id: string;
  displayName: { en: string; 'pt-BR': string };
  description: { en: string; 'pt-BR': string };
  type: string;
  x: number;
  y: number;
  zone: number;
  factionId: string;
  isolation: number;
  services: Record<string, unknown>;
  risk: 'lo' | 'md' | 'hi';
  missionCount: number;
}

interface WorldRouteBody {
  id: string;
  nodeAId: string;
  nodeBId: string;
  distance: number;
  danger: number;
  hot: boolean;
}

interface WorldResponseBody {
  locations: WorldLocationBody[];
  routes: WorldRouteBody[];
}

// S10.5: the map screen's data source — geometry, routes, server-computed risk bands
// and live mission counts that match what each board would serve (same flip/top-up).
describe('world map API (S10.5)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    await resetDatabase(prisma);
  });

  beforeEach(async () => {
    // A fresh account every test: resetDatabase wipes players, so a token minted in
    // beforeAll would outlive the player it names.
    await seed(prisma);
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  const auth = (value: string): { Authorization: string } => ({
    Authorization: `Bearer ${value}`,
  });

  function expectedRisk(zone: number): 'lo' | 'md' | 'hi' {
    if (zone <= 1) return 'lo';
    if (zone === 2) return 'md';
    return 'hi';
  }

  it('requires an access token', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/locations');
    expect(response.status).toBe(401);
  });

  it('serves every location and route with geometry, risk bands and mission counts', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/locations').set(auth(token));
    expect(response.status).toBe(200);
    const body = response.body as WorldResponseBody;

    expect(body.locations).toHaveLength(12);
    expect(body.routes.length).toBeGreaterThanOrEqual(10);
    const ids = new Set(body.locations.map((location) => location.id));
    expect(ids.size).toBe(12);
    expect(ids.has('ceres')).toBe(true);
    expect(ids.has('cair')).toBe(true);

    for (const location of body.locations) {
      expect(typeof location.x).toBe('number');
      expect(typeof location.y).toBe('number');
      expect(location.zone).toBeGreaterThanOrEqual(0);
      expect(location.zone).toBeLessThanOrEqual(3);
      expect(location.risk).toBe(expectedRisk(location.zone));
      expect(typeof location.factionId).toBe('string');
      expect(typeof location.isolation).toBe('number');
      expect(typeof location.displayName.en).toBe('string');
      expect(typeof location.displayName['pt-BR']).toBe('string');
      // The count runs the board's own top-up, so a virgin world reports at least
      // the board_min of live offers at every location (GDD §12).
      expect(location.missionCount).toBeGreaterThanOrEqual(1);
    }

    for (const route of body.routes) {
      expect(ids.has(route.nodeAId)).toBe(true);
      expect(ids.has(route.nodeBId)).toBe(true);
      expect(route.distance).toBeGreaterThanOrEqual(400);
      expect(route.danger).toBeGreaterThanOrEqual(0);
      expect(route.danger).toBeLessThanOrEqual(10);
      // The server owns the "hot corridor" threshold; the client just reads the flag.
      expect(route.hot).toBe(route.danger >= 8);
    }
  }, 30_000);

  it('is stable on a second read: full boards mean no further generation', async () => {
    const first = await request(httpServer(testApp.app)).get('/v1/locations').set(auth(token));
    expect(first.status).toBe(200);
    const generated = await prisma.missionInstance.count();

    const second = await request(httpServer(testApp.app)).get('/v1/locations').set(auth(token));
    expect(second.status).toBe(200);
    expect(await prisma.missionInstance.count()).toBe(generated);

    const a = (first.body as WorldResponseBody).locations;
    const b = (second.body as WorldResponseBody).locations;
    expect(b.map((location) => [location.id, location.missionCount])).toEqual(
      a.map((location) => [location.id, location.missionCount]),
    );
  }, 30_000);
});
