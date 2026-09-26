import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { IDEMPOTENT_KEY } from '../../src/common/idempotency/idempotent.decorator.js';
import { listRoutes, type RouteInfo } from '../support/routes.js';
import { createSecurityWorld, type SecurityWorld } from './support.js';

// S12.2: a lost response must never make a player pay twice, and an admin double-click must never
// grant twice. So every mutating route is EITHER guarded by an Idempotency-Key (@Idempotent) OR
// listed here as naturally idempotent with the reason. Both directions are asserted, so the list
// can neither hide a missing key nor keep a route that later gained one.

const NATURALLY_IDEMPOTENT: Record<string, string> = {
  'POST /v1/auth/login': 'issues a new session each time; no game state changes',
  'POST /v1/auth/logout': 'revoking an already revoked token is a no-op',
  'POST /v1/auth/refresh': 'rotation with reuse detection (R-series): a replay revokes the family',
  'POST /v1/auth/register': 'email is unique: a repeat is a 409, never a second account',
  'POST /v1/players/me/locale': 'sets a value: repeating is the same state',
  'POST /v1/players/me/onboarding':
    'single-shot per player, guarded by a row lock: repeat returns the ship',
  'POST /v1/ships/:id/assemble': 'sets the layout to a value: repeating is the same state',
  'POST /v1/ships/:id/auto-assemble': 'deterministic layout from the same inventory',
  'POST /v1/ships/:id/preview': 'read-shaped: no state change',
  'POST /v1/ships/:id/repair/quote': 'read-shaped: no state change',
  'POST /v1/ships/:id/stance': 'sets a value: repeating is the same state',
  'POST /v1/missions/:id/accept':
    'state machine: a repeat accept by the same player replays the stored outcome (D29); by anyone else is a 409',
  'POST /v1/ships/:id/dispatch':
    'conditional ACCEPTED→IN_TRANSIT and IN_PORT→ON_MISSION updates: a repeat is a 409 with no second effect',
  'POST /v1/locations/:id/scavenge':
    'per-location cooldown (D28): a repeat inside the window is a 409 SCAVENGE_COOL_DOWN with no second roll',
  'POST /v1/missions/:id/abandon':
    'conditional ACCEPTED→AVAILABLE update: a repeat is a 409 with no second effect',
  'POST /v1/missions/:id/hold': 'holding what you already hold is a no-op',
  'DELETE /v1/missions/:id/hold': 'releasing an already released hold is a no-op',
  'POST /v1/admin/tuning/bundle':
    'import is a diff against current values; re-import changes nothing',
  'POST /v1/admin/tuning/config/:key/reset': 'reset to default is a value set, revision-guarded',
  'PATCH /v1/admin/tuning/config/:key':
    'sets a value under expectedRevision: a replay fails the revision check',
  'POST /v1/admin/tuning/:entity': 'unique key: a repeat is a 409',
  'PATCH /v1/admin/tuning/:entity/:id': 'sets fields to values under a revision check',
  'DELETE /v1/admin/tuning/:entity/:id': 'retiring a retired entity is a no-op',
  'POST /v1/admin/tuning/revisions/:id/revert': 'revision-guarded: a second revert conflicts',
  'PUT /v1/admin/system/flags/:key': 'sets a boolean: repeating is the same state',
  'POST /v1/admin/system/notices':
    'a repeat posts a second broadcast: visible and dismissable, no player harm',
  'POST /v1/admin/system/notices/:id/dismiss': 'dismissing a dismissed notice is a no-op',
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const key = (route: RouteInfo): string => `${route.method} ${route.path}`;
const isIdempotent = (route: RouteInfo): boolean =>
  Reflect.getMetadata(IDEMPOTENT_KEY, route.handler) === true;

describe('idempotency matrix (S12.2)', () => {
  let world: SecurityWorld;
  let mutating: RouteInfo[];

  beforeAll(async () => {
    world = await createSecurityWorld();
    mutating = listRoutes(world.app).filter((route) => MUTATING.has(route.method));
  });
  afterAll(async () => {
    await world?.close();
  });

  it('every mutating route is idempotency-keyed or listed as naturally idempotent', () => {
    const unguarded = mutating
      .filter((route) => !isIdempotent(route))
      .filter((route) => !(key(route) in NATURALLY_IDEMPOTENT))
      .map(key);
    expect(unguarded).toEqual([]);
  });

  it('the natural list has no stale entries and none that is also keyed', () => {
    const existing = new Set(mutating.map(key));
    expect(Object.keys(NATURALLY_IDEMPOTENT).filter((entry) => !existing.has(entry))).toEqual([]);
    expect(
      mutating
        .filter(isIdempotent)
        .filter((route) => key(route) in NATURALLY_IDEMPOTENT)
        .map(key),
    ).toEqual([]);
  });

  it('every money-moving route requires the key', () => {
    const moneyRoutes = [
      'POST /v1/market/buy',
      'POST /v1/market/sell',
      'POST /v1/market/sell-material',
      'POST /v1/ships/:id/refuel',
      'POST /v1/ships/:id/repair',
      'POST /v1/ships/:id/rescue',
      'POST /v1/admin/players/:playerId/credits/grant',
      'POST /v1/admin/players/:playerId/credits/remove',
    ];
    const keyed = new Set(mutating.filter(isIdempotent).map(key));
    expect(moneyRoutes.filter((route) => !keyed.has(route))).toEqual([]);
  });
});
