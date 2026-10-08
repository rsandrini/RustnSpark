import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

// Admin-uploaded faction art: raw image bytes in, hashed file out, served immutable, listed for the
// web, resettable; the built-in static art stays the default until something is uploaded.
const ART_DIR = mkdtempSync(join(tmpdir(), 'rs-art-'));
process.env.ART_DIR = ART_DIR;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not-a-real-image-but-has-the-signature'),
]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('faction art (admin upload)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
  });

  afterAll(async () => {
    await testApp.close();
    rmSync(ART_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const file of readdirSync(ART_DIR)) rmSync(join(ART_DIR, file), { force: true });
    await resetDatabase(prisma);
  });

  async function adminToken(): Promise<string> {
    const email = `admin-${crypto.randomUUID()}@example.com`;
    await prisma.account.create({
      data: {
        email,
        passwordHash: await passwordService.hash('admin-password-1'),
        role: 'ADMIN',
        player: { create: { name: `admin_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`, credits: 0, locale: 'en' } },
      },
    });
    const response = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email, password: 'admin-password-1' });
    return accessTokenFrom(response);
  }

  const upload = (token: string, slot: string, body: Buffer, type: string, id = 'luna') =>
    request(httpServer(testApp.app))
      .post(`/v1/admin/tuning/factions/${id}/art/${slot}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', type)
      .send(body);

  it('uploads an image, lists it, serves it publicly with immutable caching, and resets to default', async () => {
    await seed(prisma);
    const token = await adminToken();

    const before = await request(httpServer(testApp.app))
      .get('/v1/factions/art')
      .set('Authorization', `Bearer ${token}`);
    expect(before.body).toEqual({ factions: {} }); // nothing uploaded: every faction uses its default

    const response = await upload(token, 'logo', PNG, 'image/png');
    expect(response.status).toBe(200);
    const { slot, url } = response.body as { slot: string; url: string };
    expect(slot).toBe('logo');
    expect(url).toMatch(/^\/v1\/art\/luna-logo-[a-f0-9]{12}\.png$/);

    const list = await request(httpServer(testApp.app))
      .get('/v1/factions/art')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body).toEqual({ factions: { luna: { banner: null, logo: url, background: null } } });

    // the file is public (no token) and cacheable forever
    const served = await request(httpServer(testApp.app)).get(url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(Buffer.from(served.body as Buffer).equals(PNG)).toBe(true);

    // replacing it swaps the file (the old one is deleted), resetting removes the slot and the file
    const second = await upload(token, 'logo', Buffer.concat([PNG, Buffer.from('v2')]), 'image/png');
    expect((second.body as { url: string }).url).not.toBe(url);
    expect((await request(httpServer(testApp.app)).get(url)).status).toBe(404);
    expect(readdirSync(ART_DIR)).toHaveLength(1);

    const reset = await request(httpServer(testApp.app))
      .delete('/v1/admin/tuning/factions/luna/art/logo')
      .set('Authorization', `Bearer ${token}`);
    expect(reset.body).toEqual({ slot: 'logo', url: null });
    expect(readdirSync(ART_DIR)).toHaveLength(0);
    const after = await request(httpServer(testApp.app))
      .get('/v1/factions/art')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body).toEqual({ factions: {} });

    // every change is a tuning revision
    const revisions = await prisma.tuningRevision.findMany({ where: { entityType: 'factions', entityId: 'luna' } });
    expect(revisions.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts a clean SVG', async () => {
    await seed(prisma);
    const token = await adminToken();
    const response = await upload(token, 'banner', SVG, 'image/svg+xml');
    expect(response.status).toBe(200);
    expect((response.body as { url: string }).url).toMatch(/\.svg$/);
  });

  it('refuses what is not a real, safe image: wrong type, wrong bytes, scripted SVG, unknown slot, oversize', async () => {
    await seed(prisma);
    const token = await adminToken();
    expect((await upload(token, 'logo', PNG, 'image/gif')).status).toBe(400);
    expect((await upload(token, 'logo', Buffer.from('plain text'), 'image/png')).status).toBe(400);
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const scripted = await upload(token, 'logo', evil, 'image/svg+xml');
    expect(scripted.status).toBe(400);
    const handler = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>');
    expect((await upload(token, 'logo', handler, 'image/svg+xml')).status).toBe(400);
    expect((await upload(token, 'poster', PNG, 'image/png')).status).toBe(400);
    expect((await upload(token, 'logo', Buffer.alloc(1_700_000, 1), 'image/png')).status).toBe(413);
    expect((await upload(token, 'logo', PNG, 'image/png', 'nope')).status).toBe(404);
    expect(readdirSync(ART_DIR)).toHaveLength(0);
  });

  it('is admin-only to change and rejects path tricks when serving', async () => {
    await seed(prisma);
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const playerToken = accessTokenFrom(
      await request(httpServer(testApp.app))
        .post('/v1/auth/login')
        .send({ email: seeded.email, password: seeded.password }),
    );
    expect((await upload(playerToken, 'logo', PNG, 'image/png')).status).toBe(403);
    expect((await request(httpServer(testApp.app)).get('/v1/art/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await request(httpServer(testApp.app)).get('/v1/art/luna-logo-zzzz.png')).status).toBe(404);
    expect((await request(httpServer(testApp.app)).post('/v1/admin/tuning/factions/luna/art/logo')).status).toBe(401);
  });
});
