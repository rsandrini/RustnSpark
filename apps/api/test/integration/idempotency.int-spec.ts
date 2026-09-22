import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { IdempotencyTestController } from '../support/idempotency-test.controller.js';
import { IdempotencyTestModule } from '../support/idempotency-test.module.js';
import { resetDatabase } from '../support/test-db.js';

// Proves the IdempotencyInterceptor's R21 semantics through a real HTTP pipeline on a test-only
// route (test/support/idempotency-test.*, never wired into AppModule), against real Postgres:
// missing key → 400; same key + same body → byte-identical replay with a single handler
// execution; same key + different body → 422; concurrent first-executions → one 2xx + one 409
// IDEMPOTENCY_IN_PROGRESS. A real player row is seeded because IdempotencyKey.playerId is a
// foreign key into Player.

const ROUTE = '/v1/test/idempotency/echo';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

// Polls a condition instead of sleeping a fixed duration: condition-based waits stay correct no
// matter how loaded the test machine is.
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met within 2000ms');
    await delay(5);
  }
}

describe('IdempotencyInterceptor (real HTTP pipeline, test-only route)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let controller: IdempotencyTestController;
  let tokenService: TokenService;

  beforeAll(async () => {
    testApp = await createTestApp({}, [IdempotencyTestModule]);
    prisma = testApp.app.get(PrismaService);
    controller = testApp.app.get(IdempotencyTestController);
    tokenService = testApp.app.get(TokenService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(() => {
    controller.reset();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  async function seedAuthedPlayer(): Promise<string> {
    const created = await prisma.account.create({
      data: {
        email: `idem-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-hash',
        player: { create: { name: `i-${randomUUID().replaceAll('-', '').slice(0, 22)}` } },
      },
      include: { player: true },
    });
    if (!created.player) throw new Error('seedAuthedPlayer: nested player create returned none');
    return tokenService.signAccessToken({
      accountId: created.id,
      playerId: created.player.id,
      role: 'PLAYER',
    });
  }

  function post(token: string, key: string | undefined, body: Record<string, unknown>) {
    const req = request(httpServer(testApp.app))
      .post(ROUTE)
      .set('Authorization', `Bearer ${token}`);
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  it('rejects an @Idempotent() route without an Idempotency-Key header with 400', async () => {
    const token = await seedAuthedPlayer();

    const response = await post(token, undefined, { label: 'no-key' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ message: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(controller.executions).toBe(0);
  });

  it('replays the stored response byte-for-byte for the same key and body, executing once', async () => {
    const token = await seedAuthedPlayer();

    const first = await post(token, 'key-replay', { label: 'replay-me' });
    const second = await post(token, 'key-replay', { label: 'replay-me' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual({ seq: 1, label: 'replay-me' });
    // Raw-text equality: the replay must be byte-stable (R21), not just deep-equal.
    expect(second.text).toBe(first.text);
    expect(controller.executions).toBe(1);
  });

  it('rejects the same key with a different body with 422', async () => {
    const token = await seedAuthedPlayer();

    const first = await post(token, 'key-mismatch', { label: 'original' });
    const second = await post(token, 'key-mismatch', { label: 'changed' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(422);
    expect(second.body).toMatchObject({ message: 'IDEMPOTENCY_BODY_MISMATCH' });
    expect(controller.executions).toBe(1);
  });

  it('settles two concurrent first-executions of one key as one 200 and one 409', async () => {
    const token = await seedAuthedPlayer();

    // supertest only fires the request once a handler attaches, so `.then()` is what actually
    // sends it. The latch parks the winner's handler AFTER the interceptor's pending row exists
    // (executions increments after the insert), so the loser deterministically meets the pending
    // row and gets 409 (R21: never a wait, never a 500) — no wall-clock timing involved.
    const firstPromise = post(token, 'key-race', { label: 'race', latchKey: 'race-latch' }).then(
      (response) => response,
    );
    await waitFor(() => controller.executions === 1);

    const second = await post(token, 'key-race', { label: 'race', latchKey: 'race-latch' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ message: 'IDEMPOTENCY_IN_PROGRESS' });
    expect(controller.executions).toBe(1);

    controller.releaseLatch('race-latch');
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ seq: 1, label: 'race' });
    expect(controller.executions).toBe(1);
  });

  it('treats a different key on the same route as a new operation', async () => {
    const token = await seedAuthedPlayer();

    const first = await post(token, 'key-a', { label: 'same-body' });
    const second = await post(token, 'key-b', { label: 'same-body' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ seq: 2, label: 'same-body' });
    expect(controller.executions).toBe(2);
  });

  it('rejects a body containing a forged credits field with 400 (whitelist ValidationPipe)', async () => {
    const token = await seedAuthedPlayer();

    const response = await post(token, 'key-forged', { credits: 1000000 });

    expect(response.status).toBe(400);
    expect(controller.executions).toBe(0);
    // A failed execution frees the key (no lingering row): the client may retry with a fixed body.
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });
});
