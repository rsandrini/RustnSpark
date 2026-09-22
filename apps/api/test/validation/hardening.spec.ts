import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { EnvService } from '../../src/common/env/env.module.js';
import { THROTTLE_LIMIT, ThrottlerGuard } from '../../src/common/guards/throttler.guard.js';
import {
  REQUEST_ID_HEADER,
  RequestIdInterceptor,
} from '../../src/common/interceptors/request-id.interceptor.js';
import { configureApp } from '../../src/main.js';

class PingDto {
  @IsString()
  message!: string;
}

@Controller()
class TestController {
  @Get('ping')
  ping() {
    return { pong: true };
  }

  @Post('ping')
  @HttpCode(200)
  echo(@Body() body: PingDto) {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('boom, with a stack trace nobody outside this process should ever see');
  }
}

// Mirrors the hardening providers AppModule registers globally (APP_INTERCEPTOR/APP_GUARD),
// without pulling in Prisma/Redis: these tests exercise the HTTP hardening layer only.
@Module({
  controllers: [TestController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
class TestAppModule {}

function makeEnv(): EnvService {
  return new EnvService({
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: ['http://allowed.example'],
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    COOKIE_SECRET: 'b'.repeat(32),
    ARGON2_MEMORY_KIB: 4096,
    ARGON2_TIME_COST: 1,
    ARGON2_PARALLELISM: 1,
  });
}

async function makeApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, makeEnv());
  await app.init();
  return app;
}

// `INestApplication#getHttpServer()` is typed `any`; give supertest a concrete `Server` once here.
function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('hardening baseline', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('rejects a body carrying an unknown property with 400', async () => {
    app = await makeApp();
    const response = await request(httpServer(app))
      .post('/v1/ping')
      .send({ message: 'hi', extra: 'not whitelisted' });
    expect(response.status).toBe(400);
  });

  it('accepts a whitelisted body', async () => {
    app = await makeApp();
    const response = await request(httpServer(app)).post('/v1/ping').send({ message: 'hi' });
    expect(response.status).toBe(200);
  });

  it('sets helmet security headers', async () => {
    app = await makeApp();
    const response = await request(httpServer(app)).get('/v1/ping');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('allows a whitelisted CORS origin', async () => {
    app = await makeApp();
    const response = await request(httpServer(app))
      .get('/v1/ping')
      .set('Origin', 'http://allowed.example');
    expect(response.headers['access-control-allow-origin']).toBe('http://allowed.example');
  });

  it('rejects a disallowed CORS origin', async () => {
    app = await makeApp();
    const response = await request(httpServer(app))
      .get('/v1/ping')
      .set('Origin', 'http://evil.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never returns a stack trace for an unhandled error', async () => {
    app = await makeApp();
    const response = await request(httpServer(app)).get('/v1/boom');
    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('stack');
    expect(JSON.stringify(response.body)).not.toContain('.ts:');
  });

  it('echoes a request id header on every response', async () => {
    app = await makeApp();
    const response = await request(httpServer(app)).get('/v1/ping');
    expect(response.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
    expect(response.headers[REQUEST_ID_HEADER]).not.toBe('');
  });

  it('rejects a body over the configured size limit with 413', async () => {
    app = await makeApp();
    const oversized = 'x'.repeat(200 * 1024);
    const response = await request(httpServer(app)).post('/v1/ping').send({ message: oversized });
    expect(response.status).toBe(413);
  });

  it('returns 429 once the throttle limit is exceeded', async () => {
    app = await makeApp();
    for (let i = 0; i < THROTTLE_LIMIT; i += 1) {
      const ok = await request(httpServer(app)).get('/v1/ping');
      expect(ok.status).toBe(200);
    }
    const limited = await request(httpServer(app)).get('/v1/ping');
    expect(limited.status).toBe(429);
  }, 20_000);
});
