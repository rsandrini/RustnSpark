import { ApiError } from './client';
import type { Problem } from './generated';

// Error bodies nest their payloads under `message` (Nest wraps thrown objects:
// `{ statusCode, message: { error, problems } }`). These extractors give every
// screen the same view: machine code for i18n lookup, problems for detail lists.
export function problemsOf(error: unknown): Problem[] {
  if (!(error instanceof ApiError)) return [];
  const payload = error.payload;
  if (typeof payload !== 'object' || payload === null) return [];
  const record = payload as { problems?: unknown; message?: unknown };
  if (Array.isArray(record.problems)) return record.problems as Problem[];
  if (typeof record.message === 'object' && record.message !== null) {
    const nested = record.message as { problems?: unknown };
    if (Array.isArray(nested.problems)) return nested.problems as Problem[];
  }
  return [];
}

export function errorCodeOf(error: unknown): string | undefined {
  return error instanceof ApiError ? (error.code ?? error.message) : undefined;
}

/** `PRICE_CHANGED` carries the server's actual price in `message.actual` (S10.9). */
export function priceChangedActualOf(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const payload = error.payload as { message?: { actual?: unknown } } | null | undefined;
  const actual = payload?.message?.actual;
  return typeof actual === 'number' ? actual : undefined;
}

/** Seconds to wait, when the server says so (`SCAVENGE_COOL_DOWN`, 429). */
export function retryAfterOf(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const payload = error.payload as { message?: { retryAfterSeconds?: unknown } } | null | undefined;
  const seconds = payload?.message?.retryAfterSeconds;
  return typeof seconds === 'number' ? seconds : undefined;
}

/**
 * The player-facing text for an API failure: the translated `error.<CODE>` when the
 * server sent a machine code (never the server's English `message`), otherwise the
 * screen's own fallback. Interpolation values the server provides (e.g. the cooldown)
 * are passed through.
 */
export function errorText(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
  fallback: string,
): string {
  const code = errorCodeOf(error);
  if (code === undefined) return fallback;
  return t(`error.${code}`, {
    defaultValue: fallback,
    seconds: retryAfterOf(error),
    price: priceChangedActualOf(error),
  });
}

/** The field-level problems of a rejected admin tuning write (`{ error: 'VALIDATION_ERROR', issues }`). */
export function validationIssuesOf(error: unknown): { key: string; message: string }[] {
  if (!(error instanceof ApiError)) return [];
  const payload = error.payload as { issues?: unknown } | null | undefined;
  if (!Array.isArray(payload?.issues)) return [];
  return (payload.issues as unknown[]).filter(
    (issue): issue is { key: string; message: string } =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as { key?: unknown }).key === 'string' &&
      typeof (issue as { message?: unknown }).message === 'string',
  );
}

/** A rejected tuning write as one readable line: each named problem ("key: message"), else the
    plain message — never the bare machine code `VALIDATION_ERROR`. */
export function failureText(error: Error): string {
  const issues = validationIssuesOf(error);
  return issues.length > 0
    ? issues.map((issue) => `${issue.key}: ${issue.message}`).join('; ')
    : error.message;
}

/**
 * One readable line for any failed request: the translated message for its machine code, else the
 * field problems the server named, else the server's own text — the generic fallback only when the
 * server said nothing useful.
 */
export function describeError(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) return fallback;
  const detail = failureText(error);
  const code = error instanceof ApiError ? error.code : undefined;
  const useful = detail !== '' && detail !== code && !/^HTTP \d+$/.test(detail);
  return errorText(t, error, useful ? detail : fallback);
}
