import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface EscortBody {
  state: string;
  reasons: string[];
  destinationId: string | null;
  durationSeconds: number | null;
  arrivesAt: string | null;
  nextAvailableAt: string | null;
}

// The escort for a stuck pilot (owner, 2026-11-06): in debt and away from the faction's ports, the
// pilot can accept a free, fight-free transport to the nearest port of the faction; once per week.
describe('escort to a safe port', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
  });
  afterEach(async () => {
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await testApp?.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function stuckPilot(credits: number) {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);
    // Far from home (a sun garrison), in debt.
    await prisma.ship.update({ where: { id: shipId }, data: { currentLocationId: 'hedus' } });
    await prisma.player.update({ where: { id: seeded.player.id }, data: { credits } });
    return { token, shipId, playerId: seeded.player.id };
  }

  const info = (token: string, shipId: string) =>
    request(httpServer(testApp.app)).get(`/v1/ships/${shipId}/escort`).set(auth(token));
  const call = (token: string, shipId: string) =>
    request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/escort`)
      .set(auth(token))
      .set('Idempotency-Key', crypto.randomUUID());

  it('offers the nearest port of the faction, carries the ship there for free, then waits a week', async () => {
    const pilot = await stuckPilot(-5000);
    const offer = await info(pilot.token, pilot.shipId);
    expect(offer.status).toBe(200);
    const body = offer.body as EscortBody;
    expect(body.state).toBe('available');
    expect(body.destinationId).not.toBeNull();
    const destination = await prisma.location.findUniqueOrThrow({
      where: { id: body.destinationId! },
    });
    expect(destination.factionId).toBe('luna');

    const started = await call(pilot.token, pilot.shipId);
    expect(started.status).toBe(200);
    expect((started.body as EscortBody).state).toBe('underway');
    const flying = await prisma.ship.findUniqueOrThrow({ where: { id: pilot.shipId } });
    expect(flying.status).toBe('ON_MISSION');
    // No charge: the balance is untouched.
    expect((await prisma.player.findUniqueOrThrow({ where: { id: pilot.playerId } })).credits).toBe(
      -5000,
    );

    // The transport arrives: whoever looks docks the ship at the port.
    await prisma.ship.update({
      where: { id: pilot.shipId },
      data: { escortArrivesAt: new Date(Date.now() - 1000) },
    });
    const arrived = await info(pilot.token, pilot.shipId);
    expect(arrived.status).toBe(200);
    const docked = await prisma.ship.findUniqueOrThrow({ where: { id: pilot.shipId } });
    expect(docked.status).toBe('IN_PORT');
    expect(docked.currentLocationId).toBe(body.destinationId);
    expect(docked.escortToId).toBeNull();

    // Stranded again, in the same week: refused with the cooldown.
    await prisma.ship.update({ where: { id: pilot.shipId }, data: { currentLocationId: 'hedus' } });
    const again = (await info(pilot.token, pilot.shipId)).body as EscortBody;
    expect(again.state).toBe('unavailable');
    expect(again.reasons).toContain('COOLDOWN');
    expect(again.nextAvailableAt).not.toBeNull();
    expect((await call(pilot.token, pilot.shipId)).status).toBe(409);
  });

  it('is refused for a pilot who is not stuck (money in the bank, a ship that flies)', async () => {
    const pilot = await stuckPilot(50000);
    const offer = (await info(pilot.token, pilot.shipId)).body as EscortBody;
    expect(offer.state).toBe('unavailable');
    expect(offer.reasons).toContain('NOT_STUCK');
    expect((await call(pilot.token, pilot.shipId)).status).toBe(409);
  });

  it('is refused at a port of the pilot’s own faction', async () => {
    const pilot = await stuckPilot(-5000);
    await prisma.ship.update({ where: { id: pilot.shipId }, data: { currentLocationId: 'ceres' } });
    const offer = (await info(pilot.token, pilot.shipId)).body as EscortBody;
    expect(offer.reasons).toContain('ALREADY_SAFE');
  });
});
