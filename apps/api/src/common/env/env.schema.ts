import { z } from 'zod';

const MIN_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3000;
// OWASP-floor Argon2id parameters (OWASP cheat sheet minimum for Argon2id: m=19456 KiB, t=2, p=1).
const DEFAULT_ARGON2_MEMORY_KIB = 19456;
const DEFAULT_ARGON2_TIME_COST = 2;
const DEFAULT_ARGON2_PARALLELISM = 1;

const secret = z
  .string()
  .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`);

const positiveInt = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const corsOrigin = z.string().refine(isBareHttpOrigin, 'must be a bare http(s) origin');

function isBareHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  CORS_ORIGINS: z
    .string()
    .transform((raw) => raw.split(',').map((origin) => origin.trim()))
    .pipe(z.array(corsOrigin).min(1)),
  JWT_ACCESS_SECRET: secret,
  COOKIE_SECRET: secret,
  // Non-secret Argon2id cost parameters (R19): defaults are the OWASP floor, tunable per env.
  ARGON2_MEMORY_KIB: positiveInt(DEFAULT_ARGON2_MEMORY_KIB),
  ARGON2_TIME_COST: positiveInt(DEFAULT_ARGON2_TIME_COST),
  ARGON2_PARALLELISM: positiveInt(DEFAULT_ARGON2_PARALLELISM),
});

export type Env = z.output<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

// Messages carry the variable name and the rule, never the received value (secrets).
export function validateEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  throw new InvalidEnvironmentError(
    result.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`),
  );
}
