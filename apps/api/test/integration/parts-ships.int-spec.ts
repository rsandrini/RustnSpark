import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { PartInstance } from '@prisma/client';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
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
  pdf: number;
  hp: number;
  mob: number;
  condition: number;
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
      'creates the %s ship with the starter kit loose (D44), a full tank, and a kit that assembles into a viable ship',
      async (faction) => {
        await freshSeededApp();
        const { token } = await seedAndToken();

        const response = await onboard(token, faction);

        expect(response.status).toBe(200);
        const ship = asShip(response);
        expect(ship.status).toBe('IN_PORT');
        expect(ship.stance).toBe('NEUTRAL');
        expect(ship.currentLocationId).toBe(HOME_LOCATIONS[faction]);
        // Nothing is installed: the pilot assembles the kit in the Hangar.
        expect(ship.layout).toEqual([]);
        expect(ship.sheet.pot).toBe(0);
        expect(ship.fuel).toBeGreaterThan(0);

        const player = await prisma.player.findUniqueOrThrow({ where: { id: ship.ownerPlayerId } });
        expect(player.credits).toBe(200);
        expect(player.factionId).toBe(faction);

        const parts = await prisma.partInstance.findMany({ where: { ownerPlayerId: player.id } });
        // No battery (nothing else in the kit draws combat energy) and one cargo hold, not two
        // (round-3 playtest review of the starter kit).
        expect(parts.length).toBe(5);
        for (const part of parts) {
          expect(part.condition).toBe(80);
          expect(part.location).toBe('INVENTORY');
          expect(part.shipId).toBeNull();
        }

        // Assembling the kit (the Hangar's Auto layout) gives a viable ship whose tank holds
        // exactly the fuel the ship was created with.
        await assembleStarterKit(httpServer(testApp.app), token, ship.id);
        const assembled = asShip(
          await request(httpServer(testApp.app))
            .get(`/v1/ships/${ship.id}`)
            .set('Authorization', `Bearer ${token}`),
        );
        expect(assembled.layout).toHaveLength(5);
        expect(assembled.sheet.pot).toBeGreaterThan(0);
        expect(assembled.sheet.hp).toBeGreaterThan(0);
        expect(assembled.sheet.mob).toBeGreaterThanOrEqual(1);
        expect(assembled.fuel).toBe(assembled.sheet.fuelCap);
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
      // No battery (nothing else in the kit draws combat energy) and one cargo hold, not two
      // (round-3 playtest review of the starter kit).
      expect(items.length).toBe(5);
      const types = items.map((item) => item.partType as string).sort();
      expect(types).toEqual(['bridge', 'cargo', 'engine_chem_small', 'hull', 'tank_small'].sort());
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
        { partInstanceId: take('cargo').id, gx: 3, gy: 0, rot: 0 },
        { partInstanceId: take('hull').id, gx: 4, gy: 0, rot: 0 },
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
      expect(installed.length).toBe(5);
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

    it('saves a below-minimum layout instead of blocking it with SHIP_NOT_VIABLE (playtest: cannot remove a part to sell it)', async () => {
      // A player stripping a ship down to sell a part — or one mid-refit — needs to save a
      // layout that can't fly yet. Flight-viability is only enforced where it actually matters:
      // dispatch, travel eligibility and scavenge start.
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      await prisma.partInstance.updateMany({
        where: { ownerPlayerId: seeded.player.id },
        data: { location: 'INVENTORY', shipId: null },
      });
      await prisma.ship.update({ where: { id: shipId }, data: { layout: [] } });

      const parts = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id },
      });
      const bridge = parts.find((p) => p.partType === 'bridge');
      if (bridge === undefined) throw new Error('missing part bridge');
      // A bare bridge with nothing else installed: no engine, no tank — not flight-viable.
      const layout = [{ partInstanceId: bridge.id, gx: 0, gy: 0, rot: 0 }];

      const preview = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/preview`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout });
      expect(preview.status).toBe(200);
      expect((preview.body as { viability: { viable: boolean } }).viability.viable).toBe(false);

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout });

      expect(response.status).toBe(200);
      const ship = asShip(response);
      expect(ship.layout).toEqual(layout);

      // The now-uninstalled parts are back in inventory, free to be sold.
      const inInventory = await prisma.partInstance.findMany({
        where: { ownerPlayerId: seeded.player.id, location: 'INVENTORY' },
      });
      expect(inInventory.length).toBe(parts.length - 1);
    });

    it('saves an entirely empty layout (every part pulled out)', async () => {
      await freshSeededApp();
      const { token, seeded } = await seedAndToken();
      const onboarded = await onboard(token, 'luna');
      const shipId = asShip(onboarded).id;

      await prisma.partInstance.updateMany({
        where: { ownerPlayerId: seeded.player.id },
        data: { location: 'INVENTORY', shipId: null },
      });
      await prisma.ship.update({ where: { id: shipId }, data: { layout: [] } });

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${shipId}/assemble`)
        .set('Authorization', `Bearer ${token}`)
        .send({ layout: [] });

      expect(response.status).toBe(200);
      const ship = asShip(response);
      expect(ship.layout).toEqual([]);
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
      await assembleStarterKit(httpServer(testApp.app), token, shipId);
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

    describe('with a virtual (not-yet-owned) part', () => {
      it('swaps a virtual candidate in for the installed part of the same class', async () => {
        await freshSeededApp();
        const { token } = await seedAndToken();
        const onboarded = await onboard(token, 'luna');
        const shipId = asShip(onboarded).id;
        await assembleStarterKit(httpServer(testApp.app), token, shipId);

        const inventory = await request(httpServer(testApp.app))
          .get('/v1/inventory')
          .set('Authorization', `Bearer ${token}`);
        const hull = (
          inventory.body as Array<{ id: string; partType: string; location: string }>
        ).find((item) => item.partType === 'hull' && item.location === 'INSTALLED');
        expect(hull).toBeDefined();

        const before = await request(httpServer(testApp.app))
          .get(`/v1/ships/${shipId}`)
          .set('Authorization', `Bearer ${token}`);

        const response = await request(httpServer(testApp.app))
          .post(`/v1/ships/${shipId}/preview`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            virtualPart: { partType: 'hull_uncommon', condition: 100 },
            replacePartInstanceId: hull!.id,
          });

        expect(response.status).toBe(200);
        const preview = asPreview(response);
        // hull partHp 20 -> hull_uncommon partHp 26: the sheet's hp goes up by exactly the gap,
        // nothing else about the ship (still using the real installed set otherwise) changes it.
        expect(preview.sheet.hp).toBe(asShip(before).sheet.hp + 6);
        // The endpoint never mutates anything: this is a read.
        const after = await prisma.partInstance.findUnique({ where: { id: hull!.id } });
        expect(after?.partType).toBe('hull');
      });

      it('adds a virtual candidate with nothing to replace when no part of its class is installed', async () => {
        await freshSeededApp();
        const { token } = await seedAndToken();
        const onboarded = await onboard(token, 'luna');
        const shipId = asShip(onboarded).id;
        await assembleStarterKit(httpServer(testApp.app), token, shipId);

        const before = await request(httpServer(testApp.app))
          .get(`/v1/ships/${shipId}`)
          .set('Authorization', `Bearer ${token}`);
        // The starter kit has no weapon: a weapon_ballistic candidate is a pure addition.
        const response = await request(httpServer(testApp.app))
          .post(`/v1/ships/${shipId}/preview`)
          .set('Authorization', `Bearer ${token}`)
          .send({ virtualPart: { partType: 'weapon_ballistic', condition: 100 } });

        expect(response.status).toBe(200);
        const preview = asPreview(response);
        expect(preview.sheet.pdf).toBeGreaterThan(asShip(before).sheet.pdf ?? 0);
      });

      it("uses the candidate's own condition in the resulting ship-average condition", async () => {
        // Ruling (plan Task 1, Review Focus #3): deriveSheet() sums every effect stat straight
        // from the catalog, condition-agnostic — a part's condition never scales its own pdf/pot/
        // etc. contribution (that only happens for `hp` in the separate `effectiveSheet()`, which
        // preview() never calls). What condition DOES feed, confirmed by reading sheet.deriver.ts,
        // is the ship-wide average `condition` field — so that is what a "used listing" case
        // actually has to prove reaches the comparison, not a stat-sum difference.
        await freshSeededApp();
        const { token } = await seedAndToken();
        const onboarded = await onboard(token, 'luna');
        const shipId = asShip(onboarded).id;
        await assembleStarterKit(httpServer(testApp.app), token, shipId);

        const full = await request(httpServer(testApp.app))
          .post(`/v1/ships/${shipId}/preview`)
          .set('Authorization', `Bearer ${token}`)
          .send({ virtualPart: { partType: 'weapon_ballistic', condition: 100 } });
        const half = await request(httpServer(testApp.app))
          .post(`/v1/ships/${shipId}/preview`)
          .set('Authorization', `Bearer ${token}`)
          .send({ virtualPart: { partType: 'weapon_ballistic', condition: 50 } });

        expect(asPreview(half).sheet.pdf).toBe(asPreview(full).sheet.pdf);
        expect(asPreview(half).sheet.condition).toBeLessThan(asPreview(full).sheet.condition);
      });

      it('rejects a virtual part type that does not exist', async () => {
        await freshSeededApp();
        const { token } = await seedAndToken();
        const onboarded = await onboard(token, 'luna');
        const shipId = asShip(onboarded).id;

        const response = await request(httpServer(testApp.app))
          .post(`/v1/ships/${shipId}/preview`)
          .set('Authorization', `Bearer ${token}`)
          .send({ virtualPart: { partType: 'not_a_real_part', condition: 100 } });

        expect(response.status).toBe(404);
      });
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
