/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN for the browser, set at build time; empty = error tracking is off. */
  readonly VITE_SENTRY_DSN?: string;
}
