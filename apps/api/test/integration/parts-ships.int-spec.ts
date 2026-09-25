import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { PartInstance } from '@prisma/client';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const HOME_LOCATIONS: Readonly<Record<string, string>> = {
  luna: 'ceres',
  sun: 'hedus',
  explorers: 'cair',
};

interface AuthPair {
  seeded: SeededPlayer;
  token: string;
}

interface SheetShape {
  fuelCap: number;
  pot: number;
  hp: number;
  mob: number;
}

interface ShipResponse {
  id: string;
  ownerPlayerId: string;
  name: string;
  fuel: number;
  status: string;
  currentLocationId: string;
  stance: string;
  layout: Array<Record<string, unknown>>;
  sheet: SheetShape;
}

interface PreviewResponse {
  sheet: SheetShape;
  viability: { viable: boolean; problems: Array<Record<string, unknown>> };
  layout: Array<Record<string, unknown>>;
  omittedPartInstanceIds: string[];
}

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function asShip(response: request.Response): ShipResponse {
  return response.body as ShipResponse;
}

function asPreview(response: request.Response): PreviewResponse {
  return response.body as PreviewResponse;
}

describe('parts and ships API (S4.3)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let configService: GameConfigService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    configService = testApp.app.get(GameConfigService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    if (prisma) await resetDatabase(prisma);
  });

  async function seedAndToken(
    overrides: Parameters<typeof seedAccountWithPlayer>[2] = {},
  ): Promise<AuthPair> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, overrides);
    const tokenService = testApp.app.get(TokenService);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    return { seeded, token };
  }

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  function onboard(token: string, faction: string): Promise<request.Response> {
    return request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction });
  }

  describe('onboarding', () => {
    it.each(['luna', 'sun', 'explorers'] as const)(
      'creates a viable ship at the %s home port with a full tank',
      async (faction) => {
        await freshSeededApp();
        const { token } = await seedAndToken();

        const response = await onboard(token, faction);

        expect(response.status).toBe(200);
        const ship = asShip(response);
        expect(ship.status).toBe('IN_PORT');
        expect(ship.stance).toBe('NEUTRAL');
        expect(ship.currentLocationId).toBe(HOME_LOCATIONS[faction]);
        expect(ship.fuel).toBe(ship.sheet.fuelCap);
        expect(ship.sheet.pot).toBeGreaterThan(0);
        expect(ship.sheet.hp).toBeGreaterThan(0);
        expect(ship.sheet.mob).toBeGreaterThanOrEqual(1);

        const player = await prisma.player.findUniqueOrThrow({ where: { id: ship.ownerPlayerId } });
        expect(player.credits).toBe(200);
        expect(player.factionId).toBe(faction);

        const parts = await prisma.partInstance.findMany({ where: { ownerPlayerId: player.id } });
        expect(parts.length).toBe(7);
        for (const part of parts) {
          expect(part.condition).toBe(80);
        }
      },
    );

    it('is idempotent; a second call returns the same ship', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();

      const first = await onboard(token, 'luna');
      expect(first.status).toBe(200);
      const second = await onboard(token, 'luna');

      expect(second.status).toBe(200);
      expect(asShip(second).id).toBe(asShip(first).id);
    });

    it('creates exactly one ship and one starter credit under concurrent onboarding', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();

      const responses = await Promise.all([
        onboard(token, 'luna'),
        onboard(token, 'luna'),
        onboard(token, 'luna'),
      ]);

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(responses.map((r) => asShip(r).id)).size).toBe(1);
      expect(await prisma.ship.count({ where: { ownerPlayerId: seeded.player.id } })).toBe(1);
      const events = await prisma.playerEvent.count({
        where: { playerId: seeded.player.id, type: 'wallet.credit' },
      });
      expect(events).toBe(1);
    });

    it('rejects a faction that has no configured home location with 400', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();

      const response = await onboard(token, 'not_a_faction');

      expect(response.status).toBe(400);
    });

    it('rejects a different faction after onboarding with 409', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();

      const first = await onboard(token, 'luna');
      expect(first.status).toBe(200);
      const second = await onboard(token, 'sun');

      expect(second.status).toBe(409);
    });
  });

  describe('catalog and inventory', () => {
    it('GET /v1/parts/catalog returns active parts with localized names', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();

      const response = await request(httpServer(testApp.app))
        .get('/v1/parts/catalog?locale=en')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const items = response.body as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      const bridge = items.find((item) => item.partType === 'bridge');
      expect(bridge).toBeDefined();
      expect(bridge?.displayName).toBe('Bridge');
      expect(bridge?.partClass).toBe('BRIDGE');
    });

    it('GET /v1/parts/catalog respects pt-BR locale', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();

      const response = await request(httpServer(testApp.app))
        .get('/v1/parts/catalog?locale=pt-BR')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const items = response.body as Array<Record<string, unknown>>;
      const bridge = items.find((item) => item.partType === 'bridge');
      expect(bridge?.displayName).toBe('Ponte de Comando');
    });

    it("GET /v1/parts/catalog defaults to the player's saved locale when no query is given", async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      await prisma.player.update({ where: { id: seeded.player.id }, data: { locale: 'pt-BR' } });

      const response = await request(httpServer(testApp.app))
        .get('/v1/parts/catalog')
        .set('Authorization', `Bearer ${token}`);

      const items = response.body as Array<Record<string, unknown>>;
      expect(items.find((item) => item.partType === 'bridge')?.displayName).toBe(
        'Ponte de Comando',
      );
    });

    it('GET /v1/inventory after onboarding lists starter parts', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();
      await onboard(token, 'luna');

      const response = await request(httpServer(testApp.app))
        .get('/v1/inventory')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const items = response.body as Array<Record<string, unknown>>;
      expect(items.length).toBe(7);
      const types = items.map((item) => item.partType as string).sort();
      expect(types).toEqual(
        [
          'bridge',
          'battery_small',
          'cargo',
          'cargo',
          'engine_chem_small',
          'hull',
          'tank_small',
        ].sort(),
      );
      for (const item of items) {
        expect(item.condition).toBe(80);
        expect(item.catalog).toBeDefined();
        // Owned parts carry a real name in both locales (the UI used to fall back to the raw
        // part code because the inventory response had no name at all).
        const name = item.displayName as { en: string; 'pt-BR': string };
        expect(name.en).not.toBe('');
        expect(name['pt-BR']).not.toBe('');
        expect(name.en).not.toBe(item.partType);
      }
    });
  });

  describe('ship queries', () => {
    it('GET /v1/ships/:id returns the ship with a server-derived sheet', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      const response = await request(httpServer(testApp.app))
        .get(`/v1/ships/${shipId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const ship = asShip(response);
      expect(ship.id).toBe(shipId);
      expect(ship.sheet).toBeDefined();
      expect(ship.sheet.mob).toBeGreaterThanOrEqual(1);
    });

    it('GET /v1/ships lists the player ships', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');

      const response = await request(httpServer(testApp.app))
        .get('/v1/ships')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const ships = response.body as Array<Record<string, unknown>>;
      expect(ships.length).toBe(1);
      expect(ships[0]?.id).toBe(asShip(onboarded).id);
    });
  });

  describe('assemble', () => {
    it('POST /v1/ships/:id/assemble with a valid layout updates the ship and parts', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      // Move all starter parts to inventory for a clean manual layout.
      await prisma.partInstance.updateMany({
        where: { ownerPlayerId: seeded.player.id },
        data: { location: 'INVENTORY', shipId: null },
      });
      await prisma.ship.update({ where: { id: shipId }, data: { layout: [] } });

      const parts = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id },
      });
      const take = (partType: string): PartInstance => {
        const index = parts.findIndex((p) => p.partType === partType);
        if (index === -1) throw new Error(`missing part ${partType}`);
        return parts.splice(index, 1)[0]!;
      };
      const layout = [
        { partInstanceId: take('bridge').id, gx: 0, gy: 0, rot: 0 },
        { partInstanceId: take('engine_chem_small').id, gx: 1, gy: 0, rot: 0 },
        { partInstanceId: take('tank_small').id, gx: 2, gy: 0, rot: 0 },
        { partInstanceId: take('battery_small').id, gx: 3, gy: 0, rot: 0 },
        { partInstanceId: take('cargo').id, gx: 4, gy: 0, rot: 0 },
        { partInstanceId: take('cargo').id, gx: 5, gy: 0, rot: 0 },
        { partInstanceId: take('hull').id, gx: 6, gy: 0, rot: 0 },
      ];

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout });

      expect(response.status).toBe(200);
      const ship = asShip(response);
      expect(ship.id).toBe(shipId);
      expect(ship.layout).toEqual(layout);

      const installed = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id, location: 'INSTALLED' },
      });
      expect(installed.length).toBe(7);
      for (const part of installed) {
        expect(part.shipId).toBe(shipId);
      }
    });

    it('returns 403 when assembling another players ship', async () => {
      await freshSeededApp();
      const { token: ownerToken, seeded: owner } = await seedAndToken();
      await onboard(ownerToken, 'luna');
      const ownerParts = await prisma.partInstance.findMany({
        where: { ownerPlayerId: owner.player.id },
      });

      const { token: otherToken } = await seedAndToken();
      const otherShip = await onboard(otherToken, 'sun');

      const layout = ownerParts.map((part, index) => ({
        partInstanceId: part.id,
        gx: index,
        gy: 0,
        rot: 0,
      }));

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${asShip(otherShip).id}/assemble`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ layout });

      expect(response.status).toBe(403);
    });

    it('returns 403/404 when using a part the player does not own', async () => {
      await freshSeededApp();
      const { token: ownerToken } = await seedAndToken();
      const ownerShip = await onboard(ownerToken, 'luna');

      const { seeded: other } = await seedAndToken();
      const foreignPart = await prisma.partInstance.create({
        data: {
          partType: 'bridge',
          ownerPlayerId: other.player.id,
          condition: 80,
          location: 'INVENTORY',
        },
      });

      const layout = [{ partInstanceId: foreignPart.id, gx: 0, gy: 0, rot: 0 }];
      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${asShip(ownerShip).id}/assemble`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ layout });

      expect([403, 404]).toContain(response.status);
    });

    it('returns 409 when installing a part already installed in another ship', async () => {
      await freshSeededApp();
      const { token: aToken, seeded: a } = await seedAndToken();
      const aShip = await onboard(aToken, 'luna');

      const { seeded: b } = await seedAndToken();
      const bShip = await prisma.ship.create({
        data: {
          ownerPlayerId: b.player.id,
          name: 'b-ship',
          layout: [],
          currentLocationId: 'hedus',
        },
      });

      // Create a part owned by A but mark it as installed in B's ship.
      const aPart = await prisma.partInstance.create({
        data: {
          partType: 'hull',
          ownerPlayerId: a.player.id,
          condition: 80,
          location: 'INSTALLED',
          shipId: bShip.id,
        },
      });

      const aParts = await prisma.partInstance.findMany({ where: { ownerPlayerId: a.player.id } });
      const layout = [
        { partInstanceId: aParts[0]!.id, gx: 0, gy: 0, rot: 0 },
        { partInstanceId: aPart.id, gx: 1, gy: 0, rot: 0 },
      ];

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${asShip(aShip).id}/assemble`)
        .set('Authorization', `Bearer ${aToken}`)
        .send({ layout });

      expect(response.status).toBe(409);
    });

    it('returns 409 when assembling while ON_MISSION', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;
      await prisma.ship.update({ where: { id: shipId }, data: { status: 'ON_MISSION' } });

      const parts = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id },
      });
      const layout = parts.map((part, index) => ({
        partInstanceId: part.id,
        gx: index,
        gy: 0,
        rot: 0,
      }));

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout });

      expect(response.status).toBe(409);
    });

    it('rejects forged mob/hp fields with 400', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      const parts = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id },
      });
      const layout = parts.map((part, index) => ({
        partInstanceId: part.id,
        gx: index,
        gy: 0,
        rot: 0,
      }));

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout, mob: 99, hp: 999 });

      expect(response.status).toBe(400);
    });
  });

  describe('auto-assemble', () => {
    it('produces a viable ship', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      // Move parts back to inventory so auto-assemble has material to work with.
      await prisma.partInstance.updateMany({
        where: { ownerPlayerId: seeded.player.id },
        data: { location: 'INVENTORY', shipId: null },
      });
      await prisma.ship.update({ where: { id: shipId }, data: { layout: [] } });

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/auto-assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(200);
      const ship = asShip(response);
      expect(ship.sheet.mob).toBeGreaterThanOrEqual(1);
      expect(ship.sheet.fuelCap).toBeGreaterThan(0);
    });
  });

  describe('auto-assemble consistency', () => {
    async function withOversizedPart(): Promise<{
      token: string;
      shipId: string;
      oversizedId: string;
    }> {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;
      const hull = await prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'hull' } });
      await prisma.partCatalog.create({
        data: {
          ...hull,
          partType: 'oversized_test',
          w: 25,
          h: 25,
          displayName: hull.displayName ?? {},
          description: hull.description ?? {},
          specialProp: hull.specialProp ?? undefined,
        },
      });
      const oversized = await prisma.partInstance.create({
        data: { partType: 'oversized_test', ownerPlayerId: seeded.player.id, condition: 100 },
      });
      await prisma.partInstance.updateMany({
        where: { ownerPlayerId: seeded.player.id, id: { not: oversized.id } },
        data: { location: 'INVENTORY', shipId: null },
      });
      await prisma.ship.update({ where: { id: shipId }, data: { layout: [] } });
      return { token, shipId, oversizedId: oversized.id };
    }

    it('rejects auto-assemble when a part cannot be placed instead of saving a different ship', async () => {
      const { token, shipId, oversizedId } = await withOversizedPart();

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/auto-assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('AUTO_LAYOUT_OMITTED_PARTS');
      expect(JSON.stringify(response.body)).toContain(oversizedId);
      const saved = await prisma.ship.findUniqueOrThrow({ where: { id: shipId } });
      expect(saved.layout).toEqual([]);
    });

    it('reports omitted parts in preview and derives the sheet from placed parts only', async () => {
      const { token, shipId, oversizedId } = await withOversizedPart();

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(200);
      expect(asPreview(response).omittedPartInstanceIds).toEqual([oversizedId]);
    });

    it('rejects auto-assemble referencing a part the player does not own with 403', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/auto-assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({ partInstanceIds: ['00000000-0000-4000-8000-000000000000'] });

      expect(response.status).toBe(403);
    });
  });

  describe('preview', () => {
    it('works while ON_MISSION and never persists changes', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;
      await prisma.ship.update({ where: { id: shipId }, data: { status: 'ON_MISSION' } });

      const layout = (await prisma.ship.findUniqueOrThrow({ where: { id: shipId } }))
        .layout as Array<Record<string, unknown>>;

      const before = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id },
      });
      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout });

      expect(response.status).toBe(200);
      const preview = asPreview(response);
      expect(preview.sheet).toBeDefined();
      expect(preview.viability).toBeDefined();
      expect(preview.layout).toEqual(layout);

      const after = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id },
      });
      expect(
        after.map((p) => ({ id: p.id, location: p.location, shipId: p.shipId })).sort(),
      ).toEqual(before.map((p) => ({ id: p.id, location: p.location, shipId: p.shipId })).sort());
    });
  });

  describe('stance', () => {
    it('updates stance and blocks changes while ON_MISSION', async () => {
      await freshSeededApp();
      const { token } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      const first = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/stance`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stance: 'DEFENSIVE' });
      expect(first.status).toBe(200);
      expect(asShip(first).stance).toBe('DEFENSIVE');

      await prisma.ship.update({ where: { id: shipId }, data: { status: 'ON_MISSION' } });

      const second = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/stance`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stance: 'AGGRESSIVE' });
      expect(second.status).toBe(409);
    });
  });
});
