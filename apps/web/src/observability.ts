import * as Sentry from '@sentry/react';
import { APP_VERSION } from './version';

/**
 * Browser error tracking (Sentry). Off unless VITE_SENTRY_DSN was set when the app was built, so
 * development, tests and CI send nothing. Errors only: no performance traces, no session replay,
 * no personal data, no URLs with query strings.
 */
export function initObservability(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (typeof dsn !== 'string' || dsn.trim() === '') return false;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: `rustnspark-web@${APP_VERSION.slice(1)}`,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request?.url !== undefined) event.request.url = event.request.url.split('?')[0];
      delete event.request?.cookies;
      return event;
    },
  });
  return true;
}

export { Sentry };
