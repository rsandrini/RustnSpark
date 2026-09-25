import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import request from 'supertest';
import { validationPipeOptions } from '../../src/common/pipes/validation.config.js';
import { listRoutes, type RouteInfo } from '../support/routes.js';
import { bearer, createSecurityWorld, type Actor, type SecurityWorld } from './support.js';

// S12.2: the client never tells the server what happened or what things cost. Every request DTO
// must reject fields that only the server may set — results, prices, balances, ownership, role —
// even when the rest of the body is valid. (forbidNonWhitelisted turns unknown keys into a 400;
// this proves it for every DTO the API has, not just the ones someone thought of.)

const FORGED: Record<string, unknown> = {
  credits: 999_999,
  creditsDelta: 999_999,
  balance: 999_999,
  reward: 999_999,
  price: 0,
  outcome: 'success',
  status: 'DONE',
  loot: [{ materialId: 'iron', quantity: 999 }],
  damage: 0,
  condition: 100,
  fuel: 9_999,
  seed: 1,
  rulesHash: 'forged',
  playerId: 'someone-else',
  ownerPlayerId: 'someone-else',
  accountId: 'someone-else',
  role: 'ADMIN',
  isAdmin: true,
};

const key = (route: RouteInfo): string => `${route.method} ${route.path}`;

function declaredProperties(type: new () => object): Set<string> {
  return new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(type, '', false, false)
      .map((meta) => meta.propertyName),
  );
}

describe('forged result fields are rejected (S12.2)', () => {
  let world: SecurityWorld;
  let routes: RouteInfo[];
  let player: Actor;

  beforeAll(async () => {
    world = await createSecurityWorld();
    routes = listRoutes(world.app);
    player = await world.makePlayer();
  });
  afterAll(async () => {
    await world?.close();
  });

  it('every request DTO rejects every forged server-owned field it does not declare', async () => {
    const pipe = new ValidationPipe(validationPipeOptions);
    const leaks: string[] = [];
    const dtoRoutes = routes.filter((route) => route.hasBody);
    expect(dtoRoutes.length).toBeGreaterThan(20);

    for (const route of dtoRoutes) {
      const type = route.bodyType as new () => object;
      const declared = declaredProperties(type);
      for (const [field, value] of Object.entries(FORGED)) {
        if (declared.has(field)) continue; // a legitimate input of this DTO
        try {
          await pipe.transform({ [field]: value }, { type: 'body', metatype: type });
          leaks.push(`${key(route)} accepted "${field}"`);
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
          // Must be rejected for being unknown, not merely because required fields are missing.
          const messages = JSON.stringify(error.getResponse());
          if (!messages.includes(`property ${field} should not exist`)) {
            leaks.push(`${key(route)} did not flag "${field}" as non-whitelisted`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('over HTTP: a forged price and credits on a real purchase are a 400 and change nothing', async () => {
    const before = await world.prisma.player.findUniqueOrThrow({ where: { id: player.playerId } });
    const response = await request(world.server)
      .post('/v1/market/buy')
      .set(bearer(player.token))
      .send({ listingId: 'whatever', price: 0, credits: 999_999 });
    expect(response.status).toBe(400);
    const after = await world.prisma.player.findUniqueOrThrow({ where: { id: player.playerId } });
    expect(after.credits).toBe(before.credits);
  });

  it('over HTTP: a forged outcome on dispatch is a 400', async () => {
    const response = await request(world.server)
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(bearer(player.token))
      .send({ missionId: 'x', outcome: 'success', reward: 999_999 });
    expect(response.status).toBe(400);
  });

  it('over HTTP: cannot self-promote by sending role/accountId on the profile-shaped writes', async () => {
    const response = await request(world.server)
      .post('/v1/players/me/locale')
      .set(bearer(player.token))
      .send({ locale: 'en', role: 'ADMIN', accountId: 'x' });
    expect(response.status).toBe(400);
    const account = await world.prisma.account.findUniqueOrThrow({
      where: { id: player.accountId },
    });
    expect(account.role).toBe('PLAYER');
  });
});
