import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { assembleStarterKit } from '../support/assemble.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { seed } from '../../prisma/seed.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

describe('ship rename', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let tokens: TokenService;
  let config: GameConfigService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwords = testApp.app.get(PasswordService);
    tokens = testApp.app.get(TokenService);
    config = testApp.app.get(GameConfigService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function pilot(): Promise<{ seeded: SeededPlayer; token: string; shipId: string }> {
    const seeded = await seedAccountWithPlayer(prisma, passwords);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);
    return { seeded, token, shipId };
  }

  const rename = (token: string, shipId: string, name: string, key: string = randomUUID()) =>
    request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/rename`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ name });

  const credits = async (id: string) =>
    (await prisma.player.findUniqueOrThrow({ where: { id }, select: { credits: true } })).credits;

  it('quotes the fixed prefix, the price and the current name', async () => {
    const p = await pilot();
    const quote = await request(httpServer(testApp.app))
      .get(`/v1/ships/${p.shipId}/rename`)
      .set('Authorization', `Bearer ${p.token}`);
    expect(quote.status).toBe(200);
    expect(quote.body).toMatchObject({
      prefix: 'LUN-',
      price: config.snapshot().rules.economy.ship_rename_price,
    });
    expect((quote.body as { name: string }).name).toMatch(/^LUN-/);
  });

  it('renames for the price: the prefix stays, the pilot part changes, the wallet is charged', async () => {
    const p = await pilot();
    const price = config.snapshot().rules.economy.ship_rename_price;
    const before = await credits(p.seeded.player.id);

    const response = await rename(p.token, p.shipId, '  Star   Wind ');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'LUN-Star Wind', prefix: 'LUN-', price });
    expect(await credits(p.seeded.player.id)).toBe(before - price);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: p.shipId } });
    expect(ship.name).toBe('LUN-Star Wind');
    // the public card follows the ship's name
    const me = await request(httpServer(testApp.app))
      .get(`/v1/players/by-name/${p.seeded.player.name}/profile`)
      .set('Authorization', `Bearer ${p.token}`);
    expect((me.body as { ship?: { title: string } }).ship?.title).toBe('LUN-Star Wind');
  });

  it('refuses a bad, blocked or unchanged name without charging', async () => {
    const p = await pilot();
    const before = await credits(p.seeded.player.id);
    const code = async (name: string) => {
      const response = await rename(p.token, p.shipId, name);
      expect(response.status).toBe(409);
      return (response.body as { message: { error: string } }).message.error;
    };
    expect(await code('ab')).toBe('SHIP_NAME_INVALID');
    expect(await code('<b>hi</b>')).toBe('SHIP_NAME_INVALID');
    expect(await code('Caralho Star')).toBe('SHIP_NAME_BLOCKED');
    expect(await code('C4r4lh0')).toBe('SHIP_NAME_BLOCKED');
    expect((await rename(p.token, p.shipId, 'Wind')).status).toBe(200);
    expect(await code('Wind')).toBe('SHIP_NAME_UNCHANGED');
    expect(await credits(p.seeded.player.id)).toBe(
      before - config.snapshot().rules.economy.ship_rename_price,
    );
  });

  it('refuses with INSUFFICIENT_FUNDS when the pilot cannot pay, and renames nothing', async () => {
    const p = await pilot();
    await prisma.player.update({ where: { id: p.seeded.player.id }, data: { credits: 5 } });
    const before = (await prisma.ship.findUniqueOrThrow({ where: { id: p.shipId } })).name;
    const response = await rename(p.token, p.shipId, 'Poor Wind');
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ message: { error: 'INSUFFICIENT_FUNDS' } });
    expect((await prisma.ship.findUniqueOrThrow({ where: { id: p.shipId } })).name).toBe(before);
  });

  it("keeps another pilot's ship out of reach, and needs an idempotency key", async () => {
    const a = await pilot();
    const b = await pilot();
    const other = await rename(b.token, a.shipId, 'Stolen');
    expect([403, 404]).toContain(other.status);
    const noKey = await request(httpServer(testApp.app))
      .post(`/v1/ships/${a.shipId}/rename`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'No Key' });
    expect(noKey.status).toBe(400);
  });
});
