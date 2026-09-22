import { randomUUID } from 'node:crypto';
import type { Options } from 'pino-http';
import type { Env } from '../env/env.schema.js';

// Header/body keys that must never reach log output verbatim (secrets, credentials).
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.token',
  'res.headers["set-cookie"]',
];
const REDACT_CENSOR = '[REDACTED]';

function levelFor(nodeEnv: Env['NODE_ENV']): string {
  if (nodeEnv === 'production') return 'info';
  if (nodeEnv === 'test') return 'silent'; // keep `pnpm test:*` output pristine; behavior is unit-tested directly.
  return 'debug';
}

export function createPinoHttpOptions(nodeEnv: Env['NODE_ENV']): Options {
  return {
    level: levelFor(nodeEnv),
    autoLogging: nodeEnv !== 'test',
    genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
  };
}
