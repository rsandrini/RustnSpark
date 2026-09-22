import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JobsModule } from './jobs/jobs.module.js';

const logger = new Logger('Worker');

// Second entrypoint (D3): a separate process from the API so a crashing job never takes the HTTP
// server down, and running it proves the worker never relies on in-process API state. No HTTP
// server here, so no `configureApp`-style hardening is needed — createApplicationContext skips
// the platform adapter entirely.
export async function bootstrap(): Promise<INestApplicationContext> {
  // Unlike main.ts, nothing here ever calls app.useLogger() to attach a custom logger, so
  // bufferLogs would hold every log line forever instead of flushing it; leave it at its
  // default (false) so the built-in console logger prints immediately.
  const app = await NestFactory.createApplicationContext(JobsModule);
  // Lets an in-flight job finish before the process exits: BullMQ's Worker.close() (invoked by
  // @nestjs/bullmq's shutdown hook) waits for the current job by default instead of cutting it
  // off, and once app.close() resolves here there is nothing left keeping the event loop alive,
  // so the process exits on its own with code 0 (no explicit process.exit() call).
  app.enableShutdownHooks();
  logger.log('worker ready');
  return app;
}

// Only auto-run when this file is the process entrypoint, never on a plain import (tests import
// bootstrap()/JobsModule without wanting a real worker to start).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void bootstrap();
}
