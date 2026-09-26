import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { getMetadataStorage } from 'class-validator';
import { AdminGuard } from '../../src/admin/guards/admin.guard.js';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator.js';
import { OWNED_RESOURCE_KEY } from '../../src/common/decorators/owned-resource.decorator.js';
import { THROTTLE_ROUTE_KEY } from '../../src/common/decorators/throttle-route.decorator.js';
import { ThrottlerGuard } from '../../src/common/guards/throttler.guard.js';
import { listRoutes, type RouteInfo } from '../support/routes.js';
import { createSecurityWorld, type SecurityWorld } from './support.js';

// S12.2 route-metadata audit. Every route the app exposes must DECLARE how it is protected;
// adding a route that forgets fails this suite instead of shipping open. Allowlists below are
// exact: an entry for a route that no longer exists (or no longer needs it) fails too, so they
// cannot rot into a blanket exemption.

const key = (route: RouteInfo): string => `${route.method} ${route.path}`;

/** Routes reachable without a token. Anything else being @Public() is a leak. */
const PUBLIC_ROUTES = new Set([
  'POST /v1/auth/login',
  'POST /v1/auth/logout',
  'POST /v1/auth/refresh',
  'POST /v1/auth/register',
  'GET /v1/health',
  'GET /v1/health/live',
  'GET /v1/health/ready',
]);

/**
 * Player routes with a `:param` that is NOT an @OwnedResource: they are scoped inside the
 * service by the caller's own playerId (or the param is public world data). The reason is the
 * contract; the authz matrix exercises the cross-player cases.
 */
const SELF_SCOPED_PARAM_ROUTES: Record<string, string> = {
  'GET /v1/catalog/materials/:id': 'public catalog data',
  'GET /v1/catalog/parts/:partType': 'public catalog data',
  'GET /v1/locations/:id/market': 'world data; prices computed for the caller',
  'GET /v1/locations/:id/missions': 'world data; the board hides other players’ private missions',
  'GET /v1/locations/:id/scavenge': 'world odds plus the caller’s own attempt counter only',
  'POST /v1/locations/:id/scavenge': 'acts on the caller’s own ship/counter at that location',
  'POST /v1/missions/:id/accept': 'service checks holder/private owner against the caller',
  'POST /v1/missions/:id/abandon':
    'service only lets the accepting player back out (404 otherwise)',
  'POST /v1/missions/:id/hold': 'service checks the mission is takeable by the caller',
  'DELETE /v1/missions/:id/hold': 'service releases only the caller’s own hold',
  'GET /v1/reports/:missionId': 'service scopes the log by the caller’s playerId (404 otherwise)',
};

/** Mutating routes with no @Body(): they act on the caller / a path param only. */
const BODYLESS_MUTATIONS = new Set([
  'POST /v1/inventory/discard',
  'POST /v1/auth/logout',
  'POST /v1/auth/refresh',
  'POST /v1/locations/:id/scavenge',
  'POST /v1/missions/:id/abandon',
  'POST /v1/missions/:id/hold',
  'DELETE /v1/missions/:id/hold',
  'POST /v1/ships/:id/rescue',
  'POST /v1/admin/system/notices/:id/dismiss',
]);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}
const isPublic = (route: RouteInfo): boolean =>
  Reflect.getMetadata(IS_PUBLIC_KEY, route.handler) === true ||
  Reflect.getMetadata(IS_PUBLIC_KEY, route.controller) === true;
const isAdmin = (route: RouteInfo): boolean =>
  guardsOf(route.controller).includes(AdminGuard) || guardsOf(route.handler).includes(AdminGuard);
const isOwned = (route: RouteInfo): boolean =>
  Reflect.getMetadata(OWNED_RESOURCE_KEY, route.handler) !== undefined;

describe('route metadata audit (S12.2)', () => {
  let world: SecurityWorld;
  let routes: RouteInfo[];

  beforeAll(async () => {
    world = await createSecurityWorld();
    routes = listRoutes(world.app);
  });
  afterAll(async () => {
    await world?.close();
  });

  it('finds the application routes (guards the audit itself against silently seeing none)', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('only the listed auth/health routes are @Public()', () => {
    const actual = new Set(routes.filter(isPublic).map(key));
    expect([...actual].sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('every non-public route is protected: admin guard, ownership declaration or scoped-by-service', () => {
    const unclassified = routes
      .filter((route) => !isPublic(route))
      .filter((route) => !isAdmin(route))
      .filter((route) => !isOwned(route))
      .filter((route) => route.params.length > 0)
      .filter((route) => !(key(route) in SELF_SCOPED_PARAM_ROUTES))
      .map(key);
    expect(unclassified).toEqual([]);
  });

  it('every @OwnedResource route also carries OwnershipGuard (a declaration alone protects nothing)', () => {
    const missing = routes
      .filter(isOwned)
      .filter(
        (route) =>
          !guardsOf(route.handler)
            .concat(guardsOf(route.controller))
            .some((guard) => (guard as { name?: string }).name === 'OwnershipGuard'),
      )
      .map(key);
    expect(missing).toEqual([]);
  });

  it('the SELF_SCOPED allowlist has no stale entries', () => {
    const existing = new Set(routes.map(key));
    const stale = Object.keys(SELF_SCOPED_PARAM_ROUTES).filter((entry) => !existing.has(entry));
    expect(stale).toEqual([]);
    const notNeeded = routes
      .filter((route) => key(route) in SELF_SCOPED_PARAM_ROUTES)
      .filter((route) => isOwned(route) || isAdmin(route) || isPublic(route))
      .map(key);
    expect(notNeeded).toEqual([]);
  });

  it('every request body is a validated DTO class', () => {
    const storage = getMetadataStorage();
    const bad = routes
      .filter((route) => route.hasBody)
      .filter((route) => {
        const type = route.bodyType as (new () => object) | undefined;
        if (typeof type !== 'function' || type === Object) return true;
        return storage.getTargetValidationMetadatas(type, '', false, false).length === 0;
      })
      .map(key);
    expect(bad).toEqual([]);
  });

  it('mutating routes without a body are exactly the enumerated ones', () => {
    const actual = routes
      .filter((route) => MUTATING.has(route.method) && !route.hasBody)
      .map(key)
      .sort();
    expect(actual).toEqual([...BODYLESS_MUTATIONS].sort());
  });

  it('every public mutating route has its own explicit throttle policy (auth is never on the shared default)', () => {
    const missing = routes
      .filter(isPublic)
      .filter((route) => MUTATING.has(route.method))
      .filter((route) => Reflect.getMetadata(THROTTLE_ROUTE_KEY, route.handler) === undefined)
      .map(key);
    // logout/refresh only act on a cookie the caller already holds; login and register are the
    // ones an attacker can hammer for credentials or accounts.
    expect(missing.sort()).toEqual(['POST /v1/auth/logout', 'POST /v1/auth/refresh']);
  });

  it('the rate limiter is a global guard, so every route is inside a policy class', () => {
    const registered = [...world.app.get(ModulesContainer).values()].some((moduleRef) =>
      [...moduleRef.providers.values()].some((wrapper) => wrapper.metatype === ThrottlerGuard),
    );
    expect(registered).toBe(true);
  });
});
