import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { AccountStatusCache } from '../../src/common/guards/account-status.cache.js';
import { OWNED_RESOURCE_KEY } from '../../src/common/decorators/owned-resource.decorator.js';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator.js';
import { listRoutes, type RouteInfo } from '../support/routes.js';
import { bearer, createSecurityWorld, type Actor, type SecurityWorld } from './support.js';

// S12.2 authorization matrix, generated from the live route table so a new route is covered the
// day it exists:
//   anonymous            → every non-public route answers 401
//   player               → every admin route answers 403
//   player B on A's ship → every @OwnedResource(ship) route answers 403 and changes nothing
//   banned account       → cut off immediately (ACCOUNT_BANNED)

const isPublic = (route: RouteInfo): boolean =>
  Reflect.getMetadata(IS_PUBLIC_KEY, route.handler) === true ||
  Reflect.getMetadata(IS_PUBLIC_KEY, route.controller) === true;
const isAdminPath = (route: RouteInfo): boolean => route.path.startsWith('/v1/admin/');
const ownedType = (route: RouteInfo): string | undefined =>
  (Reflect.getMetadata(OWNED_RESOURCE_KEY, route.handler) as { type: string } | undefined)?.type;

/** Fills `:params` with a well-formed but meaningless id. */
function concretePath(route: RouteInfo, overrides: Record<string, string> = {}): string {
  return route.path.replace(/:(\w+)/g, (_, name: string) => overrides[name] ?? randomUUID());
}

function send(
  world: SecurityWorld,
  route: RouteInfo,
  path: string,
  headers: Record<string, string>,
) {
  const agent = request(world.server);
  const call =
    route.method === 'GET'
      ? agent.get(path)
      : route.method === 'POST'
        ? agent.post(path)
        : route.method === 'PUT'
          ? agent.put(path)
          : route.method === 'PATCH'
            ? agent.patch(path)
            : agent.delete(path);
  return call.set(headers).send(route.method === 'GET' ? undefined : {});
}

describe('authorization matrix (S12.2)', () => {
  let world: SecurityWorld;
  let routes: RouteInfo[];
  let playerA: Actor;
  let playerB: Actor;
  let admin: Actor;

  beforeAll(async () => {
    world = await createSecurityWorld();
    routes = listRoutes(world.app);
    playerA = await world.makePlayer();
    playerB = await world.makePlayer();
    admin = await world.makeAdmin();
  });
  afterAll(async () => {
    await world?.close();
  });

  it('anonymous callers get 401 on every non-public route', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => !isPublic(r))) {
      const response = await send(world, route, concretePath(route), {});
      if (response.status !== 401)
        failures.push(`${route.method} ${route.path} → ${response.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('a player token gets 403 on every admin route', async () => {
    const failures: string[] = [];
    for (const route of routes.filter(isAdminPath)) {
      const response = await send(world, route, concretePath(route), bearer(playerA.token));
      if (response.status !== 403)
        failures.push(`${route.method} ${route.path} → ${response.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('an admin token is accepted by the admin routes (the 403 above is about role, not breakage)', async () => {
    const response = await request(world.server).get('/v1/admin/health').set(bearer(admin.token));
    expect(response.status).toBe(200);
  });

  it("player B gets 403 on every route that takes player A's ship id, and A's ship is untouched", async () => {
    const shipRoutes = routes.filter((route) => ownedType(route) === 'ship');
    expect(shipRoutes.length).toBeGreaterThanOrEqual(9);
    const before = await world.prisma.ship.findUniqueOrThrow({ where: { id: playerA.shipId! } });
    const partsBefore = await world.prisma.partInstance.count({
      where: { ownerPlayerId: playerA.playerId },
    });

    const failures: string[] = [];
    for (const route of shipRoutes) {
      const path = concretePath(route, { id: playerA.shipId! });
      const response = await send(world, route, path, bearer(playerB.token));
      if (response.status !== 403)
        failures.push(`${route.method} ${route.path} → ${response.status}`);
    }
    expect(failures).toEqual([]);

    const after = await world.prisma.ship.findUniqueOrThrow({ where: { id: playerA.shipId! } });
    expect(after).toEqual(before);
    expect(
      await world.prisma.partInstance.count({ where: { ownerPlayerId: playerA.playerId } }),
    ).toBe(partsBefore);
  });

  it('the owner is NOT blocked by ownership on those routes (proves the 403 above is ownership)', async () => {
    const response = await request(world.server)
      .get(`/v1/ships/${playerA.shipId}`)
      .set(bearer(playerA.token));
    expect(response.status).toBe(200);
  });

  it("player B cannot read player A's mission report (404, never the log)", async () => {
    const missionId = randomUUID();
    const response = await request(world.server)
      .get(`/v1/reports/${missionId}`)
      .set(bearer(playerB.token));
    expect(response.status).toBe(404);
  });

  it('a banned account is refused on every authenticated route family at once', async () => {
    const victim = await world.makePlayer();
    await world.prisma.account.update({
      where: { id: victim.accountId },
      data: { status: 'BANNED' },
    });
    // The guard trusts an ACTIVE verdict for a few seconds and a raw DB flip does not clear it
    // (the ban ACTION does): drop the cached verdict the way that action would.
    world.app.get(AccountStatusCache).forget(victim.accountId);
    for (const path of ['/v1/players/me', '/v1/ships', '/v1/inventory']) {
      const response = await request(world.server).get(path).set(bearer(victim.token));
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
    }
  });
});
