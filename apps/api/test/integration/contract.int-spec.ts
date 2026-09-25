import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { z } from 'zod';
import {
  ActiveMissionSchema,
  BuyResponseSchema,
  BundleExportSchema,
  ConfigEntryResponseSchema,
  DispatchResponseSchema,
  EntitySchemaResponseSchema,
  InventoryItemSchema,
  LoginResponseSchema,
  MarketResponseSchema,
  MaterialsResponseSchema,
  MissionOfferSchema,
  PlayerProfileResponseSchema,
  PreviewResponseSchema,
  RefreshResponseSchema,
  RefuelResponseSchema,
  RegisterResponseSchema,
  RepairQuoteResponseSchema,
  RepairStartResponseSchema,
  RescueResponseSchema,
  ScavengeResponseSchema,
  SellMaterialResponseSchema,
  SellResponseSchema,
  ShipResponseSchema,
  TuningRevisionResponseSchema,
  UpdateLocaleResponseSchema,
  WorldResponseSchema,
} from '@rustandspark/contract';
import { seed } from '../../prisma/seed.js';
import { refreshCookiePairFrom } from '../support/auth-fixtures.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { contract } from '../support/contract.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

/**
 * The web client's types come from `packages/contract`. This spec is the other half of that
 * bargain: it calls every endpoint the UI uses against the real app (real Postgres, real
 * Redis) and parses each answer with the SAME zod schemas, so a renamed field, a widened enum
 * or a literal the server never sends (the web once typed the duration class as `'slow'` while
 * the API says `'long'`) fails here instead of in a player's browser. Report endpoints, which
 * need a resolved mission, are covered by the happy-path e2e (real worker).
 */
describe('HTTP contract: real responses match packages/contract', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let server: Server;

  let token: string;
  let playerId: string;
  let shipId: string;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    server = httpServer(testApp.app);
    await resetDatabase(prisma);
    await seed(prisma);
    await testApp.app.get(GameConfigService).refresh();

    // --- a real player: register (cookie session), login, refresh, onboarding -----------------
    const email = `contract-${randomUUID()}@example.com`;
    const registered = await request(server)
      .post('/v1/auth/register')
      .send({ email, password: 'contract-pass-1', name: `contract${randomUUID().slice(0, 8)}` });
    expect(registered.status).toBe(201);
    const registeredBody = contract(RegisterResponseSchema, registered.body, 'POST /auth/register');
    token = registeredBody.accessToken;
    playerId = registeredBody.player.id;

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email, password: 'contract-pass-1' });
    contract(LoginResponseSchema, login.body, 'POST /auth/login');

    const refreshed = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookiePairFrom(registered));
    expect(refreshed.status).toBe(200);
    contract(RefreshResponseSchema, refreshed.body, 'POST /auth/refresh');

    const onboarded = await request(server)
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    shipId = contract(ShipResponseSchema, onboarded.body, 'POST /players/me/onboarding').id;

    // --- an admin ------------------------------------------------------------------------------
    const account = await prisma.account.create({
      data: {
        email: `admin-${randomUUID()}@example.com`,
        passwordHash: await testApp.app.get(PasswordService).hash('admin-password-1'),
        role: 'ADMIN',
        player: {
          create: { name: `admin_${randomUUID().replaceAll('-', '').slice(0, 20)}`, credits: 0 },
        },
      },
      include: { player: true },
    });
    adminToken = await testApp.app.get(TokenService).signAccessToken({
      accountId: account.id,
      playerId: account.player!.id,
      role: 'ADMIN',
    });
  }, 60_000);

  afterAll(async () => {
    await resetDatabase(prisma);
    await testApp?.close();
  });

  const get = (path: string, bearer = token) => request(server).get(path).set(auth(bearer));
  const post = (path: string, body: object = {}, bearer = token) =>
    request(server).post(path).set(auth(bearer)).set('Idempotency-Key', randomUUID()).send(body);

  it('player profile and locale', async () => {
    const me = await get('/v1/players/me');
    expect(me.status).toBe(200);
    const profile = contract(PlayerProfileResponseSchema, me.body, 'GET /players/me');
    expect(profile.factionId).toBe('luna');

    const locale = await post('/v1/players/me/locale', { locale: 'pt-BR' });
    contract(UpdateLocaleResponseSchema, locale.body, 'POST /players/me/locale');
  });

  it('world map', async () => {
    const world = await get('/v1/locations');
    expect(world.status).toBe(200);
    contract(WorldResponseSchema, world.body, 'GET /locations');
  });

  it('ships, inventory and the assembly preview', async () => {
    const ships = await get('/v1/ships');
    const list = contract(z.array(ShipResponseSchema), ships.body, 'GET /ships');
    expect(list).toHaveLength(1);
    contract(ShipResponseSchema, (await get(`/v1/ships/${shipId}`)).body, 'GET /ships/:id');

    const inventory = contract(
      z.array(InventoryItemSchema),
      (await get('/v1/inventory')).body,
      'GET /inventory',
    );
    expect(inventory.length).toBeGreaterThan(0);

    const preview = await post(`/v1/ships/${shipId}/preview`, { layout: list[0]!.layout });
    expect(preview.status).toBe(200);
    contract(PreviewResponseSchema, preview.body, 'POST /ships/:id/preview');

    const auto = await post(`/v1/ships/${shipId}/auto-assemble`, {
      partInstanceIds: inventory.map((part) => part.id),
    });
    expect(auto.status).toBe(200);
    contract(ShipResponseSchema, auto.body, 'POST /ships/:id/auto-assemble');
  });

  it('market: board, buy, sell quote and sell', async () => {
    await prisma.player.update({ where: { id: playerId }, data: { credits: 500_000 } });
    const board = await get('/v1/locations/ceres/market');
    expect(board.status).toBe(200);
    const market = contract(MarketResponseSchema, board.body, 'GET /locations/:id/market');
    const listing = market.listings.find((entry) => entry.kind === 'catalog' && entry.price > 1)!;

    const bought = await post('/v1/market/buy', {
      listingId: listing.listingId,
      expectedPrice: listing.price,
    });
    expect(bought.status).toBe(200);
    contract(BuyResponseSchema, bought.body, 'POST /market/buy');

    const after = contract(
      MarketResponseSchema,
      (await get('/v1/locations/ceres/market')).body,
      'market',
    );
    const offer = after.sellOffers[0]!;
    const sold = await post('/v1/market/sell', {
      partInstanceId: offer.partInstanceId,
      expectedPrice: offer.price,
    });
    expect(sold.status).toBe(200);
    contract(SellResponseSchema, sold.body, 'POST /market/sell');
  });

  it('materials: holdings and sale', async () => {
    await prisma.playerMaterial.create({
      data: { playerId, materialId: 'common_ore', quantity: 5 },
    });
    const materials = await get('/v1/materials');
    expect(materials.status).toBe(200);
    const parsed = contract(MaterialsResponseSchema, materials.body, 'GET /materials');
    const holding = parsed.materials[0]!;
    const sold = await post('/v1/market/sell-material', {
      materialId: holding.materialId,
      quantity: holding.quantity,
      expectedPrice: holding.unitPrice * holding.quantity,
    });
    expect(sold.status).toBe(200);
    contract(SellMaterialResponseSchema, sold.body, 'POST /market/sell-material');
  });

  it('refuel and repair (quote and start)', async () => {
    await prisma.ship.update({ where: { id: shipId }, data: { fuel: 1 } });
    const refuel = await post(`/v1/ships/${shipId}/refuel`, { mode: 'full' });
    expect(refuel.status).toBe(200);
    contract(RefuelResponseSchema, refuel.body, 'POST /ships/:id/refuel');

    const installed = await prisma.partInstance.findFirstOrThrow({
      where: { shipId, location: 'INSTALLED' },
    });
    await prisma.partInstance.update({ where: { id: installed.id }, data: { condition: 40 } });
    const targets = [{ partInstanceId: installed.id, toCondition: 100 }];

    const quote = await post(`/v1/ships/${shipId}/repair/quote`, { targets });
    expect(quote.status).toBe(200);
    contract(RepairQuoteResponseSchema, quote.body, 'POST /ships/:id/repair/quote');

    const started = await post(`/v1/ships/${shipId}/repair`, { targets });
    expect(started.status).toBe(200);
    contract(RepairStartResponseSchema, started.body, 'POST /ships/:id/repair');
    // Leave no pending repair blocking the board/dispatch steps below.
    await prisma.repairJob.updateMany({ where: { shipId }, data: { status: 'COMPLETED' } });
    await prisma.partInstance.update({ where: { id: installed.id }, data: { condition: 100 } });
  });

  it('scavenging', async () => {
    const scavenge = await request(server).post('/v1/locations/ceres/scavenge').set(auth(token));
    expect(scavenge.status).toBe(200);
    contract(ScavengeResponseSchema, scavenge.body, 'POST /locations/:id/scavenge');
  });

  it('board, accept, dispatch and the active mission with its leg windows', async () => {
    let offer: z.infer<typeof MissionOfferSchema> | undefined;
    for (let attempt = 0; attempt < 8 && offer === undefined; attempt += 1) {
      const board = await get('/v1/locations/ceres/missions');
      expect(board.status).toBe(200);
      const offers = contract(
        z.array(MissionOfferSchema),
        board.body,
        'GET /locations/:id/missions',
      );
      offer = offers.find((entry) => entry.status === 'AVAILABLE' && entry.eligibility.eligible);
      if (offer === undefined) {
        await prisma.missionInstance.updateMany({
          where: { originId: 'ceres', status: 'AVAILABLE' },
          data: { expiresAt: new Date(0) },
        });
      }
    }
    expect(offer).toBeDefined();

    const accepted = await request(server)
      .post(`/v1/missions/${offer!.id}/accept`)
      .set(auth(token))
      .send({ shipId });
    expect(accepted.status).toBe(200);

    const dispatched = await request(server)
      .post(`/v1/ships/${shipId}/dispatch`)
      .set(auth(token))
      .send({ missionId: offer!.id });
    expect(dispatched.status).toBe(200);
    contract(DispatchResponseSchema, dispatched.body, 'POST /ships/:id/dispatch');

    const active = contract(
      z.array(ActiveMissionSchema),
      (await get('/v1/missions/active')).body,
      'GET /missions/active',
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.legWindows.length).toBeGreaterThan(0);
  });

  it('rescue of an adrift ship', async () => {
    // The dispatched mission above left the ship ON_MISSION; free it and strand it.
    await prisma.ship.update({ where: { id: shipId }, data: { status: 'ADRIFT', fuel: 0 } });
    const rescue = await post(`/v1/ships/${shipId}/rescue`);
    expect(rescue.status).toBe(200);
    contract(RescueResponseSchema, rescue.body, 'POST /ships/:id/rescue');
  });

  it('admin tuning: config, revisions, bundle and entity schema', async () => {
    const config = await get('/v1/admin/tuning/config', adminToken);
    expect(config.status).toBe(200);
    const entries = contract(
      z.array(ConfigEntryResponseSchema),
      config.body,
      'GET /admin/tuning/config',
    );
    expect(entries.length).toBeGreaterThan(50);

    const latest = await prisma.tuningRevision.findFirst({ orderBy: { id: 'desc' } });
    const patched = await request(server)
      .patch('/v1/admin/tuning/config/economy.start_credits')
      .set(auth(adminToken))
      .send({ value: 250, expectedRevision: Number(latest?.id ?? 0n), reason: 'contract test' });
    expect(patched.status).toBe(200);

    const revisions = await get('/v1/admin/tuning/revisions', adminToken);
    expect(revisions.status).toBe(200);
    contract(z.array(TuningRevisionResponseSchema), revisions.body, 'GET /admin/tuning/revisions');

    const bundle = await get('/v1/admin/tuning/bundle', adminToken);
    expect(bundle.status).toBe(200);
    contract(BundleExportSchema, bundle.body, 'GET /admin/tuning/bundle');

    const schema = await get('/v1/admin/tuning/schema/parts', adminToken);
    expect(schema.status).toBe(200);
    contract(EntitySchemaResponseSchema, schema.body, 'GET /admin/tuning/schema/:entity');
  });
});
