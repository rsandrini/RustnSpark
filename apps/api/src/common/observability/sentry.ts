import { createRequire } from 'node:module';
import * as Sentry from '@sentry/node';

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json') as { version: string };

/**
 * Error tracking (Sentry). Off unless SENTRY_DSN is set, so CI, tests and local shells send nothing.
 * Only server faults are reported (5xx and failed jobs): a wrong password or a bad request is the
 * player's problem, not ours. No request bodies, cookies or auth headers ever leave the process.
 */
export function initSentry(processName: 'api' | 'worker'): boolean {
  const dsn = process.env['SENTRY_DSN'];
  if (dsn === undefined || dsn.trim() === '') return false;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: `rustnspark@${version}`,
    serverName: processName,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.headers;
        delete event.request.query_string;
      }
      return event;
    },
  });
  Sentry.setTag('process', processName);
  return true;
}

/** A 5xx the API answered, with the request id that is also in the log line and the response body. */
export function captureServerError(error: unknown, requestId?: string): void {
  Sentry.captureException(error, { tags: requestId === undefined ? {} : { requestId } });
}

/** A BullMQ job that failed (after its retries, if any): which queue and which job. */
export function captureJobFailure(queue: string, jobId: string | undefined, error: unknown): void {
  Sentry.captureException(error, { tags: { queue, jobId: jobId ?? 'unknown' } });
}
