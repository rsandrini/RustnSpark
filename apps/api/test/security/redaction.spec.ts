import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { bearer, createSecurityWorld, type Actor, type SecurityWorld } from './support.js';

// S12.2: secrets and internals never leave in a response body. (The log side — pino redaction of
// authorization, cookies, passwords and tokens — is pinned by auth-log-safety.int-spec.ts and
// pino.config.spec.ts; this covers what a client, or an attacker probing errors, can read.)
const SECRET_SHAPES = [
  /passwordHash/i,
  /\$argon2/,
  /tokenHash/i,
  /JWT_ACCESS_SECRET/,
  /COOKIE_SECRET/,
];

function expectNoSecrets(label: string, body: unknown): void {
  const text = JSON.stringify(body);
  for (const shape of SECRET_SHAPES) {
    expect({ label, leaked: shape.test(text) }).toEqual({ label, leaked: false });
  }
}

describe('responses never leak secrets or internals (S12.2)', () => {
  let world: SecurityWorld;
  let player: Actor;
  let admin: Actor;

  beforeAll(async () => {
    world = await createSecurityWorld();
    player = await world.makePlayer();
    admin = await world.makeAdmin();
  });
  afterAll(async () => {
    await world?.close();
  });

  it('login, profile and admin player views carry no hashes', async () => {
    const seeded = await seedAccountWithPlayer(world.prisma, world.app.get(PasswordService));
    const login = await request(world.server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });
    expectNoSecrets('login', login.body);

    const me = await request(world.server).get('/v1/players/me').set(bearer(player.token));
    expectNoSecrets('players/me', me.body);

    const sheet = await request(world.server)
      .get(`/v1/admin/players/${player.playerId}`)
      .set(bearer(admin.token));
    expect(sheet.status).toBe(200);
    expectNoSecrets('admin sheet', sheet.body);
    const list = await request(world.server).get('/v1/admin/players').set(bearer(admin.token));
    expectNoSecrets('admin player list', list.body);
  });

  it('a wrong password and an unknown email are indistinguishable (no account enumeration)', async () => {
    const seeded = await seedAccountWithPlayer(world.prisma, world.app.get(PasswordService));
    const wrongPassword = await request(world.server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: 'definitely-wrong-1' });
    const unknown = await request(world.server)
      .post('/v1/auth/login')
      .send({ email: `nobody-${Date.now()}@example.com`, password: 'definitely-wrong-1' });
    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (body: { requestId?: string }) => ({ ...body, requestId: undefined });
    expect(strip(wrongPassword.body as { requestId?: string })).toEqual(
      strip(unknown.body as { requestId?: string }),
    );
  });

  it('error responses carry a request id and no stack traces, SQL or file paths', async () => {
    const responses = [
      await request(world.server).get('/v1/players/me'), // 401
      await request(world.server).get('/v1/nope'), // 404
      await request(world.server).post('/v1/auth/login').send({ email: 1 }), // 400
      await request(world.server).get('/v1/admin/health').set(bearer(player.token)), // 403
      await request(world.server)
        .get(`/v1/reports/${crypto.randomUUID()}`)
        .set(bearer(player.token)), // 404
    ];
    for (const response of responses) {
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/\bat\s+\S+\s+\(.*:\d+:\d+\)/); // stack frame
      expect(text).not.toMatch(/node_modules|\/apps\/api\/|\.ts:\d+/);
      expect(text).not.toMatch(/prisma|SELECT |INSERT |relation ".*" does not exist/i);
      expect(typeof (response.body as { requestId?: unknown }).requestId).toBe('string');
    }
  });

  it('a malformed JSON body is a clean 400, not a parser stack', async () => {
    const response = await request(world.server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError|node_modules|\.js:\d+/);
  });
});
