import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { createSecurityWorld, type SecurityWorld } from './support.js';

// S12.2: what the browser is told about the API — cookie attributes, CORS, CSP and friends.
describe('transport hardening (S12.2)', () => {
  let world: SecurityWorld;

  beforeAll(async () => {
    world = await createSecurityWorld();
  });
  afterAll(async () => {
    await world?.close();
  });

  it('the refresh cookie is HttpOnly, Secure, SameSite=Strict and scoped to /v1/auth', async () => {
    const seeded = await seedAccountWithPlayer(world.prisma, world.app.get(PasswordService));
    const response = await request(world.server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });
    expect(response.status).toBe(200);
    const setCookie = (response.headers['set-cookie'] as unknown as string[]).find((cookie) =>
      cookie.startsWith('rid='),
    )!;
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*SameSite=Strict/i);
    expect(setCookie).toMatch(/;\s*Path=\/v1\/auth(;|$)/i);
    expect(setCookie).toMatch(/;\s*Max-Age=\d+/i);
    // The refresh token never appears in the JSON body (it is cookie-only).
    expect(JSON.stringify(response.body)).not.toContain('rid');
  });

  it('logout clears the cookie with the same scope so the browser actually drops it', async () => {
    const response = await request(world.server).post('/v1/auth/logout');
    const cleared = (response.headers['set-cookie'] as unknown as string[] | undefined)?.find(
      (cookie) => cookie.startsWith('rid='),
    );
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/i);
    expect(cleared).toMatch(/Path=\/v1\/auth/i);
    expect(cleared).toMatch(/HttpOnly/i);
  });

  it('CORS echoes only allow-listed origins and allows credentials for them', async () => {
    const allowed = process.env['CORS_ORIGINS']?.split(',')[0]?.trim() ?? 'http://localhost:5173';
    const ok = await request(world.server).get('/v1/health').set('Origin', allowed);
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await request(world.server)
      .get('/v1/health')
      .set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await request(world.server)
      .options('/v1/players/me')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets the helmet security headers, including a CSP that forbids framing and inline scripts', async () => {
    const response = await request(world.server).get('/v1/health');
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses oversized bodies instead of buffering them', async () => {
    const huge = { pad: 'x'.repeat(2 * 1024 * 1024) };
    const response = await request(world.server).post('/v1/auth/login').send(huge);
    expect(response.status).toBe(413);
  });
});
