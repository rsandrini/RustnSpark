/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN for the browser, set at build time; empty = error tracking is off. */
  readonly VITE_SENTRY_DSN?: string;
  /** `1` runs the new-pilot opening on the sandbox (the real screens over a fake server); off by default for now. */
  readonly VITE_PROLOGUE_SANDBOX?: string;
}
