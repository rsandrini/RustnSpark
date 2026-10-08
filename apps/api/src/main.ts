import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { json, raw, urlencoded } from 'express';
import helmet from 'helmet';
import pinoHttpImport from 'pino-http';
import type { HttpLogger, Options } from 'pino-http';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { EnvService } from './common/env/env.module.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import { createPinoHttpOptions } from './common/logging/pino.config.js';
import { validationPipeOptions } from './common/pipes/validation.config.js';

const GLOBAL_PREFIX = 'v1';
const BODY_SIZE_LIMIT = '100kb';
const ART_UPLOAD_LIMIT = '1600kb';

type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

// pino-http ships CJS types that TS misreads as a namespace under nodenext resolution;
// the runtime value is the callable factory, so re-type it once here.
const pinoHttp = pinoHttpImport as unknown as (options: Options) => HttpLogger;

// Shared by main() and tests: hardening that does not need a live app instance to run.
export function configureApp(app: INestApplication, env: EnvService): void {
  // Behind nginx (compose) every request arrives from the proxy's address; the real client is in
  // X-Forwarded-For. Trust that header ONLY when the immediate peer is a loopback/private-network
  // address (the proxy), so a client on the public internet cannot spoof its IP. Without this,
  // `request.ip` was the proxy for everyone: the per-IP throttler treated the whole game as one
  // client (registration capped at 3/min globally) and the admin audit log recorded the proxy.
  (app.getHttpAdapter().getInstance() as { set(name: string, value: string): void }).set(
    'trust proxy',
    'loopback, linklocal, uniquelocal',
  );

  const pinoHttpOptions = createPinoHttpOptions(env.get('NODE_ENV'));
  const httpLogger = pinoHttp(pinoHttpOptions);
  app.useLogger(new PinoLoggerService(httpLogger.logger));
  app.use(httpLogger);

  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.use(helmet());
  // Admin image uploads (faction art) arrive as the raw image bytes — image types only, size-capped;
  // every other content type keeps going through the JSON parser below.
  app.use(
    ['/v1/admin/tuning/factions', '/v1/admin/tuning/locations'],
    raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], limit: ART_UPLOAD_LIMIT }),
  );
  app.use(json({ limit: BODY_SIZE_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
  app.enableCors({
    origin: (origin: string | undefined, callback: CorsOriginCallback) => {
      const allowlist = env.get('CORS_ORIGINS');
      callback(null, !origin || allowlist.includes(origin));
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const env = app.get(EnvService);
  configureApp(app, env);
  await app.listen(env.get('PORT'));
}

// Only auto-run when this file is the process entrypoint, never on a plain import
// (tests import configureApp from this module without wanting a real app to boot).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void bootstrap();
}
